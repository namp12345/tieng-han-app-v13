const STORAGE_KEY = 'ktour-v6-state';
const RECORDING_DB = 'ktour-v6-recordings';
const SESSION_TIMES = ['07:00', '10:00', '15:00', '19:00', '21:00'];

const state = {
  view: 'learn',
  topic: 'all',
  query: '',
  random: false,
  settings: {
    showCompletedInLearn: false,
    unlockAllPhrases: false,
    scheduleMode: true
  },
  progressById: {},
  dailyStats: {},
  quizIndex: 0,
  recording: {
    mediaRecorder: null,
    stream: null,
    chunks: [],
    activeId: null
  }
};

const refs = {
  viewRoot: document.getElementById('viewRoot'),
  flashcardTemplate: document.getElementById('flashcardTemplate'),
  quizTemplate: document.getElementById('quizTemplate'),
  topicFilter: document.getElementById('topicFilter'),
  searchInput: document.getElementById('searchInput'),
  randomBtn: document.getElementById('randomBtn'),
  controlPanel: document.getElementById('controlPanel'),
  sessionPanel: document.getElementById('sessionPanel'),
  progressPanel: document.getElementById('progressPanel'),
  progressText: document.getElementById('progressText'),
  progressBar: document.getElementById('progressBar'),
  statsText: document.getElementById('statsText')
};

const BASE_LEXICON = {
  오늘: { meaning_vi: 'hôm nay', root: '오늘', type: 'trạng từ', origin: 'thuần hàn', hanja: '' },
  함께해: { meaning_vi: 'cùng đồng hành', root: '함께하다', type: 'động từ', origin: 'thuần hàn', hanja: '' },
  주셔서: { meaning_vi: 'vì đã vui lòng...', root: '주시다', type: 'kính ngữ', origin: 'thuần hàn', hanja: '' },
  감사합니다: { meaning_vi: 'cảm ơn', root: '감사하다', type: 'động từ lịch sự', origin: 'hán hàn', hanja: '感謝' }
};

const ICON_POOL = ['👤','🧳','☂️','🙏','💬','👥','🚌','🏨','🏮','🗺️','🍜','⏰','📸','🛍️','🚨','✈️','🎫','🧭','🌧️','🌉'];

// Cache emoji đã fetch để không gọi API lại
const _emojiCache = {};

async function fetchSemanticEmoji(vi) {
  if (_emojiCache[vi]) return _emojiCache[vi];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `Chọn 1 emoji duy nhất phù hợp nhất với nghĩa câu sau, chỉ trả về emoji không thêm gì khác:\n"${vi}"`
        }]
      })
    });
    const data = await res.json();
    const emoji = data?.content?.[0]?.text?.trim() || null;
    if (emoji) { _emojiCache[vi] = emoji; return emoji; }
  } catch {}
  return null;
}

const SENTENCES = buildSentences();

function buildSentences() {
  const rows = [];
  PHRASE_TOPICS.forEach(topic => {
    topic.phrases.forEach((p, idx) => {
      const sessionIndex = Math.floor(idx / 3);
      rows.push({
        id: p.id,
        topic: topic.name,
        topicId: topic.id,
        korean: p.ko,
        romanization: p.roman,
        vietnamese: p.vi,
        image: p.image || ICON_POOL[Math.abs(hash(p.id)) % ICON_POOL.length],
        analysis: p.analysis || null,
        naturalMeaning: p.naturalMeaning || p.vi,
        usage: p.usage || p.note || 'Dùng trong dẫn tour thực tế',
        similarPatterns: p.similarPatterns || [p.ko],
        sessionIndex,
        sessionTime: SESSION_TIMES[sessionIndex % SESSION_TIMES.length]
      });
    });
  });
  return rows;
}

function hash(s){ let h=0; for(const c of s) h=(h<<5)-h+c.charCodeAt(0); return h; }
function todayKey(){ return new Date().toISOString().slice(0,10); }

function ensureDaily() {
  const key = todayKey();
  if (!state.dailyStats[key]) {
    state.dailyStats[key] = { date: key, studiedCount: 0, completedCount: 0, listenCount: 0, slowListenCount: 0, recordCount: 0, selfPlayCount: 0, completedSessions: [], topicsStudied: [] };
  }
  return state.dailyStats[key];
}

