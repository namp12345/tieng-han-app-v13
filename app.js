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

// ─── Bảng emoji thông minh theo từ khóa tiếng Việt ───
const SEMANTIC_MAP = [
  // Chào hỏi
  [/chào buổi sáng/i,'🌅'],[/chào buổi chiều/i,'☀️'],[/chào buổi tối/i,'🌙'],
  [/rất vui được gặp|hân hạnh|gặp lần đầu/i,'🤝'],[/hướng dẫn viên|hdv phụ trách|tôi là.*guide/i,'🪪'],
  [/chào mừng.*đến|welcome/i,'🎉'],[/tên là gì|tên.*quý khách/i,'📛'],
  [/vất vả.*di chuyển|đi.*mệt/i,'😓'],[/đồng hành|cùng nhau/i,'👥'],
  [/thắc mắc.*hỏi|câu hỏi/i,'❓'],[/vui vẻ|vui lòng/i,'😊'],
  [/hàn quốc/i,'🇰🇷'],[/đà nẵng/i,'🌊'],[/tiếng hàn/i,'🗣️'],
  [/điểm danh|số lượng khách/i,'📋'],[/thời tiết đẹp|nắng/i,'☀️'],
  // Sân bay
  [/sân bay/i,'✈️'],[/nhập cảnh|hải quan/i,'🛂'],[/hành lý|vali/i,'🧳'],
  [/xe đẩy.*hành lý|trolley/i,'🛒'],[/đổi tiền/i,'💱'],[/wifi/i,'📶'],
  [/sim|sim card/i,'📱'],[/xe đoàn|xe bus/i,'🚌'],[/biển số xe/i,'🚍'],
  [/chỗ ngồi|ghế/i,'💺'],[/điều hòa|nhiệt độ/i,'❄️'],[/khách sạn/i,'🏨'],
  [/tài xế/i,'🧑‍✈️'],[/cửa ra/i,'🚪'],[/bảng chỉ dẫn/i,'🪧'],
  // Lịch trình
  [/lịch trình/i,'📅'],[/thành phố|siêu thị/i,'🏙️'],[/bà nà hills/i,'🚡'],
  [/sông hàn|sông/i,'🌉'],[/bữa trưa|ăn trưa/i,'🍽️'],[/tham quan/i,'🗺️'],
  [/thuyết minh|giới thiệu/i,'🎙️'],[/check-in|chụp ảnh đẹp/i,'📸'],
  [/nhà vệ sinh|vệ sinh/i,'🚻'],[/mưa|trời mưa/i,'☂️'],[/an toàn|an toàn nhất/i,'🛡️'],
  [/phát.*lịch|lịch in/i,'📄'],[/thứ tự.*đổi/i,'🔄'],[/điểm tiếp|địa điểm tiếp/i,'📍'],
  // Thời gian
  [/\d+ phút|phút nữa|còn.*phút/i,'⏱️'],[/đúng giờ|giờ hẹn/i,'⏰'],
  [/đến muộn|trễ/i,'⏳'],[/xuất phát|khởi hành/i,'🚀'],[/tập trung|mọi người/i,'🙋'],
  [/kakaotalk|kakao/i,'💬'],[/đồng hồ/i,'⌚'],
  // Xe
  [/lên xe|mời.*xe/i,'🚌'],[/dây an toàn|thắt dây/i,'🔒'],[/cửa sổ/i,'🪟'],
  [/cấm hút thuốc|hút thuốc/i,'🚭'],[/đồ ăn.*uống/i,'🥤'],[/trơn.*cẩn thận|ngã/i,'⚠️'],
  // Ăn uống
  [/nhà hàng|ẩm thực/i,'🍜'],[/đặt bàn/i,'🍽️'],[/dị ứng|không ăn được/i,'⚠️'],
  [/phở|bún|mì/i,'🍜'],[/hải sản/i,'🦐'],[/thịt/i,'🥩'],[/chay/i,'🥗'],
  [/gọi món/i,'📋'],[/thanh toán|tiền|mặt|thẻ/i,'💳'],[/hóa đơn|biên lai/i,'🧾'],
  [/uống nước|nước/i,'💧'],[/cà phê/i,'☕'],[/bia/i,'🍺'],
  // Mua sắm
  [/mua sắm|mua.*đồ/i,'🛍️'],[/giá|mặc cả/i,'💰'],[/quà lưu niệm/i,'🎁'],
  [/duty free|miễn thuế/i,'🛒'],[/hóa đơn|hóa đơn đỏ/i,'🧾'],
  // Bà Nà / Địa điểm
  [/cáp treo/i,'🚡'],[/hội an/i,'🏮'],[/ngũ hành sơn/i,'⛰️'],
  [/biển|bãi biển/i,'🏖️'],[/đình chùa|chùa/i,'⛩️'],[/bảo tàng/i,'🏛️'],
  // Y tế
  [/thuốc|y tế/i,'💊'],[/say xe|buồn nôn/i,'🤢'],[/bị thương|đau/i,'🩹'],
  [/bệnh viện/i,'🏥'],[/cấp cứu/i,'🚑'],
  // Khẩn cấp
  [/khẩn cấp|emergency/i,'🆘'],[/mất.*đồ|thất lạc/i,'🔍'],[/cảnh sát/i,'🚔'],
  [/bảo hiểm/i,'📋'],[/hộ chiếu|passport/i,'🛂'],
  // Check-out / Tạm biệt
  [/tạm biệt|thượng lộ|về nhà an toàn/i,'👋'],[/bay về|bay hàn/i,'✈️'],
  [/đánh giá|review/i,'⭐'],[/chia sẻ ảnh|nhóm chat/i,'📲'],
  [/cảm ơn.*đồng hành|cảm ơn chân thành/i,'🙏'],[/gặp lại/i,'🤗'],
  [/khỏe mạnh/i,'💪'],[/chúc.*vui|niềm vui/i,'😄'],
  // Chung
  [/xin lỗi/i,'🙇'],[/cảm ơn/i,'🙏'],[/vâng.*đúng|đúng rồi/i,'✅'],
  [/không.*phải|sai/i,'❌'],[/chờ một chút|chờ/i,'⏳'],[/giúp|hỗ trợ/i,'🤲'],
  [/đây là.*khu|khu vực/i,'📍'],[/nói chậm|nói lại/i,'🗣️'],[/hướng này/i,'👉'],
  [/thông báo|hướng dẫn/i,'📢'],[/số ghế|số vé/i,'🎫'],[/điện thoại|pin/i,'📱'],
  [/tiền mặt.*thẻ|thẻ.*tiền mặt/i,'💳'],[/ô.*mưa|mưa/i,'☂️'],[/rác/i,'🗑️'],
  [/chụp ảnh|ảnh|selfie/i,'📸'],[/nghỉ ngơi|nghỉ ngắn/i,'☕'],
  [/gió mạnh|gió/i,'💨'],[/nóng/i,'🥵'],[/lạnh/i,'🥶'],
  [/mất vé|đừng.*mất/i,'🎫'],[/đoàn|nhóm/i,'👥'],[/bé|trẻ em/i,'👶'],
];

