'use strict';
/* global api */
// 3. 메모 (입력 즉시 저장, 삭제 되돌리기)
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 3. 메모 ──────────────────────────────────
const memoTimers = new Map();

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function memoStamp(m) {
  const d = new Date(m.updatedAt);
  const same = d.toDateString() === new Date().toDateString();
  return same ? `오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function renderMemos(focusId) {
  const list = $('#memoList');
  list.replaceChildren();
  if (!state.memos.length) {
    list.appendChild(el('li', 'memo-empty', '할 일, 아이디어처럼 날짜와 상관없는 내용을 적어 두세요.'));
    return;
  }
  for (const m of state.memos) {
    const li = el('li', m.done ? 'memo done' : 'memo');
    li.dataset.id = m.id;
    const grip = el('span', 'grip');
    grip.title = '끌어서 순서 바꾸기 (Alt+↑↓)';
    grip.appendChild(icon(ICON.grip));
    grip.addEventListener('pointerdown', (e) => dragMemo(e, li));
    const check = el('input');
    check.type = 'checkbox';
    check.checked = !!m.done;
    check.setAttribute('aria-label', '완료');
    check.title = '완료 (Alt+Enter)';
    check.addEventListener('change', () => setMemoDone(m, check.checked, li));
    const ta = el('textarea');
    ta.value = m.text;
    ta.rows = 1;
    ta.placeholder = '메모 입력';
    ta.setAttribute('aria-label', '메모');
    const stamp = el('div', 'stamp', memoStamp(m));
    ta.addEventListener('input', () => {
      autoGrow(ta);
      clearTimeout(memoTimers.get(m.id));
      memoTimers.set(m.id, setTimeout(() => saveMemoNow(m, ta.value, stamp), 400));
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        check.click(); // 쓰는 중에 완료 켜고 끄기
        return;
      }
      const dir = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!dir || !e.altKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (moveMemo(li, dir)) saveMemoOrder();
    });
    ta.addEventListener('blur', () => {
      clearTimeout(memoTimers.get(m.id));
      if (!ta.value.trim()) removeMemo(m, false);
      else if (ta.value !== m.text) saveMemoNow(m, ta.value, stamp);
    });
    const del = el('button', 'icon-btn del');
    del.type = 'button';
    del.title = '메모 삭제';
    del.setAttribute('aria-label', '메모 삭제');
    del.appendChild(icon(ICON.close));
    del.addEventListener('mousedown', (e) => e.preventDefault()); // blur 저장보다 먼저 처리
    del.addEventListener('click', () => removeMemo(m, true));
    const body = el('div', 'memo-body');
    body.append(ta, stamp);
    li.append(grip, body, del, check);
    list.appendChild(li);
    requestAnimationFrame(() => autoGrow(ta));
    if (m.id === focusId) requestAnimationFrame(() => ta.focus());
  }
}

async function setMemoDone(m, done, li) {
  li.classList.toggle('done', done);
  try {
    Object.assign(m, await api.saveMemo({ id: m.id, text: li.querySelector('textarea').value, done }));
  } catch (err) { fail(err); }
}

const MEMO_SLIDE_MS = 180;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 자리를 옮긴 메모를 원래 보이던 위치(fromTop)에서 새 자리로 미끄러지게 한다
function slideFrom(node, fromTop) {
  const dy = fromTop - node.getBoundingClientRect().top;
  if (!dy || reduceMotion()) return;
  node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MEMO_SLIDE_MS, easing: 'ease' });
}

// 메모를 한 칸 위(-1)/아래(1)로. 옮긴 메모 자체는 그대로 두고 이웃을 건너편으로 옮긴다
// (옮기는 메모를 DOM에서 빼면 입력 포커스가 풀리기 때문).
function moveMemo(li, dir, { slideSelf = true } = {}) {
  const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!other) return false;
  const otherTop = other.getBoundingClientRect().top;
  const selfTop = li.getBoundingClientRect().top;
  li.parentNode.insertBefore(other, dir < 0 ? li.nextElementSibling : li);
  slideFrom(other, otherTop);
  if (slideSelf) slideFrom(li, selfTop);
  return true;
}

// 손잡이를 잡으면 메모가 떠올라 마우스를 따라오고, 가운데가 이웃의 가운데를 넘으면
// 이웃이 미끄러지며 자리를 내준다. 놓으면 새 자리로 부드럽게 내려앉는다.
function dragMemo(e, li) {
  if (e.button !== 0) return;
  e.preventDefault();
  const scroller = $('#scroller');
  const grab = e.clientY - li.getBoundingClientRect().top; // 메모 안에서 잡은 높이
  let pointerY = e.clientY;
  let dy = 0; // 제자리에서 떠 있는 거리
  let moved = false;
  li.classList.add('lifted');
  document.body.classList.add('memo-dragging');

  const follow = () => {
    const layoutTop = li.getBoundingClientRect().top - dy;
    // 메모 목록 밖으로는 나가지 않게 위아래를 막는다
    const box = li.parentNode.getBoundingClientRect();
    const minDy = box.top - layoutTop;
    const maxDy = box.bottom - li.offsetHeight - layoutTop;
    dy = Math.min(Math.max(pointerY - grab - layoutTop, minDy), maxDy);
    li.style.transform = `translateY(${dy}px)`;
  };
  const reorder = () => {
    // 끄는 쪽 가장자리가 이웃의 가운데를 넘으면 자리를 바꾼다(목록 끝에 막혀도 맨 위·맨 아래로 갈 수 있게).
    // 위치 비교는 애니메이션 영향이 없는 offsetTop으로. offsetHeight는 정수로 반올림돼서, 가운데에 딱 걸리면
    // 위·아래 조건이 동시에 참이 되어 끝없이 자리를 바꿀 수 있다 → SWAP_MARGIN만큼 더 넘어야 바꾼다.
    // 빠르게 끌면 한 번에 여러 칸을 넘을 수 있지만, 목록 길이보다 많이 바꿀 일은 없다.
    const SWAP_MARGIN = 4;
    for (let n = li.parentNode.children.length; n > 0; n--) {
      const top = li.offsetTop + dy;
      const bottom = top + li.offsetHeight;
      const prev = li.previousElementSibling;
      const next = li.nextElementSibling;
      if (prev && top < prev.offsetTop + prev.offsetHeight / 2 - SWAP_MARGIN) moveMemo(li, -1, { slideSelf: false });
      else if (next && bottom > next.offsetTop + next.offsetHeight / 2 + SWAP_MARGIN) moveMemo(li, 1, { slideSelf: false });
      else break;
      moved = true;
      follow(); // 자리가 바뀌어 기준 위치가 달라졌으니 다시 맞춘다
    }
  };
  const onMove = (ev) => {
    pointerY = ev.clientY;
    follow();
    reorder();
  };
  const onScroll = () => { follow(); reorder(); };
  const onEnd = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    scroller.removeEventListener('scroll', onScroll);
    document.body.classList.remove('memo-dragging');
    li.classList.remove('lifted');
    li.style.transform = '';
    if (dy && !reduceMotion()) {
      li.style.zIndex = '2'; // 내려앉는 동안 이웃 위에 그린다
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MEMO_SLIDE_MS, easing: 'ease' })
        .finished.catch(() => {}).then(() => { li.style.zIndex = ''; });
    }
    if (moved) saveMemoOrder();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  scroller.addEventListener('scroll', onScroll, { passive: true });
}

async function saveMemoOrder() {
  const ids = [...$('#memoList').children].map((li) => li.dataset.id);
  const byId = new Map(state.memos.map((m) => [m.id, m]));
  state.memos = ids.map((id) => byId.get(id)).filter(Boolean);
  try {
    await api.reorderMemos(ids);
  } catch (err) { fail(err); }
}

async function saveMemoNow(m, text, stampEl) {
  try {
    const saved = await api.saveMemo({ id: m.id, text });
    Object.assign(m, saved);
    if (stampEl) stampEl.textContent = memoStamp(m);
  } catch (err) { fail(err); }
}

async function removeMemo(m, withUndo) {
  clearTimeout(memoTimers.get(m.id));
  const index = state.memos.indexOf(m);
  const ta = $(`.memo[data-id="${m.id}"] textarea`);
  const text = ta ? ta.value : m.text;
  try {
    await api.deleteMemo(m.id);
    state.memos = state.memos.filter((x) => x !== m);
    renderMemos();
    if (withUndo && text.trim()) {
      toast('메모를 삭제했어요', {
        label: '되돌리기',
        run: async () => {
          const back = await api.saveMemo({ id: m.id, text, index, done: !!m.done });
          state.memos.splice(Math.min(index, state.memos.length), 0, back);
          renderMemos();
        },
      });
    }
  } catch (err) { fail(err); }
}

async function addMemo() {
  const existingEmpty = state.memos.find((m) => !m.text.trim());
  if (existingEmpty) {
    renderMemos(existingEmpty.id);
    return;
  }
  try {
    const m = await api.saveMemo({ text: '' });
    state.memos.unshift(m);
    renderMemos(m.id);
  } catch (err) { fail(err); }
}
