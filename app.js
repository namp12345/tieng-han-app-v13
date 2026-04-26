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
  if (state.view === 'mytab') return renderMyTab();
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

// ═══════════════════════════════════════════════════════════════
//  HỆ THỐNG PHÂN TÍCH TIẾNG HÀN — OFFLINE, ĐẦY ĐỦ NGHĨA TIẾNG VIỆT
// ═══════════════════════════════════════════════════════════════

// ── 1. Từ điển gốc (stem dictionary) ─────────────────────────
const STEM_DICT = {
  // Động từ thuần Hàn
  '가다':['đi','동사','thuần hàn',''],
  '오다':['đến','동사','thuần hàn',''],
  '보다':['xem, nhìn','동사','thuần hàn',''],
  '오다':['đến','동사','thuần hàn',''],
  '서다':['đứng','동사','thuần hàn',''],
  '앉다':['ngồi','동사','thuần hàn',''],
  '있다':['có, tồn tại','동사','thuần hàn',''],
  '없다':['không có','동사','thuần hàn',''],
  '되다':['trở thành, được','동사','thuần hàn',''],
  '하다':['làm','동사','thuần hàn',''],
  '주다':['cho, đưa','동사','thuần hàn',''],
  '드리다':['dâng, làm giúp (kính)','동사','thuần hàn',''],
  '받다':['nhận','동사','thuần hàn',''],
  '오르다':['lên, leo','동사','thuần hàn',''],
  '내리다':['xuống, hạ','동사','thuần hàn',''],
  '이동하다':['di chuyển','동사','hán hàn','移動'],
  '출발하다':['xuất phát','동사','hán hàn','出發'],
  '도착하다':['đến nơi','동사','hán hàn','到着'],
  '확인하다':['kiểm tra, xác nhận','동사','hán hàn','確認'],
  '준비하다':['chuẩn bị','동사','hán hàn','準備'],
  '안내하다':['hướng dẫn','동사','hán hàn','案內'],
  '설명하다':['giải thích','동사','hán hàn','說明'],
  '이용하다':['sử dụng','동사','hán hàn','利用'],
  '필요하다':['cần thiết','형용사','hán hàn','必要'],
  '가능하다':['có thể, được','형용사','hán hàn','可能'],
  '감사하다':['cảm ơn, biết ơn','동사','hán hàn','感謝'],
  '죄송하다':['xin lỗi','형용사','hán hàn','罪悚'],
  '실례하다':['làm phiền','동사','hán hàn','失禮'],
  '환영하다':['chào mừng','동사','hán hàn','歡迎'],
  '탑승하다':['lên tàu/xe/máy bay','동사','hán hàn','搭乘'],
  '진행하다':['tiến hành','동사','hán hàn','進行'],
  '변경하다':['thay đổi','동사','hán hàn','變更'],
  '예약하다':['đặt trước','동사','hán hàn','豫約'],
  '연결하다':['kết nối','동사','hán hàn','連結'],
  '연락하다':['liên lạc','동사','hán hàn','連絡'],
  '관리하다':['quản lý','동사','hán hàn','管理'],
  '공유하다':['chia sẻ','동사','hán hàn','共有'],
  '구매하다':['mua','동사','hán hàn','購買'],
  '결제하다':['thanh toán','동사','hán hàn','決濟'],
  '신고하다':['khai báo, tố cáo','동사','hán hàn','申告'],
  '촬영하다':['quay phim, chụp ảnh','동사','hán hàn','撮影'],
  '수거하다':['thu gom','동사','hán hàn','收去'],
  '보관하다':['bảo quản, giữ','동사','hán hàn','保管'],
  '방문하다':['thăm, viếng','동사','hán hàn','訪問'],
  '주문하다':['đặt hàng, gọi món','동사','hán hàn','注文'],
  '추천하다':['giới thiệu, đề xuất','동사','hán hàn','推薦'],
  '협조하다':['hợp tác','동사','hán hàn','協助'],
  '엄수하다':['tuân thủ nghiêm','동사','hán hàn','嚴守'],
  '삼가다':['kiêng, tránh','동사','thuần hàn',''],
  '챙기다':['chuẩn bị, mang theo','동사','thuần hàn',''],
  '기다리다':['chờ đợi','동사','thuần hàn',''],
  '모이다':['tập hợp','동사','thuần hàn',''],
  '도와주다':['giúp đỡ','동사','thuần hàn',''],
  '돌아오다':['quay lại','동사','thuần hàn',''],
  '올라가다':['đi lên','동사','thuần hàn',''],
  '내려가다':['đi xuống','동사','thuần hàn',''],
  '따라오다':['đi theo','동사','thuần hàn',''],
  '말씀하다':['nói (kính)','동사','thuần hàn',''],
  '물어보다':['hỏi','동사','thuần hàn',''],
  '알려주다':['thông báo, cho biết','동사','thuần hàn',''],
  '찍다':['chụp (ảnh)','동사','thuần hàn',''],
  '사다':['mua','동사','thuần hàn',''],
  '쉬다':['nghỉ ngơi','동사','thuần hàn',''],
  '열다':['mở','동사','thuần hàn',''],
  '닫다':['đóng','동사','thuần hàn',''],
  '잡다':['nắm, giữ','동사','thuần hàn',''],
  '매다':['buộc, thắt','동사','thuần hàn',''],
  '넣다':['bỏ vào','동사','thuần hàn',''],
  '빼다':['lấy ra, trừ','동사','thuần hàn',''],
  '담다':['đựng, đặt vào','동사','thuần hàn',''],
  '맞추다':['chỉnh, căn chỉnh','동사','thuần hàn',''],
  '지키다':['giữ, bảo vệ','동사','thuần hàn',''],
  '바라다':['mong muốn','동사','thuần hàn',''],
  '만나다':['gặp','동사','thuần hàn',''],
  '모셔다드리다':['đưa đi (kính)','동사','thuần hàn',''],
  '걱정하다':['lo lắng','동사','hán hàn',''],
  // Tính từ
  '좋다':['tốt, đẹp','형용사','thuần hàn',''],
  '괜찮다':['ổn, được','형용사','thuần hàn',''],
  '없다':['không có','형용사','thuần hàn',''],
  '크다':['lớn, to','형용사','thuần hàn',''],
  '작다':['nhỏ, bé','형용사','thuần hàn',''],
  '많다':['nhiều','형용사','thuần hàn',''],
  '적다':['ít','형용사','thuần hàn',''],
  '길다':['dài','형용사','thuần hàn',''],
  '짧다':['ngắn','형용사','thuần hàn',''],
  '높다':['cao','형용사','thuần hàn',''],
  '낮다':['thấp','형용사','thuần hàn',''],
  '안전하다':['an toàn','형용사','hán hàn','安全'],
  '편안하다':['thoải mái','형용사','hán hàn','便安'],
  '충분하다':['đủ, đầy đủ','형용사','hán hàn','充分'],
  '중요하다':['quan trọng','형용사','hán hàn','重要'],
  '위험하다':['nguy hiểm','형용사','hán hàn','危險'],
  '아름답다':['đẹp','형용사','thuần hàn',''],
  '뜨겁다':['nóng','형용사','thuần hàn',''],
  '미끄럽다':['trơn','형용사','thuần hàn',''],
  '좁다':['hẹp','형용사','thuần hàn',''],
  '반갑다':['vui mừng khi gặp','형용사','thuần hàn',''],
  // Danh từ phổ biến
  '아침':['buổi sáng','명사','thuần hàn',''],
  '점심':['bữa trưa, buổi trưa','명사','thuần hàn',''],
  '저녁':['buổi tối, bữa tối','명사','thuần hàn',''],
  '오전':['buổi sáng (trước trưa)','명사','hán hàn','午前'],
  '오후':['buổi chiều (sau trưa)','명사','hán hàn','午後'],
  '오늘':['hôm nay','명사/부사','thuần hàn',''],
  '내일':['ngày mai','명사','thuần hàn',''],
  '시간':['thời gian, giờ','명사','hán hàn','時間'],
  '분':['phút / quý vị (kính)','의존명사','hán hàn','分'],
  '시':['giờ (đồng hồ)','의존명사','hán hàn','時'],
  '날':['ngày, thời tiết','명사','thuần hàn',''],
  '날씨':['thời tiết','명사','thuần hàn',''],
  '장소':['địa điểm, nơi chốn','명사','hán hàn','場所'],
  '장소':['địa điểm','명사','hán hàn','場所'],
  '일정':['lịch trình','명사','hán hàn','日程'],
  '일정표':['bảng lịch trình','명사','hán hàn','日程表'],
  '관광':['tham quan, du lịch','명사','hán hàn','觀光'],
  '관광지':['điểm tham quan','명사','hán hàn','觀光地'],
  '관람':['xem, tham quan','명사','hán hàn','觀覽'],
  '설명':['giải thích, thuyết minh','명사','hán hàn','說明'],
  '안내':['hướng dẫn','명사','hán hàn','案內'],
  '이동':['di chuyển','명사','hán hàn','移動'],
  '출발':['xuất phát','명사','hán hàn','出發'],
  '도착':['đến nơi','명사','hán hàn','到着'],
  '탑승':['lên xe/tàu/máy bay','명사','hán hàn','搭乘'],
  '탑승권':['thẻ lên máy bay','명사','hán hàn','搭乘券'],
  '여권':['hộ chiếu','명사','hán hàn','旅券'],
  '수하물':['hành lý','명사','hán hàn','手荷物'],
  '공항':['sân bay','명사','hán hàn','空港'],
  '버스':['xe buýt','명사','ngoại lai',''],
  '호텔':['khách sạn','명사','ngoại lai',''],
  '식당':['nhà hàng, quán ăn','명사','hán hàn','食堂'],
  '음식':['đồ ăn, thức ăn','명사','hán hàn','飮食'],
  '음료':['đồ uống','명사','hán hàn','飮料'],
  '물':['nước','명사','thuần hàn',''],
  '사진':['ảnh, hình','명사','hán hàn','寫眞'],
  '화장실':['nhà vệ sinh','명사','hán hàn','化粧室'],
  '안전':['an toàn','명사','hán hàn','安全'],
  '비상구':['lối thoát hiểm','명사','hán hàn','非常口'],
  '구명조끼':['áo phao','명사','hán hàn','救命'],
  '보험':['bảo hiểm','명사','hán hàn','保險'],
  '약':['thuốc','명사','hán hàn','藥'],
  '병원':['bệnh viện','명사','hán hàn','病院'],
  '짐':['hành lý, đồ đạc','명사','thuần hàn',''],
  '가방':['túi, ba lô','명사','thuần hàn',''],
  '소지품':['đồ cá nhân','명사','hán hàn','所持品'],
  '귀중품':['đồ quý giá','명사','hán hàn','貴重品'],
  '분실물':['đồ thất lạc','명사','hán hàn','紛失物'],
  '영수증':['hóa đơn, biên lai','명사','hán hàn','領收證'],
  '결제':['thanh toán','명사','hán hàn','決濟'],
  '현금':['tiền mặt','명사','hán hàn','現金'],
  '카드':['thẻ (tín dụng)','명사','ngoại lai',''],
  '환전':['đổi tiền','명사','hán hàn','換錢'],
  '기념품':['quà lưu niệm','명사','hán hàn','記念品'],
  '특산품':['đặc sản','명사','hán hàn','特産品'],
  '쇼핑':['mua sắm','명사','ngoại lai',''],
  '면세점':['cửa hàng miễn thuế','명사','hán hàn','免稅店'],
  '시장':['chợ','명사','hán hàn','市場'],
  '야시장':['chợ đêm','명사','hán hàn','夜市場'],
  '케이블카':['cáp treo','명사','ngoại lai',''],
  '바나힐':['Bà Nà Hills','명사','ngoại lai',''],
  '다낭':['Đà Nẵng','명사','ngoại lai',''],
  '호이안':['Hội An','명사','ngoại lai',''],
  '한강':['sông Hàn','명사','hán hàn','漢江'],
  '한국':['Hàn Quốc','명사','hán hàn','韓國'],
  '베트남':['Việt Nam','명사','ngoại lai',''],
  '가이드':['hướng dẫn viên','명사','ngoại lai',''],
  '투어':['tour du lịch','명사','ngoại lai',''],
  '단체':['đoàn, tập thể','명사','hán hàn','團體'],
  '팀원':['thành viên nhóm','명사','hán hàn','팀員'],
  '인원':['số người','명사','hán hàn','人員'],
  '담당':['phụ trách','명사','hán hàn','擔當'],
  '성함':['tên (kính ngữ)','명사','hán hàn','姓銜'],
  '이름':['tên','명사','thuần hàn',''],
  '번호':['số hiệu','명사','hán hàn','番號'],
  '좌석':['chỗ ngồi, ghế','명사','hán hàn','座席'],
  '자리':['chỗ, vị trí','명사','thuần hàn',''],
  '창문':['cửa sổ','명사','hán hàn','窓門'],
  '문':['cửa','명사','hán hàn','門'],
  '계단':['cầu thang','명사','hán hàn','階段'],
  '층':['tầng (lầu)','명사','hán hàn','層'],
  '안전벨트':['dây an toàn','명사','hán+ngoại','安全belt'],
  '에어컨':['điều hòa không khí','명사','ngoại lai',''],
  '와이파이':['wifi','명사','ngoại lai',''],
  '유심카드':['sim card','명사','ngoại lai',''],
  '핸드폰':['điện thoại di động','명사','ngoại lai',''],
  '배터리':['pin (battery)','명사','ngoại lai',''],
  '연락처':['thông tin liên lạc','명사','hán hàn','連絡處'],
  '카카오톡':['KakaoTalk','명사','ngoại lai',''],
  '카톡':['KakaoTalk (viết tắt)','명사','ngoại lai',''],
  '단톡방':['nhóm chat','명사','ngoại lai',''],
  '문자':['tin nhắn văn bản','명사','hán hàn','文字'],
  '전화':['điện thoại, cuộc gọi','명사','hán hàn','電話'],
  '후기':['đánh giá, nhận xét','명사','hán hàn','後記'],
  '통역':['phiên dịch','명사','hán hàn','通譯'],
  '번역':['dịch thuật','명사','hán hàn','飜譯'],
  '알레르기':['dị ứng','명사','ngoại lai',''],
  '채식':['ăn chay','명사','hán hàn','菜食'],
  '해산물':['hải sản','명사','hán hàn','海産物'],
  '고수':['rau mùi (ngò)','명사','hán hàn',''],
  '얼음':['đá (lạnh)','명사','thuần hàn',''],
  '조식':['bữa sáng (khách sạn)','명사','hán hàn','朝食'],
  '룸서비스':['phục vụ phòng','명사','ngoại lai',''],
  '체크인':['check-in','명사','ngoại lai',''],
  '체크아웃':['check-out','명사','ngoại lai',''],
  '객실':['phòng khách sạn','명사','hán hàn','客室'],
  '열쇠':['chìa khóa','명사','thuần hàn',''],
  '금고':['két an toàn','명사','hán hàn','金庫'],
  '비밀번호':['mật khẩu','명사','hán hàn','秘密番號'],
  '세탁':['giặt giũ','명사','hán hàn','洗濯'],
  '수건':['khăn tắm','명사','hán hàn','手巾'],
  '온수':['nước nóng','명사','hán hàn','溫水'],
  '미니바':['minibar','명사','ngoại lai',''],
  '전망':['tầm nhìn, cảnh quan','명사','hán hàn','展望'],
  '야경':['cảnh đêm','명사','hán hàn','夜景'],
  '포토존':['khu chụp ảnh','명사','ngoại lai',''],
  '명소':['địa điểm nổi tiếng','명사','hán hàn','名所'],
  '전통':['truyền thống','명사','hán hàn','傳統'],
  '문화재':['di sản văn hóa','명사','hán hàn','文化財'],
  '사찰':['chùa chiền','명사','hán hàn','寺刹'],
  '불상':['tượng Phật','명사','hán hàn','佛像'],
  '등불':['đèn lồng','명사','hán+thuần','燈'],
  '소원등':['đèn cầu nguyện','명사','hán hàn','所願燈'],
  '고도':['độ cao','명사','hán hàn','高度'],
  '안개':['sương mù','명사','thuần hàn',''],
  '바람':['gió','명사','thuần hàn',''],
  '비':['mưa','명사','thuần hàn',''],
  '우산':['ô (dù)','명사','hán hàn','雨傘'],
  '겉옷':['áo khoác ngoài','명사','thuần hàn',''],
  '모자':['mũ','명사','hán hàn','帽子'],
  '신발':['giày dép','명사','thuần hàn',''],
  '의상':['trang phục','명사','hán hàn','衣裳'],
  '향':['hương (nhang)','명사','hán hàn','香'],
  '규정':['quy định','명사','hán hàn','規定'],
  '예절':['lễ nghi, phép tắc','명사','hán hàn','禮節'],
  '예의':['lễ phép','명사','hán hàn','禮儀'],
  '경찰서':['đồn cảnh sát','명사','hán hàn','警察署'],
  '응급차':['xe cấp cứu','명사','hán hàn','應急車'],
  '사고':['tai nạn, sự cố','명사','hán hàn','事故'],
  '보험':['bảo hiểm','명사','hán hàn','保險'],
  '증상':['triệu chứng','명사','hán hàn','症狀'],
  '약국':['nhà thuốc','명사','hán hàn','藥局'],
  // Trạng từ & Liên từ
  '지금':['bây giờ','부사','hán hàn','只今'],
  '잠시':['lát, một chút','부사','hán hàn','暫時'],
  '곧':['sắp, ngay','부사','thuần hàn',''],
  '먼저':['trước tiên','부사','thuần hàn',''],
  '바로':['ngay, liền','부사','thuần hàn',''],
  '다시':['lại, lần nữa','부사','thuần hàn',''],
  '천천히':['từ từ, chậm rãi','부사','thuần hàn',''],
  '빨리':['nhanh','부사','thuần hàn',''],
  '조금':['một chút, ít','부사','thuần hàn',''],
  '많이':['nhiều','부사','thuần hàn',''],
  '잘':['tốt, giỏi','부사','thuần hàn',''],
  '모두':['tất cả','부사','thuần hàn',''],
  '다':['tất cả, đủ','부사','thuần hàn',''],
  '꼭':['nhất định, chắc chắn','부사','thuần hàn',''],
  '반드시':['nhất định phải','부사','thuần hàn',''],
  '항상':['luôn luôn','부사','hán hàn','恒常'],
  '함께':['cùng nhau','부사','thuần hàn',''],
  '따로':['riêng, tách biệt','부사','thuần hàn',''],
  '별도로':['riêng biệt, đặc biệt','부사','hán hàn','別途'],
  '정말':['thật sự','부사','thuần hàn',''],
  '너무':['quá, rất','부사','thuần hàn',''],
  '아주':['rất','부사','thuần hàn',''],
  '자세히':['chi tiết, tỉ mỉ','부사','hán hàn','仔細'],
  '충분히':['đầy đủ, đủ','부사','hán hàn','充分'],
  '안전하게':['một cách an toàn','부사','hán hàn','安全'],
  '조용히':['yên lặng, im lặng','부사','thuần hàn',''],
  '차례대로':['theo thứ tự','부사','hán hàn','次例'],
  '침착하게':['bình tĩnh','부사','hán hàn','沈着'],
  '다음':['tiếp theo','부사/명사','thuần hàn',''],
  '각':['mỗi, từng','관형사','hán hàn','各'],
  '약':['khoảng, xấp xỉ','부사','hán hàn','約'],
  // Đại từ & Định từ
  '저':['tôi (khiêm)','대명사','thuần hàn',''],
  '제':['của tôi (khiêm)','대명사','thuần hàn',''],
  '저희':['chúng tôi (khiêm)','대명사','thuần hàn',''],
  '우리':['chúng ta, chúng tôi','대명사','thuần hàn',''],
  '여기':['đây, chỗ này','대명사','thuần hàn',''],
  '거기':['đó, chỗ đó','대명사','thuần hàn',''],
  '저기':['đằng kia','대명사','thuần hàn',''],
  '이쪽':['phía này','명사','thuần hàn',''],
  '저쪽':['phía kia','명사','thuần hàn',''],
  '오른쪽':['bên phải','명사','thuần hàn',''],
  '왼쪽':['bên trái','명사','thuần hàn',''],
  '앞':['phía trước','명사','thuần hàn',''],
  '뒤':['phía sau','명사','thuần hàn',''],
  '안':['bên trong','명사','thuần hàn',''],
  '밖':['bên ngoài','명사','thuần hàn',''],
  '옆':['bên cạnh','명사','thuần hàn',''],
  // Số từ Hán
  '일':['một','수사','hán hàn','一'],
  '이':['hai','수사','hán hàn','二'],
  '삼':['ba','수사','hán hàn','三'],
  '사':['bốn','수사','hán hàn','四'],
  '오':['năm','수사','hán hàn','五'],
  '육':['sáu','수사','hán hàn','六'],
  '칠':['bảy','수사','hán hàn','七'],
  '팔':['tám','수사','hán hàn','八'],
  '구':['chín','수사','hán hàn','九'],
  '십':['mười','수사','hán hàn','十'],
  '이십':['hai mươi','수사','hán hàn','二十'],
  '삼십':['ba mươi','수사','hán hàn','三十'],
  '사십':['bốn mươi','수사','hán hàn','四十'],
  '오십':['năm mươi','수사','hán hàn','五十'],
  // Số từ thuần Hàn
  '하나':['một (thuần)','수사','thuần hàn',''],
  '둘':['hai (thuần)','수사','thuần hàn',''],
  '셋':['ba (thuần)','수사','thuần hàn',''],
  '넷':['bốn (thuần)','수사','thuần hàn',''],
  '다섯':['năm (thuần)','수사','thuần hàn',''],
  '여섯':['sáu (thuần)','수사','thuần hàn',''],
  '일곱':['bảy (thuần)','수사','thuần hàn',''],
  '여덟':['tám (thuần)','수사','thuần hàn',''],
  '아홉':['chín (thuần)','수사','thuần hàn',''],
  '열':['mười (thuần)','수사','thuần hàn',''],
  '열두':['mười hai (thuần)','수사','thuần hàn',''],
  '두':['hai (thuần, trước danh từ)','수관형사','thuần hàn',''],
  '세':['ba (thuần, trước danh từ)','수관형사','thuần hàn',''],
  '네':['bốn (thuần, trước danh từ)','수관형사','thuần hàn',''],
  '한':['một (thuần, trước danh từ)','수관형사','thuần hàn',''],
  // Đuôi thông dụng quan trọng
  '습니다':['(đuôi lịch sự)','어미','thuần hàn',''],
  '입니다':['là... (lịch sự)','어미','thuần hàn',''],
  '겠습니다':['sẽ... (ý định lịch sự)','어미','thuần hàn',''],
  '주세요':['xin hãy... (nhờ lịch sự)','어미+보조동사','thuần hàn',''],
  '드릴게요':['sẽ làm giúp (khiêm)','어미+보조동사','thuần hàn',''],
  '드릴까요':['có thể làm giúp không?','어미+보조동사','thuần hàn',''],
  '드리겠습니다':['sẽ làm giúp (khiêm, lịch sự)','어미+보조동사','thuần hàn',''],
  '주셔서':['vì đã làm giúp (kính)','어미','thuần hàn',''],
  '바랍니다':['mong muốn','동사어미','thuần hàn',''],
  '됩니다':['trở thành, được','동사','thuần hàn',''],
  '해주세요':['xin hãy làm','동사','thuần hàn',''],
  '하겠습니다':['sẽ thực hiện','동사','thuần hàn',''],
  '합니다':['làm (lịch sự)','동사','thuần hàn',''],
  '있습니다':['có, tồn tại (lịch sự)','동사','thuần hàn',''],
  '없습니다':['không có (lịch sự)','동사','thuần hàn',''],
  '없으세요':['không có ạ?','동사','thuần hàn',''],
  '있으세요':['có ạ?','동사','thuần hàn',''],
  '안녕히':['an lành (tạm biệt)','부사','hán hàn','安寧'],
  '가세요':['xin đi, xin về','동사','thuần hàn',''],
  '계세요':['ở lại, xin ở lại (kính)','동사','thuần hàn',''],
  '오세요':['xin mời đến','동사','thuần hàn',''],
  '앉으세요':['xin ngồi (kính)','동사','thuần hàn',''],
  '내리겠습니다':['sẽ xuống','동사','thuần hàn',''],
  '이동하겠습니다':['sẽ di chuyển','동사','hán hàn','移動'],
  '출발하겠습니다':['sẽ xuất phát','동사','hán hàn','出發'],
  '도착합니다':['sẽ đến nơi','동사','hán hàn','到着'],
  '모이겠습니다':['sẽ tập hợp','동사','thuần hàn',''],
  '진행하겠습니다':['sẽ tiến hành','동사','hán hàn','進行'],
  '감사합니다':['cảm ơn','동사','hán hàn','感謝'],
  '죄송합니다':['xin lỗi','형용사','hán hàn','罪悚'],
  '실례합니다':['xin phép làm phiền','동사','hán hàn','失禮'],
  '환영합니다':['chào mừng','동사','hán hàn','歡迎'],
  '감사드립니다':['xin cảm ơn (khiêm)','동사','hán hàn','感謝'],
  '부탁드립니다':['nhờ vả, xin được nhờ','동사','hán hàn','付託'],
  // Thán từ
  '네':['vâng, có','감탄사','thuần hàn',''],
  '아니요':['không','감탄사','thuần hàn',''],
  '맞습니다':['đúng vậy','동사','thuần hàn',''],
  '아닙니다':['không phải','동사','thuần hàn',''],
};