function ensureProgress(id, sentence) {
  if (!state.progressById[id]) {
    state.progressById[id] = {
      id,
      topic: sentence.topic,
      korean: sentence.korean,
      romanization: sentence.romanization,
      vietnamese: sentence.vietnamese,
      image: sentence.image,
      analysis: sentence.analysis || [],
      isCompleted: false,
      completedAt: null,
      reviewBucket: false,
      listenCount: 0,
      slowListenCount: 0,
      recordCount: 0,
      selfPlayCount: 0,
      sessionTime: sentence.sessionTime,
      sessionIndex: sentence.sessionIndex,
      unlocked: sentence.sessionIndex === 0
    };
  }
  return state.progressById[id];
}

function init() {
  hydrate();
  SENTENCES.forEach(s => ensureProgress(s.id, s));
  bindEvents();
  buildTopicFilter();
  unlockProgressiveSessions();
  render();
  registerServiceWorker();
}

function hydrate() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.settings = { ...state.settings, ...(raw.settings || {}) };
    state.progressById = raw.progressById || {};
    state.dailyStats = raw.dailyStats || {};
  } catch {}
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: state.settings, progressById: state.progressById, dailyStats: state.dailyStats }));
}

function bindEvents() {
  document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.nav-tab').forEach(x => x.classList.toggle('active', x === tab));
    render();
  }));
  refs.topicFilter.addEventListener('change', e => { state.topic = e.target.value; render(); });
  refs.searchInput.addEventListener('input', e => { state.query = e.target.value.toLowerCase(); render(); });
  refs.randomBtn.addEventListener('click', () => { state.random = !state.random; render(); });
}

function buildTopicFilter() {
  refs.topicFilter.innerHTML = '<option value="all">Tất cả chủ đề</option>';
  PHRASE_TOPICS.forEach(t => {
    const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; refs.topicFilter.append(o);
  });
}

function getFiltered() {
  let list = SENTENCES.filter(s => state.topic === 'all' || s.topicId === state.topic);
  if (state.query) list = list.filter(s => `${s.korean} ${s.vietnamese}`.toLowerCase().includes(state.query));
  if (state.settings.scheduleMode && !state.settings.unlockAllPhrases) {
    list = list.filter(s => state.progressById[s.id]?.unlocked);
  }
  if (!state.settings.showCompletedInLearn) {
    list = list.filter(s => !state.progressById[s.id]?.isCompleted);
  }
  if (state.random) list.sort(() => Math.random() - 0.5);
  return list;
}

function currentSessionInfo() {
  const visible = getFiltered();
  if (!visible.length) return { time: '-', done: 0, total: 0, nextUnlocked: false };
  const sessionIdx = Math.min(...visible.map(v => v.sessionIndex));
  const batch = visible.filter(v => v.sessionIndex === sessionIdx).slice(0, 3);
  const done = batch.filter(v => state.progressById[v.id]?.isCompleted).length;
  const nextUnlocked = visible.some(v => v.sessionIndex === sessionIdx + 1 && state.progressById[v.id]?.unlocked);
  return { time: SESSION_TIMES[sessionIdx % SESSION_TIMES.length], done, total: batch.length, nextUnlocked };
}

function render() {
  const learnMode = state.view === 'learn';
  refs.controlPanel.classList.toggle('hidden', !learnMode);
  refs.progressPanel.classList.toggle('hidden', !learnMode);
  refs.sessionPanel.classList.toggle('hidden', !learnMode);

  if (state.view === 'quiz') return renderQuiz();
  if (state.view === 'review') return renderReview();
  if (state.view === 'stats') return renderStats();
  if (state.view === 'settings') return renderSettings();
  return renderLearn();
}

function renderSessionPanel() {
  const s = currentSessionInfo();
  refs.sessionPanel.innerHTML = `
    <article class="simple-panel session-card">
      <div class="session-head">
        <strong>Phiên học hiện tại</strong>
        <span class="session-badge">${s.time}</span>
      </div>
      <p class="panel-subtitle">Đã học: <b>${s.done}/${Math.max(3, s.total)}</b> · Phiên kế tiếp: <b>${s.nextUnlocked ? 'Đã mở' : 'Đang khóa'}</b></p>
    </article>
  `;
}

