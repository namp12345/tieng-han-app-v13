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

// ── 6. Hàm typeLabel và originLabel (giữ nguyên) ─────────────
function typeLabel(type) {
  const map = {
    '동사':'🔴 Động từ (동사)', '형용사':'🟣 Tính từ (형용사)',
    '명사':'🟠 Danh từ (명사)', '부사':'🟡 Trạng từ (부사)',
    '조사':'⚫ Trợ từ (조사)', '어미':'🔵 Đuôi ngữ pháp (어미)',
    '대명사':'🟢 Đại từ (대명사)', '감탄사':'🩷 Thán từ (감탄사)',
    '수사':'🔢 Số từ (수사)', '의존명사':'🟤 Danh từ phụ thuộc',
    '서술격조사':'🔵 Vị ngữ tố', '접속사':'🩵 Liên từ',
    'ngoại lai':'⚪ Ngoại lai (외래어)', '수관형사':'🔢 Số định từ',
    '관형사':'🟦 Định từ (관형사)',
  };
  for (const [k, v] of Object.entries(map)) { if (type.includes(k)) return v; }
  return '◻️ ' + type;
}

function originLabel(origin, hanja) {
  if (origin === 'thuần hàn') return { cls:'tag-native', label:'🟡 Thuần Hàn (고유어)' };
  if (origin === 'hán hàn')   return { cls:'tag-sino',   label:`🔵 Hán Hàn (한자어)${hanja ? ' — ' + hanja : ''}` };
  return { cls:'tag-unknown', label:'⚪ Ngoại lai / Khác (외래어)' };
}

// ── 7. Render & buildAnalysis ─────────────────────────────────
async function renderAnalysis(root, s) {
  root.innerHTML = '';
  const analysis = s.analysis || buildAnalysisOffline(s.korean);
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
  return sentence.trim().split(/\s+/).filter(Boolean).map(w => analyzeWord(w));
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