function getSemanticEmoji(vi) {
  for (const [pattern, emoji] of SEMANTIC_MAP) {
    if (pattern.test(vi)) return emoji;
  }
  return null;
}

function FlashcardSentence(s) {
  const node = refs.flashcardTemplate.content.firstElementChild.cloneNode(true);
  const p = ensureProgress(s.id, s);

  // Emoji thông minh theo nghĩa câu tiếng Việt
  const smartEmoji = getSemanticEmoji(s.vietnamese);
  node.querySelector('[data-image]').textContent = smartEmoji || s.image;

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

// ═══════════════════════════════════════════════════════
//  TỪ ĐIỂN PHÂN TÍCH HÌNH VỊ TIẾNG HÀN (OFFLINE)
//  Mỗi từ/hình vị gồm: meaning_vi, root, type, origin, hanja, morphemes, note
// ═══════════════════════════════════════════════════════
const KO_LEXICON = {
  // ── Chào hỏi ──
  '좋은':   { meaning_vi:'tốt, đẹp', root:'좋다', type:'형용사', origin:'thuần hàn', hanja:'', morphemes:[{p:'좋',g:'tốt/đẹp'},{p:'은',g:'định ngữ'}], note:'좋다 khi làm tính từ bổ nghĩa cho danh từ → 좋은 + N' },
  '아침':   { meaning_vi:'buổi sáng', root:'아침', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'아침',g:'sáng'}], note:'' },
  '오후':   { meaning_vi:'buổi chiều', root:'오후', type:'명사', origin:'hán hàn', hanja:'午後', morphemes:[{p:'오',g:'ngọ/trưa'},{p:'후',g:'sau'}], note:'午後 = sau giờ ngọ' },
  '저녁':   { meaning_vi:'buổi tối', root:'저녁', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'저녁',g:'tối'}], note:'' },
  '입니다': { meaning_vi:'là / đây là (lịch sự)', root:'이다', type:'서술격조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'이',g:'là'},{p:'ㅂ니다',g:'đuôi lịch sự'}], note:'Đuôi lịch sự thể hiện N입니다 = "là N"' },
  '만나서': { meaning_vi:'vì gặp được', root:'만나다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'만나',g:'gặp'},{p:'서',g:'vì/do'}], note:'만나서 → -아서/-어서 diễn đạt lý do' },
  '반갑습니다':{ meaning_vi:'vui lòng được gặp', root:'반갑다', type:'형용사', origin:'thuần hàn', hanja:'', morphemes:[{p:'반갑',g:'vui mừng'},{p:'습니다',g:'đuôi lịch sự'}], note:'' },
  '저는':   { meaning_vi:'tôi (겸손)', root:'저', type:'대명사+조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'저',g:'tôi (khiêm)'},{p:'는',g:'chủ đề'}], note:'저 khiêm tốn hơn 나 trong hội thoại lịch sự' },
  '오늘':   { meaning_vi:'hôm nay', root:'오늘', type:'부사/명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'오늘',g:'hôm nay'}], note:'' },
  '담당':   { meaning_vi:'phụ trách', root:'담당', type:'명사', origin:'hán hàn', hanja:'擔當', morphemes:[{p:'담',g:'gánh'},{p:'당',g:'đảm nhận'}], note:'擔當 = gánh vác trách nhiệm' },
  '가이드': { meaning_vi:'hướng dẫn viên', root:'가이드', type:'명사', origin:'ngoại lai', hanja:'', morphemes:[{p:'가이드',g:'guide (Anh)'}], note:'Từ tiếng Anh "guide"' },
  '성함':   { meaning_vi:'tên (kính ngữ)', root:'성함', type:'명사', origin:'hán hàn', hanja:'姓銜', morphemes:[{p:'성',g:'họ'},{p:'함',g:'tên/danh hiệu'}], note:'Cách nói lịch sự của 이름 (tên)' },
  '어떻게': { meaning_vi:'như thế nào', root:'어떻다', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'어떻',g:'thế nào'},{p:'게',g:'trạng từ hóa'}], note:'' },
  '되세요': { meaning_vi:'là, trở thành (kính)', root:'되다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'되',g:'là/trở thành'},{p:'세요',g:'kính ngữ yêu cầu'}], note:'어떻게 되세요? = "là gì ạ?" (lịch sự)' },
  '환영합니다':{ meaning_vi:'chào mừng', root:'환영하다', type:'동사', origin:'hán hàn', hanja:'歡迎', morphemes:[{p:'환영',g:'hoan nghênh'},{p:'합니다',g:'đuôi lịch sự'}], note:'歡迎 = hoan nghênh' },
  // ── Trợ từ thông dụng ──
  '을':  { meaning_vi:'(trợ từ tân ngữ, kết thúc phụ âm)', root:'을', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'을',g:'tân ngữ'}], note:'' },
  '를':  { meaning_vi:'(trợ từ tân ngữ, kết thúc nguyên âm)', root:'를', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'를',g:'tân ngữ'}], note:'' },
  '이':  { meaning_vi:'(trợ từ chủ ngữ, kết thúc phụ âm)', root:'이', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'이',g:'chủ ngữ'}], note:'' },
  '가':  { meaning_vi:'(trợ từ chủ ngữ, kết thúc nguyên âm)', root:'가', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'가',g:'chủ ngữ'}], note:'' },
  '은':  { meaning_vi:'(chủ đề, kết thúc phụ âm)', root:'은', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'은',g:'chủ đề'}], note:'' },
  '는':  { meaning_vi:'(chủ đề, kết thúc nguyên âm)', root:'는', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'는',g:'chủ đề'}], note:'' },
  '에':  { meaning_vi:'ở, tại, đến (nơi chốn/thời gian)', root:'에', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'에',g:'tại/đến'}], note:'' },
  '에서':{ meaning_vi:'tại (nơi hành động xảy ra)', root:'에서', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'에서',g:'tại/ở'}], note:'' },
  '로':  { meaning_vi:'đến, theo hướng, bằng', root:'로', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'로',g:'hướng/phương tiện'}], note:'' },
  '으로':{ meaning_vi:'đến, theo hướng (sau phụ âm)', root:'으로', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'으로',g:'hướng/phương tiện'}], note:'' },
  '과':  { meaning_vi:'và (sau phụ âm)', root:'과', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'과',g:'và'}], note:'' },
  '와':  { meaning_vi:'và (sau nguyên âm)', root:'와', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'와',g:'và'}], note:'' },
  '도':  { meaning_vi:'cũng, nữa', root:'도', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'도',g:'cũng'}], note:'' },
  '만':  { meaning_vi:'chỉ', root:'만', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'만',g:'chỉ'}], note:'' },
  '부터':{ meaning_vi:'từ (điểm bắt đầu)', root:'부터', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'부터',g:'từ'}], note:'' },
  '까지':{ meaning_vi:'đến (điểm kết thúc)', root:'까지', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'까지',g:'đến'}], note:'' },
  '에게':{ meaning_vi:'cho, đến (người)', root:'에게', type:'조사', origin:'thuần hàn', hanja:'', morphemes:[{p:'에게',g:'cho người'}], note:'' },
  // ── Đuôi động từ / kết cấu ngữ pháp thông dụng ──
  '주세요':  { meaning_vi:'xin hãy làm (nhờ lịch sự)', root:'주다', type:'어미+존댓말', origin:'thuần hàn', hanja:'', morphemes:[{p:'주',g:'cho/làm giúp'},{p:'세요',g:'kính ngữ nhờ'}], note:'V-아/어 주세요 = "Xin hãy V giúp"' },
  '주십시오':{ meaning_vi:'xin làm ơn (rất lịch sự)', root:'주다', type:'어미+존댓말', origin:'thuần hàn', hanja:'', morphemes:[{p:'주',g:'làm giúp'},{p:'십시오',g:'kính ngữ cao'}], note:'Trang trọng hơn 주세요' },
  '겠습니다':{ meaning_vi:'sẽ... (ý định lịch sự)', root:'-겠-', type:'어미', origin:'thuần hàn', hanja:'', morphemes:[{p:'겠',g:'sẽ/dự định'},{p:'습니다',g:'lịch sự'}], note:'-겠습니다 biểu lộ ý định hoặc dự đoán lịch sự' },
  '습니다':  { meaning_vi:'(đuôi lịch sự, kết thúc phụ âm)', root:'습니다', type:'어미', origin:'thuần hàn', hanja:'', morphemes:[{p:'습니다',g:'lịch sự'}], note:'Dùng sau phụ âm cuối, tương đương với -ㅂ니다' },
  '합니다':  { meaning_vi:'làm, thực hiện (lịch sự)', root:'하다', type:'동사어미', origin:'thuần hàn', hanja:'', morphemes:[{p:'하',g:'làm'},{p:'ㅂ니다',g:'lịch sự'}], note:'하다 → 합니다 (rút gọn lịch sự)' },
  '있습니다':{ meaning_vi:'có, tồn tại (lịch sự)', root:'있다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'있',g:'có/tồn tại'},{p:'습니다',g:'lịch sự'}], note:'있다 = tồn tại / sở hữu' },
  '없습니다':{ meaning_vi:'không có, không tồn tại', root:'없다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'없',g:'không có'},{p:'습니다',g:'lịch sự'}], note:'없다 ↔ 있다' },
  '드릴게요':{ meaning_vi:'sẽ làm giúp (khiêm tốn)', root:'드리다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'드리',g:'dâng/làm giúp(kính)'},{p:'ㄹ게요',g:'hứa hẹn lịch sự'}], note:'드리다 là kính ngữ của 주다 (cho)' },
  '드릴까요':{ meaning_vi:'tôi có thể làm... không?', root:'드리다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'드리',g:'làm giúp(kính)'},{p:'ㄹ까요',g:'đề nghị/hỏi ý'}], note:'Hỏi ý kiến lịch sự' },
  '하겠습니다':{ meaning_vi:'sẽ thực hiện', root:'하다', type:'동사어미', origin:'thuần hàn', hanja:'', morphemes:[{p:'하',g:'làm'},{p:'겠',g:'sẽ'},{p:'습니다',g:'lịch sự'}], note:'' },
  '해 주세요':{ meaning_vi:'xin hãy làm', root:'하다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'해',g:'làm'},{p:'주세요',g:'xin giúp'}], note:'' },
  '주셔서':  { meaning_vi:'vì đã làm giúp (kính)', root:'주시다', type:'동사어미', origin:'thuần hàn', hanja:'', morphemes:[{p:'주시',g:'làm giúp(kính)'},{p:'어서',g:'vì/do'}], note:'' },
  '바랍니다':{ meaning_vi:'mong muốn, hi vọng', root:'바라다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'바라',g:'mong'},{p:'ㅂ니다',g:'lịch sự'}], note:'' },
  // ── Từ vựng hành động thông dụng ──
  '확인해':  { meaning_vi:'kiểm tra', root:'확인하다', type:'동사', origin:'hán hàn', hanja:'確認', morphemes:[{p:'확인',g:'xác nhận'},{p:'해',g:'làm'}], note:'確認 = xác nhận, kiểm tra' },
  '준비해':  { meaning_vi:'chuẩn bị', root:'준비하다', type:'동사', origin:'hán hàn', hanja:'準備', morphemes:[{p:'준비',g:'chuẩn bị'},{p:'해',g:'làm'}], note:'準備 = chuẩn bị sẵn' },
  '이동해':  { meaning_vi:'di chuyển', root:'이동하다', type:'동사', origin:'hán hàn', hanja:'移動', morphemes:[{p:'이동',g:'di chuyển'},{p:'해',g:'làm'}], note:'移動 = dịch chuyển' },
  '출발해':  { meaning_vi:'xuất phát', root:'출발하다', type:'동사', origin:'hán hàn', hanja:'出發', morphemes:[{p:'출발',g:'khởi hành'},{p:'해',g:'làm'}], note:'出發 = xuất phát' },
  '출발합니다':{ meaning_vi:'(chúng ta) sẽ xuất phát', root:'출발하다', type:'동사', origin:'hán hàn', hanja:'出發', morphemes:[{p:'출발',g:'khởi hành'},{p:'합니다',g:'lịch sự'}], note:'' },
  '도착합니다':{ meaning_vi:'(chúng ta) sắp đến', root:'도착하다', type:'동사', origin:'hán hàn', hanja:'到着', morphemes:[{p:'도착',g:'đến nơi'},{p:'합니다',g:'lịch sự'}], note:'到着 = đến nơi' },
  '감사합니다':{ meaning_vi:'cảm ơn', root:'감사하다', type:'동사', origin:'hán hàn', hanja:'感謝', morphemes:[{p:'감사',g:'cảm tạ'},{p:'합니다',g:'lịch sự'}], note:'感謝 = cảm tạ' },
  '죄송합니다':{ meaning_vi:'xin lỗi', root:'죄송하다', type:'형용사', origin:'hán hàn', hanja:'罪悚', morphemes:[{p:'죄송',g:'tội lỗi/xấu hổ'},{p:'합니다',g:'lịch sự'}], note:'罪悚 = tội lỗi, ngượng ngùng' },
  '실례합니다':{ meaning_vi:'xin phép, làm phiền', root:'실례하다', type:'동사', origin:'hán hàn', hanja:'失禮', morphemes:[{p:'실례',g:'thất lễ'},{p:'합니다',g:'lịch sự'}], note:'失禮 = mất lịch sự → xin thất lễ' },
  '안녕히':  { meaning_vi:'an lành (khi tạm biệt)', root:'안녕', type:'부사', origin:'hán hàn', hanja:'安寧', morphemes:[{p:'안녕',g:'bình an'},{p:'히',g:'trạng từ hóa'}], note:'安寧 = an lành, bình yên' },
  '가세요':  { meaning_vi:'xin đi, xin về', root:'가다', type:'동사', origin:'thuần hàn', hanja:'', morphemes:[{p:'가',g:'đi'},{p:'세요',g:'kính ngữ'}], note:'안녕히 가세요 = tạm biệt (người ra đi)' },
  // ── Địa điểm & phương hướng ──
  '이쪽':    { meaning_vi:'phía này, hướng này', root:'이쪽', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'이',g:'này'},{p:'쪽',g:'phía/hướng'}], note:'' },
  '저쪽':    { meaning_vi:'phía kia', root:'저쪽', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'저',g:'kia'},{p:'쪽',g:'phía'}], note:'' },
  '오른쪽':  { meaning_vi:'bên phải', root:'오른쪽', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'오른',g:'phải'},{p:'쪽',g:'phía'}], note:'' },
  '왼쪽':    { meaning_vi:'bên trái', root:'왼쪽', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'왼',g:'trái'},{p:'쪽',g:'phía'}], note:'' },
  '앞':      { meaning_vi:'phía trước', root:'앞', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'앞',g:'trước'}], note:'' },
  '뒤':      { meaning_vi:'phía sau', root:'뒤', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'뒤',g:'sau'}], note:'' },
  '여기':    { meaning_vi:'đây, chỗ này', root:'여기', type:'대명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'여기',g:'đây'}], note:'' },
  '거기':    { meaning_vi:'đó, chỗ đó', root:'거기', type:'대명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'거기',g:'đó'}], note:'' },
  '저기':    { meaning_vi:'đằng kia', root:'저기', type:'대명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'저기',g:'kia'}], note:'' },
  // ── Thời gian ──
  '지금':    { meaning_vi:'bây giờ', root:'지금', type:'부사', origin:'hán hàn', hanja:'只今', morphemes:[{p:'지금',g:'hiện tại'}], note:'只今 = ngay bây giờ' },
  '잠시':    { meaning_vi:'lát, một chút', root:'잠시', type:'부사', origin:'hán hàn', hanja:'暫時', morphemes:[{p:'잠시',g:'tạm thời'}], note:'暫時 = tạm thời, chốc lát' },
  '곧':      { meaning_vi:'sắp, ngay sau', root:'곧', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'곧',g:'sắp'}], note:'' },
  '먼저':    { meaning_vi:'trước tiên', root:'먼저', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'먼저',g:'trước'}], note:'' },
  '나중에':  { meaning_vi:'sau này, sau đó', root:'나중', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'나중',g:'sau'},{p:'에',g:'tại'}], note:'' },
  '다음':    { meaning_vi:'tiếp theo', root:'다음', type:'명사/부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'다음',g:'tiếp'}], note:'' },
  '시간':    { meaning_vi:'thời gian, giờ', root:'시간', type:'명사', origin:'hán hàn', hanja:'時間', morphemes:[{p:'시',g:'giờ'},{p:'간',g:'khoảng'}], note:'時間 = khoảng thời gian' },
  '분':      { meaning_vi:'phút', root:'분', type:'의존명사', origin:'hán hàn', hanja:'分', morphemes:[{p:'분',g:'phút'}], note:'分 = phần/phút' },
  // ── Số từ thông dụng ──
  '일':  { meaning_vi:'một (Hán)', root:'일', type:'수사', origin:'hán hàn', hanja:'一', morphemes:[{p:'일',g:'1'}], note:'' },
  '이':  { meaning_vi:'hai (Hán)', root:'이', type:'수사', origin:'hán hàn', hanja:'二', morphemes:[{p:'이',g:'2'}], note:'' },
  '삼':  { meaning_vi:'ba (Hán)', root:'삼', type:'수사', origin:'hán hàn', hanja:'三', morphemes:[{p:'삼',g:'3'}], note:'' },
  '오':  { meaning_vi:'năm (Hán)', root:'오', type:'수사', origin:'hán hàn', hanja:'五', morphemes:[{p:'오',g:'5'}], note:'' },
  '십':  { meaning_vi:'mười (Hán)', root:'십', type:'수사', origin:'hán hàn', hanja:'十', morphemes:[{p:'십',g:'10'}], note:'' },
  // ── Từ thông dụng du lịch ──
  '버스':    { meaning_vi:'xe buýt', root:'버스', type:'명사', origin:'ngoại lai', hanja:'', morphemes:[{p:'버스',g:'bus(Anh)'}], note:'Từ tiếng Anh "bus"' },
  '호텔':    { meaning_vi:'khách sạn', root:'호텔', type:'명사', origin:'ngoại lai', hanja:'', morphemes:[{p:'호텔',g:'hotel(Anh)'}], note:'' },
  '여권':    { meaning_vi:'hộ chiếu', root:'여권', type:'명사', origin:'hán hàn', hanja:'旅券', morphemes:[{p:'여',g:'du lịch'},{p:'권',g:'giấy tờ'}], note:'旅券 = giấy du hành' },
  '탑승권':  { meaning_vi:'thẻ lên tàu/máy bay', root:'탑승권', type:'명사', origin:'hán hàn', hanja:'搭乘券', morphemes:[{p:'탑승',g:'lên tàu'},{p:'권',g:'vé/phiếu'}], note:'搭乘券 = vé lên phương tiện' },
  '수하물':  { meaning_vi:'hành lý ký gửi', root:'수하물', type:'명사', origin:'hán hàn', hanja:'手荷物', morphemes:[{p:'수',g:'tay'},{p:'하물',g:'hàng hóa'}], note:'手荷物 = đồ mang tay' },
  '입국':    { meaning_vi:'nhập cảnh', root:'입국', type:'명사', origin:'hán hàn', hanja:'入國', morphemes:[{p:'입',g:'vào'},{p:'국',g:'nước'}], note:'入國 = vào nước' },
  '심사':    { meaning_vi:'kiểm tra, xét duyệt', root:'심사', type:'명사', origin:'hán hàn', hanja:'審査', morphemes:[{p:'심',g:'xem xét'},{p:'사',g:'tra xét'}], note:'審査 = kiểm tra kỹ' },
  '공항':    { meaning_vi:'sân bay', root:'공항', type:'명사', origin:'hán hàn', hanja:'空港', morphemes:[{p:'공',g:'trời/không khí'},{p:'항',g:'bến/cảng'}], note:'空港 = cảng hàng không' },
  '사진':    { meaning_vi:'ảnh, hình', root:'사진', type:'명사', origin:'hán hàn', hanja:'寫眞', morphemes:[{p:'사',g:'chụp/sao chép'},{p:'진',g:'thật/chân thực'}], note:'寫眞 = chụp chân thực' },
  '안전':    { meaning_vi:'an toàn', root:'안전', type:'명사/형용사', origin:'hán hàn', hanja:'安全', morphemes:[{p:'안',g:'an'},{p:'전',g:'toàn'}], note:'安全 = bình an toàn vẹn' },
  '화장실':  { meaning_vi:'nhà vệ sinh', root:'화장실', type:'명사', origin:'hán hàn', hanja:'化粧室', morphemes:[{p:'화장',g:'trang điểm'},{p:'실',g:'phòng'}], note:'化粧室 = phòng trang điểm' },
  '일정':    { meaning_vi:'lịch trình', root:'일정', type:'명사', origin:'hán hàn', hanja:'日程', morphemes:[{p:'일',g:'ngày'},{p:'정',g:'chương trình'}], note:'日程 = chương trình theo ngày' },
  '관광':    { meaning_vi:'tham quan, du lịch', root:'관광', type:'명사', origin:'hán hàn', hanja:'觀光', morphemes:[{p:'관',g:'xem'},{p:'광',g:'phong cảnh'}], note:'觀光 = ngắm phong cảnh' },
  '설명':    { meaning_vi:'giải thích, thuyết minh', root:'설명', type:'명사', origin:'hán hàn', hanja:'說明', morphemes:[{p:'설',g:'nói'},{p:'명',g:'rõ ràng'}], note:'說明 = nói rõ' },
  '휴식':    { meaning_vi:'nghỉ ngơi', root:'휴식', type:'명사', origin:'hán hàn', hanja:'休息', morphemes:[{p:'휴',g:'nghỉ'},{p:'식',g:'hơi thở'}], note:'休息 = nghỉ ngơi lấy sức' },
  '식당':    { meaning_vi:'nhà hàng, quán ăn', root:'식당', type:'명사', origin:'hán hàn', hanja:'食堂', morphemes:[{p:'식',g:'ăn'},{p:'당',g:'nhà/nơi'}], note:'食堂 = nơi ăn uống' },
  '음식':    { meaning_vi:'đồ ăn, thức ăn', root:'음식', type:'명사', origin:'hán hàn', hanja:'飮食', morphemes:[{p:'음',g:'uống'},{p:'식',g:'ăn'}], note:'飮食 = ăn uống' },
  '케이블카':{ meaning_vi:'cáp treo', root:'케이블카', type:'명사', origin:'ngoại lai', hanja:'', morphemes:[{p:'케이블',g:'cable(Anh)'},{p:'카',g:'car(Anh)'}], note:'Từ tiếng Anh "cable car"' },
  '바나힐':  { meaning_vi:'Bà Nà Hills', root:'바나힐', type:'명사', origin:'ngoại lai', hanja:'', morphemes:[{p:'바나힐',g:'Bà Nà Hills'}], note:'Địa danh du lịch Đà Nẵng' },
  '날씨':    { meaning_vi:'thời tiết', root:'날씨', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'날',g:'ngày'},{p:'씨',g:'trạng thái'}], note:'' },
  '물':      { meaning_vi:'nước', root:'물', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'물',g:'nước'}], note:'' },
  '사람':    { meaning_vi:'người', root:'사람', type:'명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'사람',g:'người'}], note:'' },
  '분':      { meaning_vi:'quý vị (kính)', root:'분', type:'의존명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'분',g:'người (kính)'}], note:'Cách gọi lịch sự hơn 사람' },
  '함께':    { meaning_vi:'cùng nhau', root:'함께', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'함께',g:'cùng'}], note:'' },
  '잘':      { meaning_vi:'tốt, giỏi', root:'잘', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'잘',g:'tốt/giỏi'}], note:'' },
  '모두':    { meaning_vi:'tất cả, mọi người', root:'모두', type:'부사/대명사', origin:'thuần hàn', hanja:'', morphemes:[{p:'모두',g:'tất cả'}], note:'' },
  '바로':    { meaning_vi:'ngay, liền', root:'바로', type:'부사', origin:'thuần hàn', hanja:'', morphemes:[{p:'바로',g:'ngay'}], note:'' },
  '정말':    { meaning_vi:'thật sự, thực sự', root:'정말', type:'부사', origin:'hán hàn', hanja:'正말', morphemes:[{p:'정말',g:'thật sự'}], note:'' },
  '네':      { meaning_vi:'vâng, có', root:'네', type:'감탄사', origin:'thuần hàn', hanja:'', morphemes:[{p:'네',g:'vâng'}], note:'' },
  '아니요':  { meaning_vi:'không, không phải', root:'아니요', type:'감탄사', origin:'thuần hàn', hanja:'', morphemes:[{p:'아니요',g:'không'}], note:'' },
};