function renderLearn() {
  renderSessionPanel();
  refs.viewRoot.innerHTML = '';
  const visible = getFiltered();
  if (!visible.length) {
    refs.viewRoot.innerHTML = '<p class="empty">Không còn cụm từ trong phiên hiện tại.</p>';
    updateTopProgress();
    return;
  }
  let sessionIdx = Math.min(...visible.map(v => v.sessionIndex));
  let list = visible.filter(v => v.sessionIndex === sessionIdx).slice(0, 3);
  if (state.settings.unlockAllPhrases || !state.settings.scheduleMode) list = visible.slice(0, 12);
  list.forEach(s => refs.viewRoot.append(FlashcardSentence(s)));
  updateTopProgress();
}

function FlashcardSentence(s) {
  const node = refs.flashcardTemplate.content.firstElementChild.cloneNode(true);
  const p = ensureProgress(s.id, s);

  const imgEl = node.querySelector('[data-image]');
  imgEl.textContent = s.image; // fallback ngay lập tức
  // Async load emoji thông minh
  fetchSemanticEmoji(s.vietnamese).then(emoji => {
    if (emoji) imgEl.textContent = emoji;
  });

  node.querySelector('[data-topic]').textContent = `${s.topic} · ${s.sessionTime}`;
  node.querySelector('[data-korean]').textContent = s.korean;
  node.querySelector('[data-roman]').textContent = s.romanization;
  node.querySelector('[data-vietnamese]').textContent = s.vietnamese;
  node.querySelector('[data-korean-back]').textContent = s.korean;
  node.querySelector('[data-natural]').textContent = s.naturalMeaning;

  node.querySelector('[data-front-audio]').addEventListener('click', e => { e.stopPropagation(); actListen(s, false); });
  bindDoubleTapFlip(node);
  bindTap(node.querySelector('[data-unflip]'), e => { e.stopPropagation(); node.classList.remove('flipped'); });

  const completionLabel = node.querySelector('[data-completion-label]');
  completionLabel.textContent = p.isCompleted ? 'Đã hoàn thành' : 'Chưa hoàn thành';
  node.querySelector('[data-action="complete"]').addEventListener('click', () => markCompleted(s.id));

  bindBackTabs(node);
  bindPractice(node, s);
  renderAnalysis(node.querySelector('[data-analysis]'), s);
  return node;
}

function bindPractice(node, s) {
  const status = node.querySelector('[data-record-status]');
  node.querySelector('[data-action="listen"]').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); actListen(s, false); });
  node.querySelector('[data-action="listenSlow"]').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); actListen(s, true); });
  node.querySelector('[data-action="known"]')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); markCompleted(s.id); });
  node.querySelector('[data-action="hard"]')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    state.progressById[s.id].reviewBucket = !state.progressById[s.id].reviewBucket;
    persist();
  });
  bindRecording(node, s, status);
}

function bindTap(el, handler) {
  if (!el) return;
  el.addEventListener('click', handler);
  el.addEventListener('touchend', e => {
    e.preventDefault();
    handler(e);
  }, { passive: false });
}

function bindDoubleTapFlip(node) {
  const front = node.querySelector('.FlashcardFront');
  if (!front) return;
  let lastTapAt = 0;
  let lastX = 0;
  let lastY = 0;
  let lastTouchAt = 0;
  const DOUBLE_TAP_MS = 250;
  const MOVE_THRESHOLD = 24;

  const isInteractiveTarget = target => target.closest('button, input, select, textarea, a, label, [data-action], .AudioButton, .CompletionToggle');
  const onTapEnd = e => {
    if (e.type === 'click' && Date.now() - lastTouchAt < 420) return;
    if (isInteractiveTarget(e.target)) return;
    const changed = e.changedTouches?.[0];
    const x = changed?.clientX ?? e.clientX ?? 0;
    const y = changed?.clientY ?? e.clientY ?? 0;
    const now = Date.now();
    if (e.type === 'touchend') lastTouchAt = now;
    const closeInTime = now - lastTapAt <= DOUBLE_TAP_MS;
    const closeInSpace = Math.hypot(x - lastX, y - lastY) <= MOVE_THRESHOLD;
    if (closeInTime && closeInSpace) {
      node.classList.add('flipped', 'flip-activated');
      setTimeout(() => node.classList.remove('flip-activated'), 320);
      lastTapAt = 0;
      return;
    }
    lastTapAt = now;
    lastX = x;
    lastY = y;
  };

  front.addEventListener('touchend', onTapEnd, { passive: true });
  front.addEventListener('click', onTapEnd);
}

