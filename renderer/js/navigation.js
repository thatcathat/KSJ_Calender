'use strict';
/* global api */
// 날짜 이동, 단축키, 메인 프로세스에서 오는 신호
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 내비게이션 ───────────────────────────────
async function select(d, { reload } = {}) {
  const before = state.range;
  state.selected = d;
  const r = gridRange();
  if (reload || !before || r.start !== before.start || r.end !== before.end) await loadRange();
  renderCalendar();
  renderDay();
}

function step(dir) {
  if (state.mode === 'week') return select(addDays(state.selected, 7 * dir));
  return select(addMonths(state.selected, dir));
}

$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));
$('#todayBtn').addEventListener('click', () => select(state.today));
$('#addEventBtn').addEventListener('click', () => openEventDialog({ date: state.selected }));
$('#addMemoBtn').addEventListener('click', addMemo);

async function setMode(mode) {
  state.mode = mode;
  api.setSettings({ calendarMode: mode }).catch(() => {});
  await select(state.selected, { reload: true });
}

// ⋯ 메뉴 (popover: 바깥 클릭·Esc로 닫히는 건 브라우저가 처리)
const moreMenu = $('#moreMenu');
const menuItems = () => [...moreMenu.querySelectorAll('button')];
function pickMenu(run) {
  moreMenu.hidePopover();
  run();
}
$('#menuMonth').addEventListener('click', () => pickMenu(() => setMode('month')));
$('#menuWeek').addEventListener('click', () => pickMenu(() => setMode('week')));
moreMenu.addEventListener('toggle', (e) => {
  if (e.newState === 'open') menuItems()[0].focus();
});
// ↑↓로 메뉴 항목 사이를 오간다
moreMenu.addEventListener('keydown', (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const items = menuItems();
  const i = items.indexOf(document.activeElement);
  items[(i + step + items.length) % items.length].focus();
});

$('#grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) select(cell.dataset.date); // 마우스로 고를 땐 포커스 테두리를 띄우지 않음
});
$('#grid').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) openEventDialog({ date: cell.dataset.date });
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (document.querySelector('dialog[open], :popover-open')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const inGrid = t && t.closest && t.closest('#grid');
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (move && inGrid) {
    e.preventDefault();
    const d = addDays(state.selected, move);
    select(d).then(() => $(`.cell[data-date="${d}"]`)?.focus());
    return;
  }
  if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
  else if (e.key === 't' || e.key === 'T') select(state.today);
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEventDialog({ date: state.selected }); }
  else if (e.key === 'Enter' && inGrid) { e.preventDefault(); openEventDialog({ date: state.selected }); }
});

// 메인 프로세스에서 오는 신호
api.on('navigate', (date) => select(date || state.today));
api.on('new-event', () => openEventDialog({ date: state.selected }));
api.on('day-changed', () => {
  const wasToday = state.selected === state.today;
  state.today = todayStr();
  select(wasToday ? state.today : state.selected, { reload: true });
});
// 창을 다시 띄웠을 때 '지난 일정' 표시 갱신
document.addEventListener('visibilitychange', () => { if (!document.hidden) markPast(); });