// Các hậu tố phổ biến để nhận diện loại từ
const SUFFIX_RULES = [
  { sfx:'겠습니다', type:'동사 (ý định lịch sự)', root_fn: w => w.replace('겠습니다','') + '다' },
  { sfx:'합니다',  type:'동사 (lịch sự)',         root_fn: w => w.replace('합니다','하다') },
  { sfx:'습니다',  type:'동사/형용사 (lịch sự)',   root_fn: w => w.replace('습니다','다') },
  { sfx:'ㅂ니다',  type:'동사/형용사 (lịch sự)',   root_fn: w => w + '다' },
  { sfx:'세요',    type:'동사 (kính ngữ nhờ)',      root_fn: w => w.replace('세요','다') },
  { sfx:'하세요',  type:'동사 (kính ngữ nhờ)',      root_fn: w => w.replace('세요','다') },
  { sfx:'해요',    type:'동사 (thân mật lịch sự)',  root_fn: w => w.replace('해요','하다') },
  { sfx:'아요',    type:'동사 (thân mật lịch sự)',  root_fn: w => w.replace('아요','') + '다' },
  { sfx:'어요',    type:'동사 (thân mật lịch sự)',  root_fn: w => w.replace('어요','') + '다' },
  { sfx:'주세요',  type:'동사 (nhờ lịch sự)',       root_fn: w => '주다 + kính ngữ' },
  { sfx:'십시오',  type:'동사 (mệnh lệnh trang trọng)', root_fn: w => w.replace('십시오','') + '다' },
  { sfx:'ㄹ게요',  type:'동사 (hứa hẹn)',           root_fn: w => w + '다' },
  { sfx:'ㄹ까요',  type:'동사 (hỏi ý/đề nghị)',     root_fn: w => w + '다' },
  { sfx:'은/는/이/가', type:'조사', root_fn: w => w },
];