function bindBackTabs(node) {
  node.querySelectorAll('.mini-tab').forEach(tab => tab.addEventListener('click', () => {
    const key = tab.dataset.tab;
    node.querySelectorAll('.mini-tab').forEach(x => x.classList.toggle('active', x === tab));
    node.querySelectorAll('.tab-body').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== key));
  }));
}

async function renderAnalysis(root, s) {
  root.innerHTML = '<p style="color:var(--text-faint);font-size:.85rem;padding:6px 0">Đang phân tích từ vựng...</p>';
  const analysis = s.analysis || await buildAnalysisAuto(s.korean, s.vietnamese);
  root.innerHTML = '';
  analysis.forEach(item => {
    const origin = normalizeOrigin(item.origin);
    const originCls = origin === 'thuần hàn' ? 'tag-native' : origin === 'hán hàn' ? 'tag-sino' : 'tag-unknown';
    const originLabel = origin === 'thuần hàn' ? '🟡 Thuần Hàn' : origin === 'hán hàn' ? `🔵 Hán Hàn${item.hanja ? ` (${item.hanja})` : ''}` : '⚪ Ngoại lai / Không rõ';
    const typeIcon = getTypeIcon(item.type);

    // Build morpheme breakdown nếu có
    let morphemeHtml = '';
    if (item.morphemes && item.morphemes.length) {
      morphemeHtml = `
        <div class="morpheme-row">
          ${item.morphemes.map(m => `<span class="morpheme-chip">${m.part}<span class="morpheme-gloss">${m.gloss}</span></span>`).join('<span class="morpheme-plus">+</span>')}
        </div>`;
    }

    const row = document.createElement('article');
    row.className = 'word-item';
    row.innerHTML = `
      <div class="word-head">
        <div class="word-head-left">
          <strong>${item.word}</strong>
          ${item.root && item.root !== item.word ? `<span class="word-root">← ${item.root}</span>` : ''}
        </div>
        <button class="AudioButton" title="Nghe phát âm">🔊</button>
      </div>
      ${morphemeHtml}
      <p class="word-meaning">📖 ${item.meaning_vi}</p>
      <div class="word-tags">
        <span class="type-tag">${typeIcon} ${item.type || 'từ vựng'}</span>
        <span class="origin-tag ${originCls}">${originLabel}</span>
      </div>
      ${item.note ? `<p class="word-note">💡 ${item.note}</p>` : ''}
    `;
    row.querySelector('.AudioButton').addEventListener('click', () => speak(item.word, 0.8));
    root.append(row);
  });
}

async function buildAnalysisAuto(sentence, vi_sentence) {
  // Thử dùng BASE_LEXICON trước cho các từ đơn
  const words = sentence.split(/\s+/).filter(Boolean);
  const allInLexicon = words.every(w => BASE_LEXICON[w]);
  if (allInLexicon) {
    return words.map(w => ({ word: w, ...BASE_LEXICON[w] }));
  }

  // Gọi Claude API để phân tích sâu
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Phân tích ngôn ngữ học tiếng Hàn cho câu: "${sentence}" (nghĩa: "${vi_sentence}")

Trả về JSON array, mỗi phần tử là một từ/cụm từ có nghĩa độc lập, theo cấu trúc sau:
{
  "word": "từ tiếng Hàn",
  "root": "dạng gốc (nếu là động từ/tính từ biến thể thì ghi dạng tự điển -다)",
  "meaning_vi": "nghĩa tiếng Việt ngắn gọn",
  "type": "loại từ: 명사(danh từ) | 동사(động từ) | 형용사(tính từ) | 부사(trạng từ) | 조사(trợ từ) | 어미(đuôi động từ) | 접속사(liên từ) | 대명사(đại từ) | 수사(số từ) | 감탄사(thán từ) | 외래어(ngoại lai)",
  "origin": "thuần hàn | hán hàn | ngoại lai",
  "hanja": "chữ Hán nếu là hán hàn, để trống nếu không",
  "morphemes": [{"part": "hình vị", "gloss": "chức năng ngắn"}],
  "note": "mẹo ghi nhớ hoặc ngữ pháp đặc biệt ngắn (tối đa 1 câu, có thể để trống)"
}

Chỉ trả về JSON array, không thêm bất cứ điều gì khác.`
        }]
      })
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim() || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}

  // Fallback đơn giản
  return words.map(w => ({
    word: w,
    meaning_vi: await translateWord(w).catch(() => `từ ${w}`),
    root: guessRoot(w),
    type: guessType(w),
    origin: guessOrigin(w),
    hanja: '',
    morphemes: [],
    note: ''
  }));
}

async function translateWord(w) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=vi&dt=t&q=${encodeURIComponent(w)}`;
    const data = await (await fetch(url)).json();
    return data?.[0]?.map(x => x[0]).join('') || `từ ${w}`;
  } catch { return `từ ${w}`; }
}