// ── 2. Bảng đuôi động từ phổ biến để tách hình vị ────────────
const VERB_ENDINGS = [
  // Dài trước ngắn để match ưu tiên
  {sfx:'겠습니다', vi:'(ý định lịch sự)', type:'어미', base_fn: s => s+'다'},
  {sfx:'하겠습니다', vi:'sẽ thực hiện', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'드리겠습니다', vi:'sẽ làm giúp (khiêm)', type:'어미', base_fn: s => s+'드리다'},
  {sfx:'드릴게요', vi:'sẽ làm giúp (khiêm)', type:'어미', base_fn: s => s+'드리다'},
  {sfx:'드릴까요', vi:'có thể làm giúp không?', type:'어미', base_fn: s => s+'드리다'},
  {sfx:'드릴', vi:'sẽ làm giúp (khiêm)', type:'어미', base_fn: s => s+'드리다'},
  {sfx:'드립니다', vi:'làm giúp (khiêm, lịch sự)', type:'어미', base_fn: s => s+'드리다'},
  {sfx:'해 주세요', vi:'xin hãy làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'해주세요', vi:'xin hãy làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'해주시면', vi:'nếu làm giúp (kính)', type:'어미', base_fn: s => s+'하다'},
  {sfx:'해주십시오', vi:'xin làm ơn hãy làm (trang trọng)', type:'어미', base_fn: s => s+'하다'},
  {sfx:'주셔서', vi:'vì đã làm giúp (kính)', type:'어미', base_fn: s => s+'주다'},
  {sfx:'주세요', vi:'xin hãy... (nhờ lịch sự)', type:'어미', base_fn: s => s+'주다'},
  {sfx:'주십시오', vi:'xin làm ơn (trang trọng)', type:'어미', base_fn: s => s+'주다'},
  {sfx:'주시면', vi:'nếu vui lòng... (kính)', type:'어미', base_fn: s => s+'주다'},
  {sfx:'주실', vi:'sẽ làm giúp (kính)', type:'어미', base_fn: s => s+'주다'},
  {sfx:'합니다', vi:'làm (lịch sự)', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'합니까', vi:'có... không? (lịch sự)', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'하세요', vi:'xin hãy làm (kính)', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'하십시오', vi:'xin hãy làm (trang trọng)', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'하겠습니다', vi:'sẽ làm (lịch sự)', type:'동사+어미', base_fn: s => s+'하다'},
  {sfx:'해도', vi:'dù làm...', type:'어미', base_fn: s => s+'하다'},
  {sfx:'해야', vi:'phải làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'해서', vi:'làm rồi, vì làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'하면', vi:'nếu làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'하니', vi:'vì làm, khi làm', type:'어미', base_fn: s => s+'하다'},
  {sfx:'습니다', vi:'(đuôi lịch sự)', type:'어미', base_fn: s => s+'다'},
  {sfx:'ㅂ니다', vi:'(đuôi lịch sự)', type:'어미', base_fn: s => s+'다'},
  {sfx:'십시오', vi:'xin hãy... (trang trọng)', type:'어미', base_fn: s => s+'다'},
  {sfx:'시면', vi:'nếu... (kính)', type:'어미', base_fn: s => s+'다'},
  {sfx:'세요', vi:'xin..., hãy... (kính)', type:'어미', base_fn: s => s+'다'},
  {sfx:'셨나요', vi:'đã...chưa? (kính)', type:'어미', base_fn: s => s+'다'},
  {sfx:'겠어요', vi:'sẽ... (ý định)', type:'어미', base_fn: s => s+'다'},
  {sfx:'ㄹ게요', vi:'sẽ... (hứa hẹn)', type:'어미', base_fn: s => s+'다'},
  {sfx:'ㄹ까요', vi:'... nhé? (đề nghị)', type:'어미', base_fn: s => s+'다'},
  {sfx:'아요', vi:'(đuôi thân mật lịch sự)', type:'어미', base_fn: s => s+'다'},
  {sfx:'어요', vi:'(đuôi thân mật lịch sự)', type:'어미', base_fn: s => s+'다'},
  {sfx:'아서', vi:'vì..., do...', type:'어미', base_fn: s => s+'다'},
  {sfx:'어서', vi:'vì..., do...', type:'어미', base_fn: s => s+'다'},
  {sfx:'아서도', vi:'dù vì...', type:'어미', base_fn: s => s+'다'},
  {sfx:'ㄴ다', vi:'(hiện tại trung lập)', type:'어미', base_fn: s => s+'다'},
  {sfx:'겠다', vi:'sẽ... (ý định)', type:'어미', base_fn: s => s+'다'},
  {sfx:'입니다', vi:'là... (lịch sự)', type:'서술격조사+어미', base_fn: s => s},
  {sfx:'이에요', vi:'là... (thân mật)', type:'서술격조사', base_fn: s => s},
  {sfx:'예요', vi:'là... (thân mật)', type:'서술격조사', base_fn: s => s},
  {sfx:'이다', vi:'là...', type:'서술격조사', base_fn: s => s},
];

// ── 3. Hậu tố trợ từ để strip trước khi lookup ───────────────
const PARTICLE_SFXS = [
  {sfx:'에서는', vi:'tại (chủ đề)'},{sfx:'에서만', vi:'chỉ tại'},
  {sfx:'에서도', vi:'cả ở'},{sfx:'에서', vi:'tại (nơi hành động)'},
  {sfx:'에게는', vi:'cho (chủ đề)'},{sfx:'에게', vi:'cho, tới (người)'},
  {sfx:'까지는', vi:'đến (chủ đề)'},{sfx:'까지', vi:'đến (điểm cuối)'},
  {sfx:'부터', vi:'từ (điểm đầu)'},{sfx:'에서부터', vi:'từ tại'},
  {sfx:'으로는', vi:'bằng, theo'},{sfx:'으로도', vi:'cả bằng'},
  {sfx:'으로', vi:'bằng, hướng đến'},{sfx:'로는', vi:'bằng (chủ đề)'},
  {sfx:'로도', vi:'cả bằng'},{sfx:'로', vi:'bằng, hướng đến'},
  {sfx:'과는', vi:'và (chủ đề)'},{sfx:'과', vi:'và (sau phụ âm)'},
  {sfx:'와는', vi:'và (chủ đề)'},{sfx:'와', vi:'và (sau nguyên âm)'},
  {sfx:'에는', vi:'ở (chủ đề)'},{sfx:'에도', vi:'cả ở'},{sfx:'에', vi:'ở, tại'},
  {sfx:'은요', vi:'(chủ đề, hỏi)'},{sfx:'는요', vi:'(chủ đề, hỏi)'},
  {sfx:'이는', vi:'(chủ đề)'},{sfx:'가는', vi:'(chủ ngữ chủ đề)'},
  {sfx:'이야', vi:'(chủ ngữ thân mật)'},{sfx:'야', vi:'(chủ ngữ thân mật)'},
  {sfx:'을요', vi:'(tân ngữ, hỏi)'},{sfx:'를요', vi:'(tân ngữ, hỏi)'},
  {sfx:'이나', vi:'hoặc (sau phụ âm)'},{sfx:'나', vi:'hoặc (sau nguyên âm)'},
  {sfx:'이라도', vi:'dù là'},{sfx:'라도', vi:'dù là'},
  {sfx:'한테', vi:'tới (người, thân mật)'},{sfx:'께', vi:'tới (người, kính)'},
  {sfx:'은', vi:'(chủ đề, kết thúc phụ âm)'},{sfx:'는', vi:'(chủ đề, kết thúc nguyên âm)'},
  {sfx:'이', vi:'(chủ ngữ, sau phụ âm)'},{sfx:'가', vi:'(chủ ngữ, sau nguyên âm)'},
  {sfx:'을', vi:'(tân ngữ, sau phụ âm)'},{sfx:'를', vi:'(tân ngữ, sau nguyên âm)'},
  {sfx:'의', vi:'của'},{sfx:'도', vi:'cũng, nữa'},{sfx:'만', vi:'chỉ'},
  {sfx:'씩', vi:'mỗi người, từng'},{sfx:'마다', vi:'mỗi, từng'},
];

// ── 4. Hàm phân tích hình vị chính ───────────────────────────
function normOrigin(s) {
  s = (s||'').replace('하àn','hàn').replace('下àn','hàn').replace('下àn','hàn');
  if (s.includes('thuần')) return 'thuần hàn';
  if (s.includes('hán') || s.includes('hán')) return 'hán hàn';
  return 'ngoại lai';
}

function lookupStem(stem) {
  // Tra trực tiếp
  if (STEM_DICT[stem]) return STEM_DICT[stem];
  // Thử dạng 하다
  if (STEM_DICT[stem+'하다']) return STEM_DICT[stem+'하다'];
  // Thử strip -하 rồi lookup
  if (stem.endsWith('하') && STEM_DICT[stem.slice(0,-1)+'하다']) return STEM_DICT[stem.slice(0,-1)+'하다'];
  return null;
}

function analyzeWord(w) {
  const clean = w.replace(/[?!,.]$/,'');

  // 1. Tra trực tiếp
  if (STEM_DICT[clean]) {
    const [vi, type, origin, hanja] = STEM_DICT[clean];
    return { word: w, meaning_vi: vi, root: clean, type, origin: normOrigin(origin), hanja, morphemes: [], note: '' };
  }

  // 2. Tách trợ từ
  for (const {sfx, vi: pvi} of PARTICLE_SFXS) {
    if (clean.endsWith(sfx) && clean.length > sfx.length) {
      const stem = clean.slice(0, clean.length - sfx.length);
      const found = lookupStem(stem);
      if (found) {
        const [vi, type, origin, hanja] = found;
        return {
          word: w, meaning_vi: vi,
          root: stem,
          type,
          origin: normOrigin(origin),
          hanja,
          morphemes: [{p: stem, g: vi}, {p: sfx, g: pvi}],
          note: ''
        };
      }
    }
  }

  // 3. Tách đuôi động từ/tính từ
  for (const {sfx, vi: evi, type: etype, base_fn} of VERB_ENDINGS) {
    if (clean.endsWith(sfx) && clean.length > sfx.length) {
      const stem = clean.slice(0, clean.length - sfx.length);
      const baseForm = base_fn(stem);
      // Lookup stem trong dict
      const found = lookupStem(stem) || lookupStem(baseForm);
      if (found) {
        const [vi, type, origin, hanja] = found;
        return {
          word: w, meaning_vi: vi,
          root: baseForm,
          type: found[1] || etype,
          origin: normOrigin(origin),
          hanja,
          morphemes: stem ? [{p: stem, g: vi}, {p: sfx, g: evi}] : [],
          note: ''
        };
      }
      // Stem không có trong dict nhưng vẫn nhận dạng được đuôi
      if (stem.length > 0) {
        return {
          word: w, meaning_vi: `${stem}... ${evi}`,
          root: baseForm,
          type: etype,
          origin: guessOriginKo(stem),
          hanja: '',
          morphemes: [{p: stem, g: '(gốc)'}, {p: sfx, g: evi}],
          note: ''
        };
      }
    }
  }

  // 4. Thử tách hậu tố -는/은/이/가/을/를 rồi nhận đuôi
  const stripped2 = clean.replace(/[은는이가을를에서도만로으로와과의]$/, '');
  if (stripped2 !== clean) {
    const sfxPart = clean.slice(stripped2.length);
    const found2 = lookupStem(stripped2);
    if (found2) {
      const [vi, type, origin, hanja] = found2;
      const pInfo = PARTICLE_SFXS.find(p => p.sfx === sfxPart);
      return {
        word: w, meaning_vi: vi,
        root: stripped2,
        type,
        origin: normOrigin(origin),
        hanja,
        morphemes: [{p: stripped2, g: vi}, {p: sfxPart, g: pInfo ? pInfo.vi : '(trợ từ)'}],
        note: ''
      };
    }
  }

  // 5. Fallback có nghĩa: dùng Hanja stems để đoán
  const origin5 = guessOriginKo(clean);
  const type5 = guessTypeKo(clean);
  const meaning5 = guessMeaningKo(clean);
  return { word: w, meaning_vi: meaning5, root: guessRootKo(clean), type: type5, origin: origin5, hanja: '', morphemes: [], note: '' };
}

// ── 5. Đoán nghĩa thông minh khi không có trong dict ─────────
function guessMeaningKo(w) {
  // Nhận diện từ quen thuộc theo pattern
  const patterns = [
    [/입니다$/, '... (là/đây là)'],
    [/습니다$/, '... (lịch sự)'],
    [/겠습니다$/, 'sẽ ...'],
    [/하세요$/, 'xin hãy ...'],
    [/주세요$/, 'xin ...'],
    [/됩니다$/, 'trở thành, được ...'],
    [/있습니다$/, 'có ...'],
    [/없습니다$/, 'không có ...'],
    [/합니다$/, '... (làm - lịch sự)'],
    [/세요$/, '... (kính ngữ)'],
    [/마세요$|지 마세요$/, 'xin đừng ...'],
    [/겠습니까$/, 'sẽ ... không?'],
    [/십시오$/, 'xin hãy ...'],
    [/ㄹ게요$/, 'sẽ ...'],
    [/시면$|으시면$/, 'nếu ... (kính)'],
    [/아서$|어서$/, 'vì ..., rồi ...'],
    [/으면$|면$/, 'nếu ...'],
    [/지고$|이고$/, 'và ...'],
    [/을|를$/, '... (tân ngữ)'],
    [/이|가$/, '... (chủ ngữ)'],
    [/은|는$/, '... (chủ đề)'],
    [/에서$/, '... (tại/ở)'],
    [/으로$|로$/, '... (hướng/bằng)'],
    [/까지$/, '... (đến)'],
    [/부터$/, '... (từ)'],
    [/와|과$/, '... và ...'],
  ];
  for (const [re, hint] of patterns) {
    if (re.test(w)) return `(${w}) — ${hint}`;
  }
  return `(${w})`;
}

function guessOriginKo(w) {
  if (/[a-zA-Z]/.test(w)) return 'ngoại lai';
  const hStem = ['감사','죄송','실례','확인','준비','이동','출발','도착','안전','화장','일정','관광','설명','휴식','식당','음식','여권','탑승','수하물','입국','심사','공항','사진','시간','정말','안내','관리','연락','문제','변경','방문','장소','예정','종료','이용','결제','현금','환전','기념','특산','면세','시장','보험','병원','경찰','응급','증상','약국','구매','주문','추천','협조','엄수','번호','좌석','창문','계단','전화','연락','통역','번역','문자','후기','객실','세탁','온수','전망','야경','명소','전통','문화','고도','안개','규정','예절','예의','사고','보관'];
  for (const s of hStem) { if (w.includes(s)) return 'hán hàn'; }
  return 'thuần hàn';
}

function guessTypeKo(w) {
  if (w.endsWith('합니다')||w.endsWith('습니다')||w.endsWith('겠습니다')) return '동사 (lịch sự)';
  if (w.endsWith('세요')||w.endsWith('십시오')) return '동사 (kính ngữ)';
  if (w.endsWith('입니다')||w.endsWith('이에요')||w.endsWith('예요')) return '서술격조사';
  if (/[은는이가을를에로도만]$/.test(w)) return '조사';
  return '명사/기타';
}

function guessRootKo(w) {
  for (const {sfx, base_fn} of VERB_ENDINGS) {
    if (w.endsWith(sfx) && w.length > sfx.length) {
      try { return base_fn(w.slice(0, w.length - sfx.length)); } catch { break; }
    }
  }
  return w;
}

// ════════════════════════════════════════════════════════════════
//  HỆ THỐNG PHÂN TÍCH TỪ VỰNG SÂU — ĐẦY ĐỦ THEO 11 YÊU CẦU
//  Mỗi item phân tích gồm: word, meaning_vi, root, structure,
//  word_type, origin_type, hanja, han_viet, han_viet_meaning,
//  pure_vietnamese, role_in_sentence, usage_note, components[]
// ════════════════════════════════════════════════════════════════

// ── Bảng Hán tự — âm Hán Việt — nghĩa ──────────────────────
const HANJA_DB = {
  '고생':  { hanja:'苦生', han_viet:'khổ sinh', meaning:'khổ = vất vả, sinh = sự sống → sự vất vả, cực nhọc' },
  '관광':  { hanja:'觀光', han_viet:'quan quang', meaning:'quan = ngắm nhìn, quang = ánh sáng/phong cảnh → tham quan' },
  '감사':  { hanja:'感謝', han_viet:'cảm tạ', meaning:'cảm = cảm nhận, tạ = tạ ơn → cảm ơn' },
  '죄송':  { hanja:'罪悚', han_viet:'tội tủng', meaning:'tội = lỗi lầm, tủng = xấu hổ/sợ hãi → xin lỗi' },
  '실례':  { hanja:'失禮', han_viet:'thất lễ', meaning:'thất = mất, lễ = lịch sự → mất phép, làm phiền' },
  '환영':  { hanja:'歡迎', han_viet:'hoan nghênh', meaning:'hoan = vui mừng, nghênh = đón → chào mừng' },
  '안내':  { hanja:'案內', han_viet:'án nội', meaning:'án = bàn/chỉ dẫn, nội = bên trong → hướng dẫn' },
  '확인':  { hanja:'確認', han_viet:'xác nhận', meaning:'xác = chắc chắn, nhận = thừa nhận → xác nhận' },
  '준비':  { hanja:'準備', han_viet:'chuẩn bị', meaning:'chuẩn = chuẩn xác, bị = sẵn sàng → chuẩn bị' },
  '이동':  { hanja:'移動', han_viet:'di động', meaning:'di = dịch chuyển, động = chuyển động → di chuyển' },
  '출발':  { hanja:'出發', han_viet:'xuất phát', meaning:'xuất = ra, phát = bắt đầu → xuất phát' },
  '도착':  { hanja:'到着', han_viet:'đáo trước', meaning:'đáo = đến, trước = đặt/ở → đến nơi' },
  '탑승':  { hanja:'搭乘', han_viet:'đáp thừa', meaning:'đáp = bước lên, thừa = cưỡi → lên xe/tàu/máy bay' },
  '설명':  { hanja:'說明', han_viet:'thuyết minh', meaning:'thuyết = nói, minh = rõ ràng → giải thích rõ' },
  '일정':  { hanja:'日程', han_viet:'nhật trình', meaning:'nhật = ngày, trình = chương trình → lịch trình' },
  '공항':  { hanja:'空港', han_viet:'không cảng', meaning:'không = bầu trời, cảng = bến → sân bay' },
  '여권':  { hanja:'旅券', han_viet:'lữ quyển', meaning:'lữ = du lịch, quyển = giấy tờ → hộ chiếu' },
  '수하물':{ hanja:'手荷物', han_viet:'thủ hà vật', meaning:'thủ = tay, hà = gánh nặng, vật = đồ vật → hành lý' },
  '입국':  { hanja:'入國', han_viet:'nhập quốc', meaning:'nhập = vào, quốc = nước → nhập cảnh' },
  '심사':  { hanja:'審査', han_viet:'thẩm tra', meaning:'thẩm = xem xét kỹ, tra = kiểm tra → kiểm tra' },
  '안전':  { hanja:'安全', han_viet:'an toàn', meaning:'an = bình yên, toàn = vẹn toàn → an toàn' },
  '화장실':{ hanja:'化粧室', han_viet:'hóa trang thất', meaning:'hóa trang = trang điểm, thất = phòng → phòng vệ sinh' },
  '관리':  { hanja:'管理', han_viet:'quản lý', meaning:'quản = cai quản, lý = xử lý → quản lý' },
  '연락':  { hanja:'連絡', han_viet:'liên lạc', meaning:'liên = nối liền, lạc = tiếp xúc → liên lạc' },
  '시간':  { hanja:'時間', han_viet:'thời gian', meaning:'thời = thời điểm, gian = khoảng → thời gian' },
  '사진':  { hanja:'寫眞', han_viet:'tả chân', meaning:'tả = chép lại, chân = thật → ảnh chụp' },
  '결제':  { hanja:'決濟', han_viet:'quyết tế', meaning:'quyết = giải quyết, tế = thanh toán → thanh toán' },
  '현금':  { hanja:'現金', han_viet:'hiện kim', meaning:'hiện = có ngay, kim = vàng/tiền → tiền mặt' },
  '환전':  { hanja:'換錢', han_viet:'hoán tiền', meaning:'hoán = đổi, tiền = tiền tệ → đổi tiền' },
  '기념':  { hanja:'記念', han_viet:'kỷ niệm', meaning:'kỷ = ghi lại, niệm = nhớ → kỷ niệm' },
  '특산':  { hanja:'特産', han_viet:'đặc sản', meaning:'đặc = đặc biệt, sản = sản phẩm → đặc sản' },
  '면세':  { hanja:'免稅', han_viet:'miễn thuế', meaning:'miễn = không phải, thuế = thuế → miễn thuế' },
  '보험':  { hanja:'保險', han_viet:'bảo hiểm', meaning:'bảo = bảo vệ, hiểm = nguy hiểm → bảo hiểm' },
  '병원':  { hanja:'病院', han_viet:'bệnh viện', meaning:'bệnh = ốm, viện = cơ sở → bệnh viện' },
  '약':    { hanja:'藥', han_viet:'dược', meaning:'dược = thuốc chữa bệnh → thuốc' },
  '안녕':  { hanja:'安寧', han_viet:'an ninh', meaning:'an = bình an, ninh = yên ổn → bình an' },
  '부탁':  { hanja:'付託', han_viet:'phó thác', meaning:'phó = giao, thác = nhờ cậy → nhờ vả' },
  '장소':  { hanja:'場所', han_viet:'trường sở', meaning:'trường = nơi chốn, sở = chỗ ở → địa điểm' },
  '방문':  { hanja:'訪問', han_viet:'phỏng vấn', meaning:'phỏng = thăm hỏi, vấn = hỏi → thăm viếng' },
  '문화':  { hanja:'文化', han_viet:'văn hóa', meaning:'văn = chữ nghĩa, hóa = biến đổi → văn hóa' },
  '전통':  { hanja:'傳統', han_viet:'truyền thống', meaning:'truyền = truyền lại, thống = mạch chính → truyền thống' },
  '예절':  { hanja:'禮節', han_viet:'lễ tiết', meaning:'lễ = lịch sự, tiết = quy tắc → lễ nghi' },
  '규정':  { hanja:'規定', han_viet:'quy định', meaning:'quy = quy tắc, định = xác định → quy định' },
  '이용':  { hanja:'利用', han_viet:'lợi dụng', meaning:'lợi = có ích, dụng = sử dụng → sử dụng' },
  '구매':  { hanja:'購買', han_viet:'cấu mãi', meaning:'cấu = mua, mãi = trao đổi → mua hàng' },
  '주문':  { hanja:'注文', han_viet:'chú văn', meaning:'chú = rót/ghi, văn = chữ → đặt hàng/gọi món' },
  '영수증':{ hanja:'領收證', han_viet:'lĩnh thâu chứng', meaning:'lĩnh = nhận, thâu = thu, chứng = bằng chứng → biên lai' },
  '식당':  { hanja:'食堂', han_viet:'thực đường', meaning:'thực = ăn, đường = nhà/nơi → nhà ăn' },
  '음식':  { hanja:'飮食', han_viet:'ẩm thực', meaning:'ẩm = uống, thực = ăn → đồ ăn uống' },
  '좌석':  { hanja:'座席', han_viet:'tòa tịch', meaning:'tòa = chỗ ngồi, tịch = chiếu/ghế → chỗ ngồi' },
  '번호':  { hanja:'番號', han_viet:'phiên hiệu', meaning:'phiên = lượt, hiệu = số → số thứ tự' },
  '단체':  { hanja:'團體', han_viet:'đoàn thể', meaning:'đoàn = tập hợp, thể = tổ chức → đoàn/nhóm' },
  '인원':  { hanja:'人員', han_viet:'nhân viên', meaning:'nhân = người, viên = thành viên → số người' },
  '담당':  { hanja:'擔當', han_viet:'đảm đương', meaning:'đảm = gánh, đương = chịu trách nhiệm → phụ trách' },
  '성함':  { hanja:'姓銜', han_viet:'tính hàm', meaning:'tính = họ, hàm = chức danh/tên → tên (kính)' },
  '전망':  { hanja:'展望', han_viet:'triển vọng', meaning:'triển = mở ra, vọng = nhìn xa → tầm nhìn/cảnh quan' },
  '야경':  { hanja:'夜景', han_viet:'dạ cảnh', meaning:'dạ = đêm, cảnh = cảnh vật → cảnh đêm' },
  '통역':  { hanja:'通譯', han_viet:'thông dịch', meaning:'thông = thông suốt, dịch = dịch ngôn ngữ → phiên dịch' },
  '비상구':{ hanja:'非常口', han_viet:'phi thường khẩu', meaning:'phi thường = khẩn cấp, khẩu = cửa → lối thoát hiểm' },
  '관람':  { hanja:'觀覽', han_viet:'quan lãm', meaning:'quan = xem, lãm = ngắm → tham quan/xem' },
  '고도':  { hanja:'高度', han_viet:'cao độ', meaning:'cao = cao, độ = mức → độ cao' },
  '자유':  { hanja:'自由', han_viet:'tự do', meaning:'tự = tự mình, do = nguyên nhân/từ → tự do' },
  '귀가':  { hanja:'歸家', han_viet:'quy gia', meaning:'quy = trở về, gia = nhà → về nhà' },
  '귀국':  { hanja:'歸國', han_viet:'quy quốc', meaning:'quy = trở về, quốc = nước → về nước' },
  '종료':  { hanja:'終了', han_viet:'chung liễu', meaning:'chung = kết thúc, liễu = xong → kết thúc' },
  '진행':  { hanja:'進行', han_viet:'tiến hành', meaning:'tiến = đi tới, hành = thực hiện → tiến hành' },
  '변경':  { hanja:'變更', han_viet:'biến canh', meaning:'biến = thay đổi, canh = đổi mới → thay đổi' },
  '협조':  { hanja:'協助', han_viet:'hiệp trợ', meaning:'hiệp = cùng nhau, trợ = giúp đỡ → hợp tác' },
  '추천':  { hanja:'推薦', han_viet:'thúc tiến', meaning:'thúc = đẩy, tiến = giới thiệu → giới thiệu/đề xuất' },
  '보관':  { hanja:'保管', han_viet:'bảo quản', meaning:'bảo = giữ gìn, quản = quản lý → bảo quản/giữ' },
  '신고':  { hanja:'申告', han_viet:'thân cáo', meaning:'thân = trình bày, cáo = báo cáo → khai báo' },
  '촬영':  { hanja:'撮影', han_viet:'toát ảnh', meaning:'toát = thu thập, ảnh = hình ảnh → chụp/quay phim' },
  '문자':  { hanja:'文字', han_viet:'văn tự', meaning:'văn = chữ viết, tự = ký tự → chữ/tin nhắn' },
  '전화':  { hanja:'電話', han_viet:'điện thoại', meaning:'điện = điện lực, thoại = lời nói → điện thoại' },
  '연결':  { hanja:'連結', han_viet:'liên kết', meaning:'liên = nối, kết = buộc → kết nối' },
  '객실':  { hanja:'客室', han_viet:'khách thất', meaning:'khách = người khách, thất = phòng → phòng khách sạn' },
  '비밀':  { hanja:'秘密', han_viet:'bí mật', meaning:'bí = ẩn, mật = kín → bí mật' },
  '세탁':  { hanja:'洗濯', han_viet:'tẩy trạc', meaning:'tẩy = rửa sạch, trạc = giặt → giặt giũ' },
  '분실':  { hanja:'紛失', han_viet:'phân thất', meaning:'phân = lộn xộn, thất = mất → thất lạc' },
  '소지품':{ hanja:'所持品', han_viet:'sở trì phẩm', meaning:'sở = chỗ, trì = giữ, phẩm = đồ vật → đồ cá nhân' },
  '귀중품':{ hanja:'貴重品', han_viet:'quý trọng phẩm', meaning:'quý = có giá trị, trọng = quan trọng, phẩm = đồ → đồ quý' },
  '사고':  { hanja:'事故', han_viet:'sự cố', meaning:'sự = việc, cố = nguyên nhân/sự kiện → tai nạn, sự cố' },
  '응급':  { hanja:'應急', han_viet:'ứng cấp', meaning:'ứng = đáp lại, cấp = khẩn cấp → cấp cứu' },
  '증상':  { hanja:'症狀', han_viet:'chứng trạng', meaning:'chứng = triệu chứng, trạng = trạng thái → triệu chứng' },
  '약국':  { hanja:'藥局', han_viet:'dược cục', meaning:'dược = thuốc, cục = cửa hàng → nhà thuốc' },
  '경찰':  { hanja:'警察', han_viet:'cảnh sát', meaning:'cảnh = cảnh báo, sát = xem xét → cảnh sát' },
  '조식':  { hanja:'朝食', han_viet:'triêu thực', meaning:'triêu = buổi sáng, thực = ăn → bữa sáng' },
  '온수':  { hanja:'溫水', han_viet:'ôn thủy', meaning:'ôn = ấm, thủy = nước → nước nóng' },
  '명소':  { hanja:'名所', han_viet:'danh sở', meaning:'danh = nổi tiếng, sở = nơi chốn → địa điểm nổi tiếng' },
  '오전':  { hanja:'午前', han_viet:'ngọ tiền', meaning:'ngọ = 12 giờ trưa, tiền = trước → buổi sáng (trước trưa)' },
  '오후':  { hanja:'午後', han_viet:'ngọ hậu', meaning:'ngọ = 12 giờ trưa, hậu = sau → buổi chiều (sau trưa)' },
  '지금':  { hanja:'只今', han_viet:'chỉ kim', meaning:'chỉ = ngay, kim = bây giờ → ngay bây giờ' },
  '잠시':  { hanja:'暫時', han_viet:'tạm thời', meaning:'tạm = tạm thời, thời = thời gian → một lúc' },
  '항상':  { hanja:'恒常', han_viet:'hằng thường', meaning:'hằng = luôn luôn, thường = bình thường → luôn luôn' },
};

// ── Bảng đuôi ngữ pháp với giải thích đầy đủ ────────────────
const GRAMMAR_ENDINGS = {
  '겠습니다': { vi:'sẽ... (ý định lịch sự)', struct:'V + 겠 + 습니다', explain:'겠 = ý định/dự định, 습니다 = đuôi lịch sự trang trọng' },
  '드리겠습니다': { vi:'tôi sẽ làm giúp (khiêm, lịch sự)', struct:'드리다 + 겠 + 습니다', explain:'드리다 = làm giúp (kính), 겠 = sẽ, 습니다 = lịch sự' },
  '드릴게요': { vi:'tôi sẽ làm giúp quý khách', struct:'드리다 + ㄹ게요', explain:'드리다 = làm giúp (kính), ㄹ게요 = sẽ... (hứa hẹn thân mật lịch sự)' },
  '드릴까요': { vi:'tôi có thể làm giúp được không?', struct:'드리다 + ㄹ까요', explain:'드리다 = làm giúp (kính), ㄹ까요 = ...được không? (hỏi đề nghị)' },
  '드립니다': { vi:'làm giúp quý khách (lịch sự)', struct:'드리다 + ㅂ니다', explain:'드리다 = làm giúp (kính), ㅂ니다 = đuôi lịch sự' },
  '주세요': { vi:'xin hãy... (nhờ lịch sự)', struct:'V + 아/어 + 주세요', explain:'주다 = cho/làm giúp, 세요 = kính ngữ yêu cầu nhẹ nhàng' },
  '주십시오': { vi:'xin vui lòng... (trang trọng)', struct:'V + 아/어 + 주십시오', explain:'주다 = cho/làm giúp, 십시오 = kính ngữ mệnh lệnh trang trọng nhất' },
  '주시면': { vi:'nếu quý khách vui lòng...', struct:'주다 + 시 + 면', explain:'주다 = cho, 시 = kính ngữ, 면 = điều kiện nếu' },
  '주실': { vi:'sẽ... giúp (kính)', struct:'주다 + 시 + ㄹ', explain:'주다 = cho, 시 = kính ngữ, ㄹ = tương lai/dự định' },
  '주셔서': { vi:'vì quý khách đã... giúp (kính)', struct:'주다 + 시 + 어서', explain:'주시다 = làm giúp (kính), 어서 = vì/do → diễn đạt lý do' },
  '합니다': { vi:'làm (lịch sự trang trọng)', struct:'하다 + ㅂ니다', explain:'하다 = làm, ㅂ니다 = đuôi lịch sự trang trọng' },
  '하겠습니다': { vi:'sẽ làm (ý định lịch sự)', struct:'하다 + 겠 + 습니다', explain:'하다 = làm, 겠 = sẽ/ý định, 습니다 = lịch sự' },
  '하세요': { vi:'xin hãy làm (kính)', struct:'하다 + 시 + 어요', explain:'하다 = làm, 시 = kính ngữ, 어요 = đuôi thân mật lịch sự' },
  '하십시오': { vi:'xin vui lòng làm (trang trọng)', struct:'하다 + 시 + ㅂ시오', explain:'하다 = làm, 시 = kính ngữ, ㅂ시오 = mệnh lệnh trang trọng' },
  '습니다': { vi:'(đuôi kết thúc lịch sự trang trọng)', struct:'V/Adj + 습니다', explain:'Dùng sau phụ âm cuối. Hình thức lịch sự nhất trong văn nói' },
  'ㅂ니다': { vi:'(đuôi kết thúc lịch sự trang trọng)', struct:'V/Adj + ㅂ니다', explain:'Dùng sau nguyên âm cuối. Tương đương 습니다' },
  '입니다': { vi:'là... (lịch sự)', struct:'N + 입니다', explain:'이다 = là, ㅂ니다 = lịch sự → khẳng định "là N"' },
  '세요': { vi:'xin... / hãy... (kính ngữ nhẹ nhàng)', struct:'V + (으)세요', explain:'시 = kính ngữ, 어요 = đuôi thân mật lịch sự → nhờ hoặc hỏi lịch sự' },
  '십시오': { vi:'xin vui lòng... (trang trọng nhất)', struct:'V + (으)십시오', explain:'시 = kính ngữ, ㅂ시오 = mệnh lệnh trang trọng → dùng với đám đông' },
  '느라': { vi:'vì.../trong quá trình... (lý do/bận)', struct:'V + 느라', explain:'Đuôi nối chỉ lý do hoặc trạng thái bận rộn gây ra kết quả ở mệnh đề sau' },
  '으시': { vi:'(kính ngữ chủ thể)', struct:'V + 으시', explain:'Thêm vào động từ/tính từ để tôn trọng chủ thể (người thực hiện hành động)' },
  '셨': { vi:'đã... (quá khứ kính ngữ)', struct:'V + 시 + 었', explain:'시 = kính ngữ, 었 = quá khứ → hành động đã xảy ra, nói với sự tôn trọng' },
  '았어요': { vi:'đã... (quá khứ thân mật)', struct:'V + 았 + 어요', explain:'았/었 = quá khứ, 어요 = lịch sự thân mật' },
  '겠어요': { vi:'sẽ... (ý định thân mật)', struct:'V + 겠 + 어요', explain:'겠 = ý định, 어요 = lịch sự thân mật' },
  'ㄹ게요': { vi:'tôi sẽ... (hứa/ý định)', struct:'V + ㄹ게요', explain:'ㄹ = tương lai, 게요 = hứa hẹn/ý định với người nghe' },
  'ㄹ까요': { vi:'...nhé? / ...được không?', struct:'V + ㄹ까요', explain:'Hỏi ý kiến hoặc đề nghị làm cùng' },
  '으면': { vi:'nếu...', struct:'V/Adj + 으면', explain:'Điều kiện: nếu vế trước xảy ra thì vế sau xảy ra' },
  '면': { vi:'nếu...', struct:'V/Adj + 면', explain:'Điều kiện sau nguyên âm: nếu...' },
  '아서': { vi:'vì.../rồi...', struct:'V + 아서', explain:'Chỉ lý do hoặc hành động liên tiếp (thứ tự thời gian)' },
  '어서': { vi:'vì.../rồi...', struct:'V + 어서', explain:'Chỉ lý do hoặc hành động liên tiếp sau nguyên âm không phải ㅏ/ㅗ' },
  '아요': { vi:'(đuôi thân mật lịch sự)', struct:'V/Adj + 아요', explain:'Lịch sự thân mật, dùng trong hội thoại hàng ngày' },
  '어요': { vi:'(đuôi thân mật lịch sự)', struct:'V/Adj + 어요', explain:'Lịch sự thân mật sau nguyên âm không phải ㅏ/ㅗ' },
  '고': { vi:'và.../rồi...', struct:'V + 고', explain:'Nối hai hành động: V1 và V2, hoặc V1 rồi V2' },
  '지': { vi:'(đuôi phủ định/hỏi)', struct:'V + 지', explain:'Dùng trước 않다 để phủ định, hoặc cuối câu hỏi thân mật' },
  '마세요': { vi:'xin đừng... (kính)', struct:'V + 지 + 마세요', explain:'지 마세요 = đừng làm, lịch sự nhẹ nhàng' },
  '됩니다': { vi:'được phép / trở thành (lịch sự)', struct:'되다 + ㅂ니다', explain:'되다 = được/trở thành, ㅂ니다 = lịch sự' },
  '있습니다': { vi:'có / tồn tại (lịch sự)', struct:'있다 + 습니다', explain:'있다 = có/tồn tại, 습니다 = lịch sự' },
  '없습니다': { vi:'không có (lịch sự)', struct:'없다 + 습니다', explain:'없다 = không có, 습니다 = lịch sự' },
  '이에요': { vi:'là... (thân mật lịch sự)', struct:'N + 이에요', explain:'이다 = là, 에요 = thân mật lịch sự → sau phụ âm' },
  '예요': { vi:'là... (thân mật lịch sự)', struct:'N + 예요', explain:'이다 = là, 에요 = thân mật lịch sự → sau nguyên âm' },
  '겠습니까': { vi:'sẽ...không? (hỏi trang trọng)', struct:'V + 겠 + 습니까', explain:'겠 = sẽ, 습니까 = câu hỏi lịch sự trang trọng' },
  '셨나요': { vi:'đã...chưa/không? (hỏi kính)', struct:'V + 시 + 었 + 나요', explain:'시 = kính ngữ, 었 = quá khứ, 나요 = hỏi thân mật' },
  '시면': { vi:'nếu quý khách...', struct:'V + 시 + 면', explain:'시 = kính ngữ, 면 = điều kiện nếu → kính trọng người nghe' },
  '겠습니다': { vi:'sẽ... (ý định lịch sự)', struct:'V + 겠 + 습니다', explain:'겠 = ý định/dự định, 습니다 = lịch sự trang trọng' },
};

// ── Bảng trợ từ với giải thích ──────────────────────────────
const PARTICLE_DB = {
  '을': { vi:'(trợ từ tân ngữ — sau phụ âm)', role:'Đánh dấu tân ngữ trực tiếp của động từ' },
  '를': { vi:'(trợ từ tân ngữ — sau nguyên âm)', role:'Đánh dấu tân ngữ trực tiếp của động từ' },
  '이': { vi:'(trợ từ chủ ngữ — sau phụ âm)', role:'Đánh dấu chủ ngữ của câu' },
  '가': { vi:'(trợ từ chủ ngữ — sau nguyên âm)', role:'Đánh dấu chủ ngữ của câu' },
  '은': { vi:'(chủ đề — sau phụ âm)', role:'Đánh dấu chủ đề, so sánh hoặc tương phản' },
  '는': { vi:'(chủ đề — sau nguyên âm)', role:'Đánh dấu chủ đề câu' },
  '에': { vi:'ở, tại, đến (nơi chốn hoặc thời gian)', role:'Nơi chốn tĩnh hoặc thời điểm' },
  '에서': { vi:'tại, ở (nơi hành động xảy ra)', role:'Nơi chốn động — nơi hành động diễn ra' },
  '로': { vi:'đến, hướng về, bằng', role:'Hướng di chuyển hoặc phương tiện' },
  '으로': { vi:'đến, hướng về, bằng (sau phụ âm)', role:'Hướng di chuyển hoặc phương tiện' },
  '와': { vi:'và, cùng với (sau nguyên âm)', role:'Liên kết danh từ hoặc chỉ sự đồng hành' },
  '과': { vi:'và, cùng với (sau phụ âm)', role:'Liên kết danh từ hoặc chỉ sự đồng hành' },
  '도': { vi:'cũng, nữa', role:'Thêm vào để chỉ sự bao gồm' },
  '만': { vi:'chỉ, mới', role:'Giới hạn — chỉ mình N' },
  '까지': { vi:'đến, cho đến', role:'Điểm kết thúc về không gian hoặc thời gian' },
  '부터': { vi:'từ, kể từ', role:'Điểm bắt đầu về không gian hoặc thời gian' },
  '에게': { vi:'cho, tới (người)', role:'Đích của hành động — người nhận' },
  '께': { vi:'cho, tới (người — kính ngữ)', role:'Đích kính trọng — dùng khi tặng/nói với người trên' },
  '의': { vi:'của', role:'Sở hữu' },
  '씩': { vi:'mỗi người, từng', role:'Phân phối đều' },
  '마다': { vi:'mỗi, từng', role:'Lặp lại với mỗi đơn vị' },
  '한테': { vi:'cho, tới (người — thân mật)', role:'Đích của hành động, dùng thân mật hơn 에게' },
  '에서는': { vi:'ở... thì (chủ đề nơi chốn)', role:'Nêu chủ đề là địa điểm' },
  '에서만': { vi:'chỉ ở...', role:'Giới hạn địa điểm' },
  '이나': { vi:'hoặc (sau phụ âm)', role:'Lựa chọn hoặc liệt kê' },
  '나': { vi:'hoặc (sau nguyên âm)', role:'Lựa chọn hoặc liệt kê' },
};

// ── Từ điển mở rộng (key = dạng xuất hiện trong câu) ────────
// Bổ sung thêm vào STEM_DICT các biến thể hay gặp
const EXTRA_WORD_DB = {
  '오시느라':    { vi:'vì quý khách đã đến / trong quá trình đi đến', root:'오다', struct:'오다 + 시(kính) + 느라(lý do)', type:'동사', origin:'thuần hàn', note:'느라 = đuôi chỉ lý do/trạng thái bận rộn gây kết quả ở vế sau' },
  '많으셨습니다':{ vi:'đã vất vả nhiều (kính ngữ/lịch sự)', root:'많다', struct:'많다 + 으시(kính) + 었(quá khứ) + 습니다(lịch sự)', type:'형용사', origin:'thuần hàn', note:'많다 = nhiều, chia kính ngữ và lịch sự trang trọng' },
  '가져다':      { vi:'lấy đem đến / mang đến', root:'가지다 / 가져오다', struct:'가지다 + 아/어다', type:'동사', origin:'thuần hàn', note:'동사 liên kết: lấy rồi đem đến — KHÔNG phải danh từ' },
  '트롤리를':    { vi:'xe đẩy hành lý (tân ngữ)', root:'트롤리', struct:'트롤리(trolley) + 를(trợ từ tân ngữ)', type:'명사+조사', origin:'ngoại lai', note:'트롤리 = từ tiếng Anh "trolley", 를 = trợ từ tân ngữ' },
  '만나서':      { vi:'vì gặp được / sau khi gặp', root:'만나다', struct:'만나다 + 아서', type:'동사', origin:'thuần hàn', note:'아서 = đuôi chỉ lý do hoặc hành động liên tiếp' },
  '오시느라':    { vi:'vì quý khách đã đến / trong quá trình đi đến', root:'오다', struct:'오다 + 시 + 느라', type:'동사', origin:'thuần hàn', note:'' },
  '내리겠습니다':{ vi:'chúng tôi sẽ xuống', root:'내리다', struct:'내리다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '올라가겠습니다':{ vi:'chúng ta sẽ đi lên', root:'올라가다', struct:'올라가다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '모이겠습니다':{ vi:'sẽ tập hợp', root:'모이다', struct:'모이다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '돌아오겠습니다':{ vi:'sẽ quay lại', root:'돌아오다', struct:'돌아오다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '따라오세요':  { vi:'xin hãy đi theo', root:'따라오다', struct:'따라오다 + 세요', type:'동사', origin:'thuần하àn', note:'' },
  '앉으세요':    { vi:'xin mời ngồi', root:'앉다', struct:'앉다 + 으세요', type:'동사', origin:'thuần hàn', note:'' },
  '보여주세요':  { vi:'xin cho xem', root:'보이다 / 보여주다', struct:'보여 + 주세요', type:'동사', origin:'thuần hàn', note:'' },
  '챙기세요':    { vi:'hãy chuẩn bị / hãy mang theo', root:'챙기다', struct:'챙기다 + 세요', type:'동사', origin:'thuần하àn', note:'' },
  '걱정하지':    { vi:'đừng lo lắng (trước 마세요)', root:'걱정하다', struct:'걱정하다 + 지', type:'동사', origin:'hán hàn', note:'걱정하지 마세요 = đừng lo lắng' },
  '이동하지':    { vi:'đừng di chuyển (trước 마세요)', root:'이동하다', struct:'이동하다 + 지', type:'동사', origin:'hán하àn', note:'' },
  '만지지':      { vi:'đừng chạm vào (trước 마세요)', root:'만지다', struct:'만지다 + 지', type:'동사', origin:'thuần하àn', note:'' },
  '버리지':      { vi:'đừng vứt (trước 마세요)', root:'버리다', struct:'버리다 + 지', type:'동사', origin:'thuần하àn', note:'' },
  '잃어버리지':  { vi:'đừng để mất (trước 마세요)', root:'잃어버리다', struct:'잃어버리다 + 지', type:'동사', origin:'thuần하àn', note:'' },
  '손가락질하지':{ vi:'đừng chỉ tay vào (trước 마세요)', root:'손가락질하다', struct:'손가락질 + 하다 + 지', type:'동사', origin:'thuần하àn', note:'손가락질 = hành động chỉ tay, bất lịch sự' },
  '말하지':      { vi:'đừng nói (trước 마세요)', root:'말하다', struct:'말하다 + 지', type:'동사', origin:'thuần하àn', note:'' },
  '내밀지':      { vi:'đừng chìa ra (trước 마세요)', root:'내밀다', struct:'내밀다 + 지', type:'동사', origin:'thuần하àn', note:'' },
  '피울':        { vi:'sẽ hút (thuốc)', root:'피우다', struct:'피우다 + ㄹ', type:'동사', origin:'thuần하àn', note:'피울 수 없습니다 = không được hút' },
  '드시고':      { vi:'xin hãy dùng rồi...', root:'드시다', struct:'드시다 + 고', type:'동사', origin:'thuần하àn', note:'드시다 = kính ngữ của 먹다/마시다 (ăn/uống)' },
  '드세요':      { vi:'xin mời dùng', root:'드시다', struct:'드시다 + 어요', type:'동사', origin:'thuần하àn', note:'드시다 = kính ngữ của 먹다 (ăn)' },
  '드셨나요':    { vi:'quý khách đã dùng chưa?', root:'드시다', struct:'드시다 + 었 + 나요', type:'동사', origin:'thuần하àn', note:'' },
  '드십니다':    { vi:'xin mời dùng (thông báo)', root:'드시다', struct:'드시다 + ㅂ니다', type:'동사', origin:'thuần하àn', note:'' },
  '오셨나요':    { vi:'quý khách đã đến chưa?', root:'오시다', struct:'오시다 + 었 + 나요', type:'동사', origin:'thuần하àn', note:'' },
  '계시면':      { vi:'nếu quý khách có / ở đây', root:'계시다', struct:'계시다 + 면', type:'동사', origin:'thuần하àn', note:'계시다 = kính ngữ của 있다' },
  '계신':        { vi:'quý khách (đang ở/có)', root:'계시다', struct:'계시다 + ㄴ', type:'동사', origin:'thuần하àn', note:'계시다 = kính ngữ của 있다' },
  '필요하신가요':{ vi:'quý khách có cần không?', root:'필요하다', struct:'필요하다 + 시 + ㄴ가요', type:'형용사', origin:'hán hàn', note:'필요 = cần thiết, 하시다 = kính ngữ' },
  '원하시면':    { vi:'nếu quý khách muốn', root:'원하다', struct:'원하다 + 시 + 면', type:'동사', origin:'hán hàn', note:'원 = mong muốn (願)' },
  '불편한':      { vi:'bất tiện, không thoải mái', root:'불편하다', struct:'불편하다 + ㄴ(định ngữ)', type:'형용사', origin:'hán hàn', note:'불편 = bất tiện (不便)' },
  '안전하게':    { vi:'một cách an toàn', root:'안전하다', struct:'안전하다 + 게', type:'부사', origin:'hán hàn', note:'게 = hậu tố trạng từ hóa tính từ' },
  '즐거우셨길':  { vi:'mong rằng đã vui vẻ (kính)', root:'즐겁다', struct:'즐겁다 + 으시 + 었 + 길', type:'형용사', origin:'thuần hàn', note:'길 = đuôi hy vọng vào quá khứ người khác' },
  '되시길':      { vi:'mong rằng... (kính)', root:'되다', struct:'되다 + 시 + 길', type:'동사', origin:'thuần hàn', note:'길 = đuôi hy vọng/mong muốn' },
  '감사드립니다':{ vi:'xin trân trọng cảm ơn (khiêm)', root:'감사하다 + 드리다', struct:'감사 + 드리다 + ㅂ니다', type:'동사', origin:'hán hàn', note:'드리다 = dạng khiêm nhường của 주다, khiêm tốn hơn 감사합니다' },
  '부탁드립니다':{ vi:'xin được nhờ cậy (khiêm)', root:'부탁하다 + 드리다', struct:'부탁 + 드리다 + ㅂ니다', type:'동사', origin:'hán hàn', note:'부탁 = nhờ vả, 드리다 = dạng khiêm nhường' },
  '말씀해':      { vi:'xin hãy nói / thưa (kính)', root:'말씀하다', struct:'말씀하다 + 어', type:'동사', origin:'thuần hàn', note:'말씀 = lời nói (kính ngữ của 말)' },
  '물어보세요':  { vi:'xin hãy hỏi', root:'물어보다', struct:'물어보다 + 세요', type:'동사', origin:'thuần hàn', note:'' },
  '알려':        { vi:'thông báo, cho biết', root:'알리다', struct:'알리다 + 어', type:'동사', origin:'thuần hàn', note:'알리다 = thông báo (사동형 của 알다)' },
  '보내드릴게요':{ vi:'tôi sẽ gửi cho quý khách', root:'보내다 + 드리다', struct:'보내다 + 아/어 + 드리다 + ㄹ게요', type:'동사', origin:'thuần hàn', note:'드리다 = dạng kính của 주다' },
  '찾겠습니다':  { vi:'tôi sẽ tìm', root:'찾다', struct:'찾다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '정리하겠습니다':{ vi:'tôi sẽ sắp xếp/tổng kết', root:'정리하다', struct:'정리 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'정리 = chỉnh lý (整理)' },
  '마무리하겠습니다':{ vi:'tôi sẽ kết thúc/hoàn thành', root:'마무리하다', struct:'마무리 + 하다 + 겠 + 습니다', type:'동사', origin:'thuần hàn', note:'' },
  '진행하겠습니다':{ vi:'tôi sẽ tiến hành', root:'진행하다', struct:'진행 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'진행 = tiến hành (進行)' },
  '설명드리겠습니다':{ vi:'tôi xin giải thích (khiêm)', root:'설명하다 + 드리다', struct:'설명 + 드리다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'설명 = thuyết minh, 드리다 = khiêm nhường' },
  '안내해':      { vi:'hướng dẫn (dạng liên kết)', root:'안내하다', struct:'안내하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '안내합니다':  { vi:'hướng dẫn (lịch sự)', root:'안내하다', struct:'안내 + 하다 + ㅂ니다', type:'동사', origin:'hán hàn', note:'' },
  '이동하겠습니다':{ vi:'chúng ta sẽ di chuyển', root:'이동하다', struct:'이동 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'' },
  '이동하세요':  { vi:'xin hãy di chuyển', root:'이동하다', struct:'이동 + 하다 + 세요', type:'동사', origin:'hán hàn', note:'' },
  '이동해':      { vi:'di chuyển (dạng liên kết)', root:'이동하다', struct:'이동 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '확인하겠습니다':{ vi:'tôi sẽ kiểm tra', root:'확인하다', struct:'확인 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'' },
  '확인하고':    { vi:'kiểm tra rồi...', root:'확인하다', struct:'확인 + 하다 + 고', type:'동사', origin:'hán hàn', note:'' },
  '확인하세요':  { vi:'xin hãy kiểm tra', root:'확인하다', struct:'확인 + 하다 + 세요', type:'동사', origin:'hán hàn', note:'' },
  '확인해':      { vi:'kiểm tra (dạng liên kết)', root:'확인하다', struct:'확인 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '준비하세요':  { vi:'xin hãy chuẩn bị', root:'준비하다', struct:'준비 + 하다 + 세요', type:'동사', origin:'hán hàn', note:'' },
  '준비하시면':  { vi:'nếu quý khách chuẩn bị', root:'준비하다', struct:'준비 + 하다 + 시 + 면', type:'동사', origin:'hán hàn', note:'' },
  '준비했습니다':{ vi:'đã chuẩn bị', root:'준비하다', struct:'준비 + 하다 + 었 + 습니다', type:'동사', origin:'hán hàn', note:'' },
  '준비해':      { vi:'chuẩn bị (dạng liên kết)', root:'준비하다', struct:'준비 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '출발하겠습니다':{ vi:'chúng ta sẽ xuất phát', root:'출발하다', struct:'출발 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'' },
  '출발하니':    { vi:'vì sắp xuất phát...', root:'출발하다', struct:'출발 + 하다 + 니', type:'동사', origin:'hán hàn', note:'니 = đuôi giải thích lý do' },
  '출발합니다':  { vi:'(chúng ta) xuất phát', root:'출발하다', struct:'출발 + 하다 + ㅂ니다', type:'동사', origin:'hán hàn', note:'' },
  '도착합니다':  { vi:'(chúng ta) sắp đến', root:'도착하다', struct:'도착 + 하다 + ㅂ니다', type:'동사', origin:'hán hàn', note:'' },
  '탑승하겠습니다':{ vi:'chúng ta sẽ lên xe/tàu', root:'탑승하다', struct:'탑승 + 하다 + 겠 + 습니다', type:'동사', origin:'hán hàn', note:'' },
  '탑승해':      { vi:'lên (xe/tàu) — dạng liên kết', root:'탑승하다', struct:'탑승 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '결제하세요':  { vi:'xin hãy thanh toán', root:'결제하다', struct:'결제 + 하다 + 세요', type:'동사', origin:'hán hàn', note:'' },
  '이용해':      { vi:'sử dụng (dạng liên kết)', root:'이용하다', struct:'이용 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '공유해':      { vi:'chia sẻ (dạng liên kết)', root:'공유하다', struct:'공유 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '추천해':      { vi:'giới thiệu (dạng liên kết)', root:'추천하다', struct:'추천 + 하다 + 어', type:'동사', origin:'hán hàn', note:'' },
  '오시느라':    { vi:'vì quý khách đã vất vả đến', root:'오다', struct:'오다 + 시 + 느라', type:'동사', origin:'thuần hàn', note:'느라 = đuôi chỉ lý do bận rộn' },
  '오시느라':    { vi:'vì quý khách đã đến', root:'오다', struct:'오다 + 시 + 느라', type:'동사', origin:'thuần hàn', note:'' },
};

// ── Hàm phân tích chính — phiên bản đầy đủ ──────────────────
function analyzeWordFull(w) {
  const clean = w.replace(/[?!,.]$/,'');

  // 0. Tra bảng EXTRA_WORD_DB (ưu tiên cao nhất — các biến thể hay gặp)
  if (EXTRA_WORD_DB[clean]) {
    const e = EXTRA_WORD_DB[clean];
    const originClean = normOrigin(e.origin || 'thuần hàn');
    const hanjaInfo = lookupHanja(clean, e.root || '');
    return {
      word: w,
      meaning_vi: e.vi,
      root: e.root || clean,
      structure: e.struct || '',
      word_type: e.type || '동사',
      origin_type: originClean,
      hanja: hanjaInfo ? hanjaInfo.hanja : '',
      han_viet: hanjaInfo ? hanjaInfo.han_viet : '',
      han_viet_meaning: hanjaInfo ? hanjaInfo.meaning : '',
      pure_vietnamese: e.vi,
      usage_note: e.note || '',
      components: [],
    };
  }

  // 1. Tra STEM_DICT trực tiếp
  if (STEM_DICT[clean]) {
    const [vi, type, origin, hanja] = STEM_DICT[clean];
    const hanjaInfo = lookupHanja(clean, '');
    return buildItem(w, vi, clean, '', type, normOrigin(origin), hanja, hanjaInfo, '', []);
  }

  // 2. Thử tách trợ từ
  for (const {sfx, vi: pvi} of PARTICLE_SFXS) {
    if (clean.endsWith(sfx) && clean.length > sfx.length) {
      const stem = clean.slice(0, clean.length - sfx.length);
      const stemEntry = lookupStem(stem);
      if (stemEntry) {
        const [vi, type, origin, hanja_raw] = stemEntry;
        const hanjaInfo = lookupHanja(stem, '');
        const pInfo = PARTICLE_DB[sfx] || { vi: pvi, role: '' };
        return buildItem(
          w, vi, stem, `${stem} + ${sfx}`, type, normOrigin(origin), hanja_raw || (hanjaInfo ? hanjaInfo.hanja : ''),
          hanjaInfo, '',
          [
            { ko: stem, vi: vi, role: 'Danh từ/Từ chính' },
            { ko: sfx,  vi: pInfo.vi, role: `Trợ từ — ${pInfo.role}` }
          ]
        );
      }
    }
  }

  // 3. Thử tách đuôi động từ
  for (const {sfx, vi: evi, type: etype, base_fn} of VERB_ENDINGS) {
    if (clean.endsWith(sfx) && clean.length > sfx.length) {
      const stemPart = clean.slice(0, clean.length - sfx.length);
      const baseForm = base_fn(stemPart);
      const stemEntry = lookupStem(stemPart) || lookupStem(baseForm);
      const grammarInfo = GRAMMAR_ENDINGS[sfx];
      const hanjaInfo = lookupHanja(stemPart, baseForm);
      const originGuess = stemEntry ? normOrigin(stemEntry[2]) : guessOriginKo(stemPart);
      const meaning = stemEntry ? stemEntry[0] : '';
      const type = stemEntry ? stemEntry[1] : etype;
      const struct = grammarInfo ? grammarInfo.struct : `${stemPart} + ${sfx}`;
      const components = stemPart ? [
        { ko: stemPart, vi: meaning || `(gốc: ${baseForm})`, role: typeFullLabel(type) },
        { ko: sfx, vi: grammarInfo ? grammarInfo.vi : evi, role: `Đuôi ngữ pháp — ${grammarInfo ? grammarInfo.explain : ''}` },
      ] : [];
      return buildItem(
        w,
        meaning ? `${meaning}${grammarInfo ? ' ' + grammarInfo.vi : ''}` : `${stemPart}... ${evi}`,
        baseForm, struct, type, originGuess,
        hanjaInfo ? hanjaInfo.hanja : '',
        hanjaInfo, grammarInfo ? grammarInfo.explain : '',
        components
      );
    }
  }

  // 4. Tách trợ từ đơn cuối
  const stripped2 = clean.replace(/[은는이가을를에도만의씩]$/, '');
  if (stripped2 !== clean && stripped2.length > 0) {
    const sfxSingle = clean.slice(stripped2.length);
    const stemEntry2 = lookupStem(stripped2);
    const pInfo2 = PARTICLE_DB[sfxSingle] || { vi: `(${sfxSingle})`, role: 'trợ từ' };
    if (stemEntry2) {
      const [vi2, type2, origin2, hanja2] = stemEntry2;
      const hanjaInfo2 = lookupHanja(stripped2, '');
      return buildItem(
        w, vi2, stripped2, `${stripped2} + ${sfxSingle}`,
        type2, normOrigin(origin2), hanja2 || (hanjaInfo2 ? hanjaInfo2.hanja : ''),
        hanjaInfo2, '',
        [
          { ko: stripped2, vi: vi2, role: typeFullLabel(type2) },
          { ko: sfxSingle, vi: pInfo2.vi, role: `Trợ từ — ${pInfo2.role}` }
        ]
      );
    }
  }

  // 5. Fallback — vẫn đưa ra nghĩa tốt nhất có thể
  const fbOrigin = guessOriginKo(clean);
  const fbType = guessTypeKo(clean);
  const fbMeaning = guessMeaningKo(clean);
  const fbHanja = lookupHanja(clean, '');
  return buildItem(w, fbMeaning, guessRootKo(clean), '', fbType, fbOrigin,
    fbHanja ? fbHanja.hanja : '', fbHanja, '', []);
}

function lookupHanja(word, root) {
  // Tìm trong HANJA_DB theo chính xác hoặc theo stem
  for (const key of [word, root, ...Object.keys(HANJA_DB)]) {
    if (word.includes(key) && HANJA_DB[key]) return HANJA_DB[key];
    if (root && root.includes(key) && HANJA_DB[key]) return HANJA_DB[key];
  }
  return null;
}

function buildItem(word, vi, root, struct, type, origin, hanja, hanjaInfo, explain, components) {
  return {
    word, meaning_vi: vi || `(${word})`, root, structure: struct,
    word_type: type, origin_type: origin,
    hanja: hanja || (hanjaInfo ? hanjaInfo.hanja : ''),
    han_viet: hanjaInfo ? hanjaInfo.han_viet : '',
    han_viet_meaning: hanjaInfo ? hanjaInfo.meaning : '',
    pure_vietnamese: vi || '',
    usage_note: explain || '',
    components: components || [],
  };
}

function typeFullLabel(type) {
  const map = {
    '동사': 'Động từ',
    '형용사': 'Tính từ',
    '명사': 'Danh từ',
    '부사': 'Trạng từ',
    '조사': 'Trợ từ',
    '어미': 'Đuôi ngữ pháp',
    '대명사': 'Đại từ',
    '감탄사': 'Thán từ',
    '수사': 'Số từ',
    '의존명사': 'Danh từ phụ thuộc',
    '서술격조사': 'Vị ngữ tố',
  };
  for (const [k, v] of Object.entries(map)) { if ((type||'').includes(k)) return v; }
  return type || 'Từ vựng';
}

// ── Nhãn loại từ với icon ────────────────────────────────────
function typeLabel(type) {
  const map = {
    '동사':       '🔴 Động từ (동사)',
    '형용사':     '🟣 Tính từ (형용사)',
    '명사':       '🟠 Danh từ (명사)',
    '부사':       '🟡 Trạng từ (부사)',
    '조사':       '⚫ Trợ từ (조사)',
    '어미':       '🔵 Đuôi ngữ pháp (어미)',
    '대명사':     '🟢 Đại từ (대명사)',
    '감탄사':     '🩷 Thán từ (감탄사)',
    '수사':       '🔢 Số từ (수사)',
    '의존명사':   '🟤 Danh từ phụ thuộc',
    '서술격조사': '🔵 Vị ngữ tố',
    '접속사':     '🩵 Liên từ',
    'ngoại lai':  '⚪ Ngoại lai (외래어)',
    '수관형사':   '🔢 Số định từ',
    '관형사':     '🟦 Định từ (관형사)',
  };
  for (const [k, v] of Object.entries(map)) { if ((type||'').includes(k)) return v; }
  return '◻️ ' + (type || 'từ vựng');
}

function originLabel(origin, hanja) {
  if (origin === 'thuần hàn') return { cls:'tag-native', label:'🟡 Thuần Hàn (고유어)' };
  if (origin === 'hán hàn')   return { cls:'tag-sino',   label:`🔵 Hán Hàn (한자어)${hanja ? ' — ' + hanja : ''}` };
  if (origin === 'ngoại lai') return { cls:'tag-unknown', label:'⚪ Ngoại lai (외래어)' };
  return { cls:'tag-unknown', label:'◻️ ' + origin };
}

// ── RENDER MẶT SAU — đầy đủ theo format yêu cầu ─────────────
async function renderAnalysis(root, s) {
  root.innerHTML = '';
  const items = s.analysis || buildAnalysisOffline(s.korean);

  items.forEach((item, idx) => {
    const { cls, label } = originLabel(item.origin_type || item.origin, item.hanja);

    // ── Khối cấu tạo hình vị ──
    let structHtml = '';
    if (item.structure) {
      structHtml = `<div class="word-struct">🔧 Cấu tạo: <code>${item.structure}</code></div>`;
    }

    // ── Phân tích từng thành phần ──
    let componentsHtml = '';
    if (item.components && item.components.length > 1) {
      componentsHtml = `<div class="morpheme-row">` +
        item.components.map(c =>
          `<span class="morpheme-chip">
            <span class="morpheme-ko">${c.ko}</span>
            <span class="morpheme-gloss">${c.vi}</span>
            ${c.role ? `<span class="morpheme-role">${c.role}</span>` : ''}
          </span>`
        ).join('<span class="morpheme-plus">+</span>') +
        `</div>`;
    }

    // ── Hán Hàn 2 lớp ──
    let hanjaHtml = '';
    if ((item.origin_type === 'hán hàn' || item.origin === 'hán hàn') && (item.hanja || item.han_viet)) {
      hanjaHtml = `<div class="hanja-block">
        ${item.hanja ? `<div class="hanja-row"><span class="hanja-label">Hán tự</span><span class="hanja-val">${item.hanja}</span></div>` : ''}
        ${item.han_viet ? `<div class="hanja-row"><span class="hanja-label">Âm Hán Việt</span><span class="hanja-val hv-sound">${item.han_viet}</span></div>` : ''}
        ${item.han_viet_meaning ? `<div class="hanja-row"><span class="hanja-label">Nghĩa HV</span><span class="hanja-val hv-meaning">${item.han_viet_meaning}</span></div>` : ''}
      </div>`;
    }

    // ── Ghi chú ngữ pháp / gốc từ ──
    let noteHtml = '';
    if (item.usage_note) {
      noteHtml = `<p class="word-note">💡 ${item.usage_note}</p>`;
    }

    const row = document.createElement('article');
    row.className = 'word-item';
    row.innerHTML = `
      <div class="word-head">
        <div class="word-head-left">
          <strong class="word-ko">${item.word}</strong>
          ${item.root && item.root !== item.word
            ? `<span class="word-root">← gốc: ${item.root}</span>` : ''}
        </div>
        <button class="AudioButton" title="Nghe phát âm">🔊</button>
      </div>
      ${structHtml}
      ${componentsHtml}
      <p class="word-meaning">📖 ${item.meaning_vi}</p>
      <div class="word-tags">
        <span class="type-tag">${typeLabel(item.word_type || item.type)}</span>
        <span class="origin-tag ${cls}">${label}</span>
      </div>
      ${hanjaHtml}
      ${noteHtml}
    `;
    row.querySelector('.AudioButton').addEventListener('click', () => speak(item.word, 0.8));
    root.append(row);
  });
}

function buildAnalysisOffline(sentence) {
  return sentence.trim().split(/\s+/).filter(Boolean).map(w => analyzeWordFull(w));
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

// ── Phát âm tiếng Hàn — Android-safe ───────────────────────
let _koVoice = null;

function _loadKoreanVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  _koVoice = voices.find(v => v.lang === 'ko-KR')
          || voices.find(v => v.lang.startsWith('ko'))
          || null;
}

if ('speechSynthesis' in window) {
  _loadKoreanVoice();
  window.speechSynthesis.onvoiceschanged = _loadKoreanVoice;
}

function speak(text, rate) {
  speakKorean(text, rate);
}

function speakKorean(text, rate) {
  if (!text || typeof text !== 'string' || !text.trim()) return;
  if (!('speechSynthesis' in window)) return;

  // Android: cancel trước, sau đó tạo utterance trong setTimeout(0)
  window.speechSynthesis.cancel();

  const _rate = (typeof rate === 'number' && rate > 0) ? rate : 0.9;

  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text.trim());
    u.lang = 'ko-KR';
    u.rate = _rate;
    u.pitch = 1;
    u.volume = 1;

    // Thử lấy voice Hàn nếu có
    if (_koVoice) {
      u.voice = _koVoice;
    } else {
      // Thử load lại lần nữa (trường hợp Android chưa sẵn sàng)
      _loadKoreanVoice();
      if (_koVoice) u.voice = _koVoice;
    }

    window.speechSynthesis.speak(u);
  }, 50);
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

// ════════════════════════════════════════════════════════════════
//  MODULE: CỤM TỪ CỦA TÔI — Tự thêm, lưu localStorage, học như flashcard cũ
// ════════════════════════════════════════════════════════════════

const MY_PHRASES_KEY = 'ktour-my-phrases-v1';

function loadMyPhrases() {
  try { return JSON.parse(localStorage.getItem(MY_PHRASES_KEY) || '[]'); } catch { return []; }
}

function saveMyPhrases(list) {
  localStorage.setItem(MY_PHRASES_KEY, JSON.stringify(list));
}

function myPhraseToSentence(p) {
  // Chuyển custom phrase thành cùng format với SENTENCES để tái dùng FlashcardSentence
  return {
    id: p.id,
    topic: p.topic || 'Cụm từ của tôi',
    topicId: 'my',
    korean: p.korean,
    romanization: p.roman || '',
    vietnamese: p.vietnamese,
    image: getSemanticEmoji(p.vietnamese) || '✍️',
    analysis: p.analysis || null,
    naturalMeaning: p.vietnamese,
    usage: p.note || '',
    similarPatterns: [p.korean],
    sessionIndex: 0,
    sessionTime: '—',
    _isCustom: true,
  };
}

// ── STATE cho edit ──
let myEditId = null;   // null = đang thêm mới, string = đang sửa

function renderMyTab() {
  refs.viewRoot.innerHTML = '';

  const myPhrases = loadMyPhrases();

  // ── Khu vực form nhập ──
  const formPanel = document.createElement('article');
  formPanel.className = 'simple-panel';
  formPanel.innerHTML = `
    <h3 class="panel-title">✍️ Cụm từ của tôi</h3>
    <p class="panel-subtitle">Tự thêm cụm từ/câu tiếng Hàn, lưu vĩnh viễn trên máy.</p>

    <div class="my-form" id="myForm">
      <input class="my-input" id="myKorean"    placeholder="Câu / cụm từ tiếng Hàn *" autocomplete="off" autocorrect="off" spellcheck="false">
      <input class="my-input" id="myVietnamese" placeholder="Nghĩa tiếng Việt *">
      <input class="my-input" id="myRoman"      placeholder="Phiên âm (tùy chọn)" autocorrect="off" spellcheck="false">
      <input class="my-input" id="myTopic"      placeholder="Chủ đề (ví dụ: Sân bay, Ăn uống...)">
      <textarea class="my-input my-textarea" id="myNote" placeholder="Ghi chú ngữ cảnh, ví dụ sử dụng (tùy chọn)" rows="2"></textarea>

      <div class="my-form-actions">
        <button class="my-btn my-btn-save" id="mySaveBtn">💾 Lưu cụm từ</button>
        <button class="my-btn my-btn-cancel hidden" id="myCancelBtn">✕ Hủy sửa</button>
      </div>

      <details class="my-bulk-wrap">
        <summary class="my-bulk-toggle">📋 Nhập nhanh nhiều cụm từ cùng lúc</summary>
        <p class="my-bulk-hint">Mỗi dòng một cụm từ theo định dạng:<br>
          <code>tiếng hàn | nghĩa việt | phiên âm (tùy chọn) | ghi chú (tùy chọn)</code></p>
        <textarea class="my-input my-textarea" id="myBulkInput" rows="5"
          placeholder="안녕하세요 | Xin chào | an-nyeong-ha-se-yo | Chào hỏi lịch sự&#10;감사합니다 | Cảm ơn | gam-sa-ham-ni-da&#10;죄송합니다 | Xin lỗi | jwe-song-ham-ni-da | Khi có lỗi với khách"></textarea>
        <button class="my-btn my-btn-bulk" id="myBulkBtn">⚡ Thêm tất cả</button>
      </details>
    </div>
  `;
  refs.viewRoot.append(formPanel);

  // ── Khu vực danh sách ──
  const listPanel = document.createElement('article');
  listPanel.className = 'simple-panel';
  listPanel.id = 'myListPanel';
  listPanel.innerHTML = `
    <div class="my-list-head">
      <h3 class="panel-title">Danh sách (${myPhrases.length})</h3>
      <button class="my-btn my-btn-study" id="myStudyAllBtn" ${myPhrases.length ? '' : 'disabled'}>📖 Học tất cả</button>
    </div>
    <div id="myPhraseList"></div>
    ${myPhrases.length === 0 ? '<p class="empty">Chưa có cụm từ nào. Thêm cụm từ đầu tiên ở trên!</p>' : ''}
  `;
  refs.viewRoot.append(listPanel);

  // ── Khu vực học (flashcard) — ẩn ban đầu ──
  const studyPanel = document.createElement('section');
  studyPanel.id = 'myStudySection';
  studyPanel.className = 'hidden';
  refs.viewRoot.append(studyPanel);

  // Render danh sách
  renderMyList(myPhrases);

  // ── Bind form save ──
  document.getElementById('mySaveBtn').addEventListener('click', () => {
    const ko = document.getElementById('myKorean').value.trim();
    const vi = document.getElementById('myVietnamese').value.trim();
    if (!ko || !vi) { alert('Vui lòng nhập ít nhất tiếng Hàn và nghĩa tiếng Việt.'); return; }

    const list = loadMyPhrases();
    if (myEditId) {
      // Đang sửa
      const idx = list.findIndex(p => p.id === myEditId);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          korean: ko,
          vietnamese: vi,
          roman: document.getElementById('myRoman').value.trim(),
          topic: document.getElementById('myTopic').value.trim(),
          note: document.getElementById('myNote').value.trim(),
          updatedAt: Date.now(),
        };
      }
      myEditId = null;
    } else {
      // Thêm mới
      list.push({
        id: 'my-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
        korean: ko,
        vietnamese: vi,
        roman: document.getElementById('myRoman').value.trim(),
        topic: document.getElementById('myTopic').value.trim(),
        note: document.getElementById('myNote').value.trim(),
        createdAt: Date.now(),
      });
    }
    saveMyPhrases(list);
    clearMyForm();
    renderMyTab(); // Re-render toàn bộ tab
  });

  // ── Hủy sửa ──
  document.getElementById('myCancelBtn').addEventListener('click', () => {
    myEditId = null;
    clearMyForm();
    document.getElementById('myCancelBtn').classList.add('hidden');
    document.getElementById('mySaveBtn').textContent = '💾 Lưu cụm từ';
  });

  // ── Nhập nhanh bulk ──
  document.getElementById('myBulkBtn').addEventListener('click', () => {
    const raw = document.getElementById('myBulkInput').value.trim();
    if (!raw) return;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const list = loadMyPhrases();
    let added = 0;
    lines.forEach(line => {
      const parts = line.split('|').map(x => x.trim());
      const ko = parts[0]; const vi = parts[1];
      if (!ko || !vi) return;
      list.push({
        id: 'my-' + Date.now() + '-' + Math.random().toString(36).slice(2,6) + added,
        korean: ko, vietnamese: vi,
        roman: parts[2] || '',
        topic: '',
        note: parts[3] || '',
        createdAt: Date.now(),
      });
      added++;
    });
    saveMyPhrases(list);
    document.getElementById('myBulkInput').value = '';
    renderMyTab();
    if (added) alert(`✅ Đã thêm ${added} cụm từ!`);
  });

  // ── Học tất cả ──
  document.getElementById('myStudyAllBtn')?.addEventListener('click', () => {
    const list = loadMyPhrases();
    if (!list.length) return;
    startMyStudy(list.map(myPhraseToSentence));
  });
}

function renderMyList(myPhrases) {
  const container = document.getElementById('myPhraseList');
  if (!container) return;
  container.innerHTML = '';

  myPhrases.forEach(p => {
    const item = document.createElement('div');
    item.className = 'my-list-item';
    item.innerHTML = `
      <div class="my-item-main">
        <div class="my-item-ko">${p.korean}</div>
        <div class="my-item-vi">${p.vietnamese}</div>
        ${p.roman ? `<div class="my-item-roman">${p.roman}</div>` : ''}
        ${p.topic ? `<span class="my-item-tag">${p.topic}</span>` : ''}
      </div>
      <div class="my-item-actions">
        <button class="my-action-btn" data-id="${p.id}" data-action="speak" title="Phát âm">🔊</button>
        <button class="my-action-btn" data-id="${p.id}" data-action="study" title="Học thẻ này">📖</button>
        <button class="my-action-btn" data-id="${p.id}" data-action="edit" title="Sửa">✏️</button>
        <button class="my-action-btn my-action-del" data-id="${p.id}" data-action="delete" title="Xóa">🗑️</button>
      </div>
    `;
    container.append(item);
  });

  // Bind actions
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const list = loadMyPhrases();
      const phrase = list.find(p => p.id === id);
      if (!phrase) return;

      if (action === 'speak') {
        speak(phrase.korean);
      } else if (action === 'study') {
        startMyStudy([myPhraseToSentence(phrase)]);
      } else if (action === 'edit') {
        myEditId = id;
        document.getElementById('myKorean').value = phrase.korean;
        document.getElementById('myVietnamese').value = phrase.vietnamese;
        document.getElementById('myRoman').value = phrase.roman || '';
        document.getElementById('myTopic').value = phrase.topic || '';
        document.getElementById('myNote').value = phrase.note || '';
        document.getElementById('mySaveBtn').textContent = '💾 Cập nhật';
        document.getElementById('myCancelBtn').classList.remove('hidden');
        // Scroll lên form
        document.getElementById('myForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (action === 'delete') {
        if (!confirm(`Xóa cụm từ "${phrase.korean}"?`)) return;
        const newList = list.filter(p => p.id !== id);
        saveMyPhrases(newList);
        renderMyTab();
      }
    });
  });
}

function clearMyForm() {
  ['myKorean','myVietnamese','myRoman','myTopic','myNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ── Học flashcard từ danh sách custom ──
function startMyStudy(sentences) {
  if (!sentences.length) return;

  // Ẩn form/list, hiện khu vực học
  document.querySelector('.simple-panel')?.classList.add('hidden');
  document.getElementById('myListPanel')?.classList.add('hidden');
  const studySection = document.getElementById('myStudySection');
  studySection.classList.remove('hidden');
  studySection.innerHTML = '';

  // Header với nút thoát
  const header = document.createElement('div');
  header.className = 'my-study-header';
  header.innerHTML = `
    <span class="my-study-count">📖 ${sentences.length} cụm từ</span>
    <button class="my-btn my-btn-cancel" id="myExitStudy">✕ Thoát học</button>
  `;
  studySection.append(header);
  document.getElementById('myExitStudy').addEventListener('click', renderMyTab);

  // Ensure progress cho từng custom phrase
  sentences.forEach(s => {
    if (!state.progressById[s.id]) {
      state.progressById[s.id] = {
        id: s.id, isCompleted: false, completedAt: null,
        reviewBucket: false, listenCount: 0, slowListenCount: 0,
        recordCount: 0, selfPlayCount: 0, unlocked: true,
      };
    }
  });

  // Tái dùng FlashcardSentence hiện có
  sentences.forEach(s => {
    const card = FlashcardSentence(s);
    studySection.append(card);
  });
}

window.addEventListener('DOMContentLoaded', init);