const HANJA_STEMS = ['감사','죄송','실례','확인','준비','이동','출발','도착','안전','화장','일정','관광','설명','휴식','식당','음식','여권','탑승','수하물','입국','심사','공항','사진','시간','정말','현재','지금','안내','관리','연락','문제','변경','일정','방문','장소','이동','예정','종료'];

function guessOriginKo(w) {
  if (/[a-zA-Z]/.test(w)) return 'ngoại lai';
  // Kiểm tra gốc Hán
  for (const stem of HANJA_STEMS) { if (w.includes(stem)) return 'hán hàn'; }
  return 'thuần hàn';
}

function guessTypeKo(w) {
  if (w.endsWith('합니다') || w.endsWith('습니다') || w.endsWith('겠습니다')) return '동사 (lịch sự)';
  if (w.endsWith('세요') || w.endsWith('십시오')) return '동사 (kính ngữ)';
  if (w.endsWith('이다') || w.endsWith('입니다')) return '서술격조사';
  if (w.endsWith('이') || w.endsWith('가') || w.endsWith('을') || w.endsWith('를') || w.endsWith('은') || w.endsWith('는') || w.endsWith('에') || w.endsWith('로') || w.endsWith('도') || w.endsWith('만')) return '조사';
  return '명사/기타';
}