function guessRoot(w){ return w.endsWith('습니다') ? `${w.replace('습니다','')}다` : w; }
function guessType(w){ return w.endsWith('습니다') ? 'đuôi lịch sự' : 'từ vựng'; }
function guessOrigin(w){ return /(감사|시간|여권|확인)/.test(w) ? 'hán hàn' : 'thuần hàn'; }
function normalizeOrigin(v){ const x=(v||'').toLowerCase(); if(x.includes('hán')) return 'hán hàn'; if(x.includes('thuần')) return 'thuần hàn'; return 'không xác định'; }

function getTypeIcon(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('danh') || t.includes('명사')) return '🟠';
  if (t.includes('động') || t.includes('동사')) return '🔴';
  if (t.includes('tính') || t.includes('형용')) return '🟣';
  if (t.includes('trạng') || t.includes('부사')) return '🟡';
  if (t.includes('trợ') || t.includes('조사')) return '⚫';
  if (t.includes('đuôi') || t.includes('어미')) return '🔵';
  if (t.includes('ngoại') || t.includes('외래')) return '⚪';
  if (t.includes('đại') || t.includes('대명')) return '🟢';
  if (t.includes('liên') || t.includes('접속')) return '🩵';
  return '◻️';
}

function actListen(sentence, slow) {
  speak(sentence.korean, slow ? 0.75 : 1);
  const p = state.progressById[sentence.id];
  if (slow) p.slowListenCount++; else p.listenCount++;
  logDaily(slow ? 'slowListenCount' : 'listenCount', sentence);
  persist();
}

function markCompleted(id) {
  const p = state.progressById[id];
  if (p.isCompleted) return;
  p.isCompleted = true;
  p.completedAt = new Date().toISOString();
  logDaily('completedCount', SENTENCES.find(s => s.id === id));
  unlockProgressiveSessions();
  persist();
  render();
}

function unlockProgressiveSessions() {
  const byTopic = {};
  SENTENCES.forEach(s => {
    byTopic[s.topicId] ||= {};
    byTopic[s.topicId][s.sessionIndex] ||= [];
    byTopic[s.topicId][s.sessionIndex].push(s);
  });

  Object.values(byTopic).forEach(topicSessions => {
    const idxs = Object.keys(topicSessions).map(Number).sort((a,b)=>a-b);
    idxs.forEach((idx, pos) => {
      if (pos === 0) {
        topicSessions[idx].forEach(s => state.progressById[s.id].unlocked = true);
      } else {
        const prevDone = topicSessions[idxs[pos-1]].every(s => state.progressById[s.id].isCompleted);
        topicSessions[idx].forEach(s => state.progressById[s.id].unlocked = prevDone || state.settings.unlockAllPhrases);
      }
    });
  });
}

function logDaily(field, sentence) {
  const day = ensureDaily();
  day[field] += 1;
  if (sentence?.topic && !day.topicsStudied.includes(sentence.topic)) day.topicsStudied.push(sentence.topic);
  day.studiedCount += 1;
  const key = `${sentence?.topicId || 'all'}:${sentence?.sessionTime || ''}`;
  if (!day.completedSessions.includes(key) && sentence && isSessionCompleted(sentence.topicId, sentence.sessionIndex)) {
    day.completedSessions.push(key);
  }
}

