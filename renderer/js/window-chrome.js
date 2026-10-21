'use strict';
/* global api */
// 테두리 없는 창 꾸미기: 창 버튼, 직접 그리는 스크롤바, 가장자리 흐림, 위쪽 띠
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 창 버튼 (테두리 없는 창) ──────────────────────
function setMaximized(max) {
  document.body.classList.toggle('maximized', !!max);
  const b = $('#winMax');
  b.title = max ? '이전 크기로' : '최대화';
  b.setAttribute('aria-label', b.title);
}
$('#winMin').addEventListener('click', () => api.win.minimize());
$('#winMax').addEventListener('click', () => api.win.toggleMaximize().then(setMaximized));
$('#winClose').addEventListener('click', () => api.win.close());
api.on('win-state', (st) => setMaximized(st.maximized));
api.win.isMaximized().then(setMaximized).catch(() => {});
const setFocused = () => document.body.classList.toggle('focused', document.hasFocus());
window.addEventListener('focus', setFocused);
window.addEventListener('blur', setFocused);
setFocused();

// ── 직접 그리는 스크롤바 ───────────────────────
// 기본 스크롤바는 CSS로 숨기고, 스크롤 영역마다 얇은 막대(.sb)를 내용 위에 띄운다.
// 막대는 스크롤 중이거나 마우스가 오른쪽 가장자리 근처에 있을 때만 보인다.
const SB_HIDE_MS = 900;
const SB_EDGE_PX = 18;
const SB_INSET = 4; // 위아래 여백
const SB_MIN = 28; // 막대 최소 길이
const scrollbars = [];

function attachScrollbar(scrollEl, host = scrollEl) {
  const bar = el('div', 'sb');
  bar.setAttribute('aria-hidden', 'true');
  host.appendChild(bar);
  let hideTimer = 0;
  let geo = null;

  function update() {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    const r = scrollEl.getBoundingClientRect();
    if (max <= 1 || !r.height || !scrollEl.isConnected || (scrollEl.tagName === 'DIALOG' && !scrollEl.open)) {
      geo = null;
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const track = r.height - SB_INSET * 2;
    const len = Math.max(SB_MIN, track * (scrollEl.clientHeight / scrollEl.scrollHeight));
    const top = r.top + SB_INSET + (track - len) * (scrollEl.scrollTop / max);
    geo = { r, track, len, max };
    bar.style.top = `${top}px`;
    bar.style.height = `${len}px`;
    bar.style.left = `${r.right - 14}px`;
  }

  function flash() {
    update();
    bar.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!bar.classList.contains('near') && !bar.classList.contains('dragging')) bar.classList.remove('show');
    }, SB_HIDE_MS);
  }

  function setNear(near) {
    if (near === bar.classList.contains('near')) return;
    bar.classList.toggle('near', near);
    if (near) { update(); bar.classList.add('show'); clearTimeout(hideTimer); }
    else if (!bar.classList.contains('dragging')) flash();
  }

  // 막대 끌기
  bar.addEventListener('pointerdown', (e) => {
    if (!geo) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging', 'show');
    const startY = e.clientY;
    const startTop = scrollEl.scrollTop;
    const ratio = geo.max / Math.max(1, geo.track - geo.len);
    const move = (ev) => { scrollEl.scrollTop = startTop + (ev.clientY - startY) * ratio; };
    const up = () => {
      bar.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      flash();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });

  scrollEl.addEventListener('scroll', flash, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(scrollEl);
  if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild);
  if (scrollEl.tagName === 'DIALOG') scrollEl.addEventListener('close', () => { bar.classList.remove('show', 'near'); update(); });

  const sb = { scrollEl, bar, update, setNear };
  scrollbars.push(sb);
  update();
  return sb;
}

// 마우스가 오른쪽 가장자리 근처에 오면 막대를 보인다
let sbFrame = 0;
document.addEventListener('pointermove', (e) => {
  if (sbFrame) return;
  sbFrame = requestAnimationFrame(() => {
    sbFrame = 0;
    // 열린 다이얼로그가 있으면 그 안의 막대만 반응
    const openDlg = document.querySelector('dialog[open]');
    for (const sb of scrollbars) {
      const active = openDlg ? sb.scrollEl === openDlg : sb.scrollEl.tagName !== 'DIALOG';
      let near = false;
      if (active && !sb.bar.hidden) {
        const r = sb.scrollEl.getBoundingClientRect();
        near = e.clientY >= r.top && e.clientY <= r.bottom && e.clientX <= r.right && e.clientX >= r.right - SB_EDGE_PX;
      }
      sb.setNear(near);
    }
  });
}, { passive: true });
window.addEventListener('resize', () => scrollbars.forEach((sb) => sb.update()));

attachScrollbar($('#scroller'), document.body);

// 위아래 가장자리 흐림: 그쪽으로 잘려 나간 내용이 있을 때만 켠다
(function edgeBlur() {
  const sc = $('#scroller');
  const top = $('#edgeTop');
  const bottom = $('#edgeBottom');
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = sc.scrollHeight - sc.clientHeight;
    top.classList.toggle('on', sc.scrollTop > 2);
    bottom.classList.toggle('on', max - sc.scrollTop > 2);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  sc.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule);
  ro.observe(sc);
  ro.observe(sc.firstElementChild);
  update();
})();
for (const d of document.querySelectorAll('dialog.sheet')) {
  attachScrollbar(d);
  // 열릴 때 등장 애니메이션이 끝난 뒤 위치를 다시 잰다
  d.addEventListener('animationend', () => scrollbars.forEach((sb) => sb.update()));
}

// ── 위쪽 띠: 맨 위 가장자리에 마우스를 올리면 내려오기 ───────
// 띠의 빈 곳(끌기 영역) 위에서는 화면이 마우스를 감지하지 못하므로,
// 그때 마우스가 창 밖으로 나갔는지는 메인 프로세스가 커서 위치로 확인해 알려준다.
const TB_HEIGHT = 34;
const TB_HIDE_BELOW = TB_HEIGHT + 14; // 이 아래로 내려가면 숨김(살짝 여유를 둬 깜박임 방지)
const TB_HIDE_DELAY = 220;
let tbHideTimer = 0;

function showTitlebar() {
  clearTimeout(tbHideTimer);
  document.body.classList.add('tb-show');
}
function hideTitlebar(delay = TB_HIDE_DELAY) {
  clearTimeout(tbHideTimer);
  tbHideTimer = setTimeout(() => document.body.classList.remove('tb-show'), delay);
}

$('#tbHotzone').addEventListener('pointerenter', showTitlebar);
document.addEventListener('pointermove', (e) => {
  if (!document.body.classList.contains('tb-show')) return;
  if (e.clientY > TB_HIDE_BELOW) hideTitlebar();
  else showTitlebar();
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => {
  if (document.body.classList.contains('tb-show')) api.win.watchPointer().catch(() => hideTitlebar(0));
});
api.on('pointer-out', () => hideTitlebar(0));
// 창 밖으로 나갔다가 위쪽 띠로 바로 들어오는 경우를 위해 감지 영역은 늘 살아 있음
// 다이얼로그가 열리면 띠를 접는다
for (const d of document.querySelectorAll('dialog')) d.addEventListener('toggle', () => { if (d.open) hideTitlebar(0); });