function guessRootKo(w) {
  for (const rule of SUFFIX_RULES) {
    if (w.endsWith(rule.sfx)) { try { return rule.root_fn(w); } catch { return w; } }
  }
  return w;
}

function typeLabel(type) {
  const map = {
    '동사':'🔴 Động từ (동사)', '형용사':'🟣 Tính từ (형용사)',
    '명사':'🟠 Danh từ (명사)', '부사':'🟡 Trạng từ (부사)',
    '조사':'⚫ Trợ từ (조사)', '어미':'🔵 Đuôi ngữ pháp (어미)',
    '대명사':'🟢 Đại từ (대명사)', '감탄사':'🩷 Thán từ (감탄사)',
    '수사':'🔢 Số từ (수사)', '의존명사':'🟤 Danh từ phụ thuộc',
    '서술격조사':'🔵 Vị ngữ tố (서술격조사)', '접속사':'🩵 Liên từ (접속사)',
    'ngoại lai':'⚪ Ngoại lai (외래어)',
  };
  for (const [k, v] of Object.entries(map)) { if (type.includes(k)) return v; }
  return '◻️ ' + type;
}

function originLabel(origin, hanja) {
  if (origin === 'thuần hàn') return { cls:'tag-native', label:'🟡 Thuần Hàn (고유어)' };
  if (origin === 'hán hàn')   return { cls:'tag-sino',   label:`🔵 Hán Hàn (한자어)${hanja ? ' — ' + hanja : ''}` };
  return { cls:'tag-unknown', label:'⚪ Ngoại lai / Khác (외래어)' };
}