function isSessionCompleted(topicId, sessionIndex) {
  const list = SENTENCES.filter(s => s.topicId === topicId && s.sessionIndex === sessionIndex);
  return list.every(s => state.progressById[s.id]?.isCompleted);
}

function ensureDaily() {
  const key = new Date().toISOString().slice(0,10);
  if (!state.dailyStats[key]) {
    state.dailyStats[key] = { date:key, studiedCount:0, completedCount:0, listenCount:0, slowListenCount:0, recordCount:0, selfPlayCount:0, completedSessions:[], topicsStudied:[] };
  }
  return state.dailyStats[key];
}

function renderQuiz() {
  refs.viewRoot.innerHTML = '';
  const source = getFiltered();
  if (!source.length) return;
  const cur = source[state.quizIndex % source.length];
  const wrong = source.filter(x => x.id !== cur.id).sort(()=>Math.random()-0.5).slice(0,3).map(x=>x.vietnamese);
  const options = [cur.vietnamese, ...wrong].sort(()=>Math.random()-0.5);
  const card = refs.quizTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('[data-quiz-korean]').textContent = cur.korean;
  card.querySelector('[data-quiz-audio]').addEventListener('click', ()=>actListen(cur,false));
  const result = card.querySelector('[data-quiz-result]');
  const wrap = card.querySelector('[data-quiz-options]');
  options.forEach(opt => {
    const b = document.createElement('button'); b.className = 'quiz-option'; b.textContent = opt;
    b.addEventListener('click', ()=>{ const ok=opt===cur.vietnamese; b.classList.add(ok?'ok':'fail'); result.textContent = ok?'✅ Đúng':'❌ Sai'; });
    wrap.append(b);
  });
  card.querySelector('[data-quiz-next]').addEventListener('click', ()=>{ state.quizIndex++; renderQuiz(); });
  refs.viewRoot.append(card);
}

function renderReview() {
  refs.viewRoot.innerHTML = '';
  const list = Object.values(state.progressById).filter(p => p.reviewBucket || p.isCompleted).slice(0, 100);
  const panel = document.createElement('article');
  panel.className = 'simple-panel';
  panel.innerHTML = `
    <h3 class="panel-title">Ôn tập thông minh</h3>
    <p class="panel-subtitle">${list.length} cụm từ trong bucket ôn tập.</p>
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Trong bucket ôn</div>
        <div class="metric-value">${list.filter(x => x.reviewBucket).length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Đã hoàn thành</div>
        <div class="metric-value">${list.filter(x => x.isCompleted).length}</div>
      </div>
    </div>
  `;
  refs.viewRoot.append(panel);
}

function renderStats() {
  refs.viewRoot.innerHTML = '';
  const today = ensureDaily();
  const total = Object.values(state.progressById);
  const completed = total.filter(x => x.isCompleted).length;
  const days = Object.keys(state.dailyStats).sort();
  const streak = calcStreak(days);
  const bestTopic = calcBestTopic();
  const bestTime = calcBestTime();

  refs.viewRoot.innerHTML = `
    <article class="simple-panel">
      <h3 class="panel-title">Hôm nay (${today.date})</h3>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Đã học</div><div class="metric-value">${today.studiedCount}</div></div>
        <div class="metric-card"><div class="metric-label">Hoàn thành</div><div class="metric-value">${today.completedCount}</div></div>
        <div class="metric-card"><div class="metric-label">Lượt nghe</div><div class="metric-value">${today.listenCount + today.slowListenCount}</div></div>
        <div class="metric-card"><div class="metric-label">Luyện nói</div><div class="metric-value">${today.recordCount + today.selfPlayCount}</div></div>
      </div>
      <p class="panel-subtitle">Phiên hoàn thành: <b>${today.completedSessions.length}</b></p>
    </article>
    <article class="simple-panel">
      <h3 class="panel-title">Tổng quan tiến độ</h3>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Hoàn thành</div><div class="metric-value">${completed}/${total.length}</div></div>
        <div class="metric-card"><div class="metric-label">Còn lại</div><div class="metric-value">${total.length - completed}</div></div>
        <div class="metric-card"><div class="metric-label">Ngày đã học</div><div class="metric-value">${days.length}</div></div>
        <div class="metric-card"><div class="metric-label">Streak</div><div class="metric-value">${streak} ngày</div></div>
      </div>
      <p class="panel-subtitle">Chủ đề học nhiều nhất: <b>${bestTopic}</b></p>
      <p class="panel-subtitle">Khung giờ hiệu quả nhất: <b>${bestTime}</b></p>
    </article>
    <article class="simple-panel">
      <h3 class="panel-title">Lịch sử 14 ngày</h3>
      <div class="history-list">${days.reverse().slice(0,14).map(d => {
        const x = state.dailyStats[d];
        return `<p class="history-item">${d}: học ${x.studiedCount}, hoàn thành ${x.completedCount}, luyện nói ${x.recordCount + x.selfPlayCount}</p>`;
      }).join('')}</div>
    </article>
  `;
}

function calcStreak(days) {
  if (!days.length) return 0;
  let streak = 0;
  let cur = new Date();
  while (true) {
    const key = cur.toISOString().slice(0,10);
    if (state.dailyStats[key]) { streak++; cur.setDate(cur.getDate()-1); }
    else break;
  }
  return streak;
}

function calcBestTopic() {
  const map = {};
  Object.values(state.dailyStats).forEach(d => d.topicsStudied.forEach(t => map[t] = (map[t] || 0) + 1));
  return Object.entries(map).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Chưa có';
}

function calcBestTime() {
  const map = {};
  Object.values(state.dailyStats).forEach(d => d.completedSessions.forEach(s => { const time = s.split(':').slice(-2).join(':'); map[time]=(map[time]||0)+1; }));
  return Object.entries(map).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Chưa có';
}

function renderSettings() {
  refs.viewRoot.innerHTML = `
    <article class="simple-panel" id="settingsPanel">
      <h3 class="panel-title">Cài đặt học tập</h3>
      <p class="panel-subtitle">Tùy chỉnh trải nghiệm học mỗi ngày mà không làm mất dữ liệu.</p>
      <div class="settings-wrap">
        <label class="settings-switch">
          <input type="checkbox" id="setShowCompleted" ${state.settings.showCompletedInLearn ? 'checked':''}>
          <span class="switch-copy"><b>Hiển thị câu đã hoàn thành</b><span>Bật để ôn lại toàn bộ câu đã học.</span></span>
        </label>
        <label class="settings-switch">
          <input type="checkbox" id="setUnlockAll" ${state.settings.unlockAllPhrases ? 'checked':''}>
          <span class="switch-copy"><b>Mở tất cả cụm từ</b><span>Bỏ giới hạn mở khóa theo phiên.</span></span>
        </label>
        <label class="settings-switch">
          <input type="checkbox" id="setSchedule" ${state.settings.scheduleMode ? 'checked':''}>
          <span class="switch-copy"><b>Học theo khung giờ</b><span>Giữ nhịp học theo phiên cố định.</span></span>
        </label>
        <div class="settings-actions">
          <button class="settings-action" id="resetAll">Reset tiến độ học</button>
          <button class="settings-action" id="resetCompleted">Reset trạng thái hoàn thành</button>
          <button class="settings-action" id="resetStats">Reset thống kê</button>
          <button class="settings-action" id="exportData">Xuất dữ liệu học</button>
        </div>
        <input id="importFile" type="file" accept="application/json">
      </div>
    </article>
  `;

  document.getElementById('setShowCompleted').onchange = e => { state.settings.showCompletedInLearn = e.target.checked; persist(); render(); };
  document.getElementById('setUnlockAll').onchange = e => { state.settings.unlockAllPhrases = e.target.checked; unlockProgressiveSessions(); persist(); render(); };
  document.getElementById('setSchedule').onchange = e => { state.settings.scheduleMode = e.target.checked; persist(); render(); };
  document.getElementById('resetAll').onclick = () => { state.progressById = {}; state.dailyStats = {}; SENTENCES.forEach(s=>ensureProgress(s.id,s)); persist(); render(); };
  document.getElementById('resetCompleted').onclick = () => { Object.values(state.progressById).forEach(p => { p.isCompleted=false; p.completedAt=null; }); unlockProgressiveSessions(); persist(); render(); };
  document.getElementById('resetStats').onclick = () => { state.dailyStats = {}; persist(); render(); };
  document.getElementById('exportData').onclick = () => {
    const blob = new Blob([JSON.stringify({ settings: state.settings, progressById: state.progressById, dailyStats: state.dailyStats }, null, 2)], { type:'application/json' });
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ktour-v6-backup.json'; a.click();
  };
  document.getElementById('importFile').onchange = async e => {
    const file=e.target.files[0]; if(!file) return;
    const txt = await file.text();
    const data = JSON.parse(txt);
    state.settings = { ...state.settings, ...(data.settings||{}) };
    state.progressById = data.progressById || state.progressById;
    state.dailyStats = data.dailyStats || state.dailyStats;
    persist(); render();
  };
}