async function renderAnalysis(root, s) {
  root.innerHTML = '';
  const analysis = buildAnalysisOffline(s.korean);
  analysis.forEach(item => {
    const { cls, label } = originLabel(item.origin, item.hanja);
    const morphHtml = item.morphemes && item.morphemes.length > 1
      ? `<div class="morpheme-row">${item.morphemes.map(m => `<span class="morpheme-chip"><span class="morpheme-ko">${m.p}</span><span class="morpheme-gloss">${m.g}</span></span>`).join('<span class="morpheme-plus">+</span>')}</div>` : '';

    const row = document.createElement('article');
    row.className = 'word-item';
    row.innerHTML = `
      <div class="word-head">
        <div class="word-head-left">
          <strong class="word-ko">${item.word}</strong>
          ${item.root && item.root !== item.word ? `<span class="word-root">← gốc: ${item.root}</span>` : ''}
        </div>
        <button class="AudioButton" title="Nghe">🔊</button>
      </div>
      ${morphHtml}
      <p class="word-meaning">📖 ${item.meaning_vi}</p>
      <div class="word-tags">
        <span class="type-tag">${typeLabel(item.type)}</span>
        <span class="origin-tag ${cls}">${label}</span>
      </div>
      ${item.note ? `<p class="word-note">💡 ${item.note}</p>` : ''}
    `;
    row.querySelector('.AudioButton').addEventListener('click', () => speak(item.word, 0.8));
    root.append(row);
  });
}