function updateTopProgress() {
  const all = Object.values(state.progressById);
  const completed = all.filter(x => x.isCompleted).length;
  refs.progressText.textContent = `${completed}/${all.length} hoàn thành`;
  refs.progressBar.style.width = `${Math.round((completed / all.length) * 100)}%`;
  refs.statsText.textContent = `Review bucket: ${all.filter(x=>x.reviewBucket).length} · Chưa hoàn thành: ${all.length - completed}`;
}

function speak(text, rate = 1) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function openRecordingDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECORDING_DB, 1);
    req.onupgradeneeded = () => !req.result.objectStoreNames.contains('recordings') && req.result.createObjectStore('recordings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecording(id, blob) {
  const db = await openRecordingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(blob, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getRecording(id) {
  const db = await openRecordingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecording(id) {
  const db = await openRecordingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function bindRecording(node, sentence, statusNode) {
  const recordBtns = node.querySelectorAll('[data-action="record"]');
  const playBtns = node.querySelectorAll('[data-action="selfPlay"], [data-action="play"]');
  const deleteBtn = node.querySelector('[data-action="delete"]');
  const p = state.progressById[sentence.id];
  const existing = await getRecording(sentence.id).catch(() => null);
  const hasRecording = Boolean(existing);
  playBtns.forEach(btn => btn.disabled = !hasRecording);
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !hasRecording);
  statusNode.textContent = hasRecording ? 'Đã có bản ghi âm.' : 'Chưa có bản ghi âm.';

  const startRecord = async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) return;
    if (state.recording.mediaRecorder && state.recording.activeId === sentence.id) {
      state.recording.mediaRecorder.stop();
      return;
    }
    if (state.recording.mediaRecorder) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recording.stream = stream;
    state.recording.mediaRecorder = new MediaRecorder(stream);
    state.recording.chunks = [];
    state.recording.activeId = sentence.id;
    state.recording.mediaRecorder.ondataavailable = e => e.data.size > 0 && state.recording.chunks.push(e.data);
    state.recording.mediaRecorder.onstop = async () => {
      await saveRecording(sentence.id, new Blob(state.recording.chunks, { type: 'audio/webm' }));
      playBtns.forEach(btn => btn.disabled = false);
      if (deleteBtn) deleteBtn.classList.remove('hidden');
      statusNode.textContent = 'Đã lưu bản ghi âm.';
      p.recordCount += 1; logDaily('recordCount', sentence); persist();
      stream.getTracks().forEach(t => t.stop());
      state.recording.mediaRecorder = null;
      state.recording.stream = null;
      state.recording.chunks = [];
      state.recording.activeId = null;
    };
    state.recording.mediaRecorder.start();
    statusNode.textContent = 'Đang ghi âm...';
  };

  const playSelf = async () => {
    const blob = await getRecording(sentence.id);
    if (!blob) return;
    new Audio(URL.createObjectURL(blob)).play();
    p.selfPlayCount += 1; logDaily('selfPlayCount', sentence); persist();
  };

  recordBtns.forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); startRecord(); }));
  playBtns.forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); playSelf(); }));
  deleteBtn?.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    await deleteRecording(sentence.id);
    playBtns.forEach(btn => btn.disabled = true);
    deleteBtn.classList.add('hidden');
    statusNode.textContent = 'Đã xóa bản ghi âm.';
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
}

window.addEventListener('DOMContentLoaded', init);