function buildAnalysisOffline(sentence) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  return words.map(w => {
    // 1. Tra từ điển chính xác
    if (KO_LEXICON[w]) return { word: w, ...KO_LEXICON[w] };

    // 2. Thử bỏ trợ từ cuối rồi tra lại
    const stripped = w.replace(/[은는이가을를에서도만로으로와과]$/, '');
    if (stripped !== w && KO_LEXICON[stripped]) {
      const entry = { ...KO_LEXICON[stripped] };
      entry.word = w;
      entry.root = entry.root || stripped;
      return entry;
    }

    // 3. Nhận diện qua suffix rules
    for (const rule of SUFFIX_RULES) {
      if (w.endsWith(rule.sfx)) {
        const stem = w.slice(0, w.length - rule.sfx.length);
        const lookup = KO_LEXICON[stem] || KO_LEXICON[stem + '하다'];
        return {
          word: w, meaning_vi: lookup ? lookup.meaning_vi + ' (biến thể)' : `từ "${w}"`,
          root: lookup ? lookup.root : guessRootKo(w),
          type: rule.type, origin: guessOriginKo(w),
          hanja: lookup?.hanja || '', morphemes: lookup?.morphemes || [],
          note: lookup?.note || ''
        };
      }
    }

    // 4. Fallback thông minh
    return {
      word: w, meaning_vi: `từ "${w}"`,
      root: guessRootKo(w), type: guessTypeKo(w),
      origin: guessOriginKo(w), hanja: '', morphemes: [], note: ''
    };
  });
}

async function buildAnalysisAuto(sentence) {
  return buildAnalysisOffline(sentence);
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
