'use strict';
/* global api */
// 1. 달력 (월/주 칸 그리기)
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 1. 달력 ──────────────────────────────────
function gridRange() {
  if (state.mode === 'week') {
    const back = (wdOf(state.selected) - state.weekStartsOn + 7) % 7;
    const start = addDays(state.selected, -back);
    return { start, end: addDays(start, 7), month: state.selected.slice(0, 7) };
  }
  const first = `${state.selected.slice(0, 7)}-01`;
  const back = (wdOf(first) - state.weekStartsOn + 7) % 7;
  const start = addDays(first, -back);
  return { start, end: addDays(start, 42), month: state.selected.slice(0, 7) };
}

async function ensureHolidays(range) {
  const y1 = +range.start.slice(0, 4);
  const y2 = +range.end.slice(0, 4);
  const have = state.holidayYears;
  if (have && y1 >= have[0] && y2 <= have[1]) return;
  try {
    state.holidays = await api.holidays(y1 - 1, y2 + 1);
    state.holidayYears = [y1 - 1, y2 + 1];
  } catch (err) { fail(err); }
}

async function loadRange() {
  const r = gridRange();
  await ensureHolidays(r);
  try {
    state.occ = await api.range(r.start, r.end);
    state.range = r;
  } catch (err) {
    state.occ = [];
    fail(err);
  }
}

function dayClasses(d) {
  const cls = [];
  const wd = wdOf(d);
  if (wd === 0) cls.push('sun');
  if (wd === 6) cls.push('sat');
  if (state.holidays[d]) cls.push('holiday');
  return cls;
}

function renderCalendar() {
  const r = state.range || gridRange();
  const [y, m] = state.selected.split('-').map(Number);
  $('#calTitle').textContent = `${y}년 ${m}월`;
  $('#menuMonth').setAttribute('aria-checked', state.mode === 'month');
  $('#menuWeek').setAttribute('aria-checked', state.mode === 'week');
  // '오늘' 칩은 지금 보는 달(주)에 오늘이 없을 때만
  $('#todayBtn').hidden = state.mode === 'week' ? state.today >= r.start && state.today < r.end : r.month === state.today.slice(0, 7);

  const wds = $('#weekdays');
  wds.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const w = (state.weekStartsOn + i) % 7;
    wds.appendChild(el('div', w === 0 ? 'sun' : w === 6 ? 'sat' : '', WD[w]));
  }

  const grid = $('#grid');
  grid.classList.toggle('week', state.mode === 'week');
  grid.replaceChildren();
  const days = Math.round((toMs(r.end) - toMs(r.start)) / DAY);
  const maxChips = state.mode === 'week' ? 6 : 3;
  for (let i = 0; i < days; i++) {
    const d = addDays(r.start, i);
    const cell = el('button', ['cell', ...dayClasses(d)].join(' '));
    cell.type = 'button';
    cell.dataset.date = d;
    cell.setAttribute('role', 'gridcell');
    if (state.mode === 'month' && d.slice(0, 7) !== r.month) cell.classList.add('other');
    if (d === state.today) cell.classList.add('today');
    if (d === state.selected) {
      cell.classList.add('selected');
      cell.setAttribute('aria-selected', 'true');
    }
    cell.tabIndex = d === state.selected ? 0 : -1;

    const head = el('span', 'head');
    head.appendChild(el('span', 'num', String(+d.slice(8))));
    const hol = state.holidays[d];
    if (hol) head.appendChild(el('span', 'hname', hol[0].startsWith('대체공휴일') ? '대체휴일' : hol[0]));
    cell.appendChild(head);

    const items = state.occ.filter((o) => overlapsDay(o, d));
    const dots = el('span', 'dots');
    const chips = el('span', 'chips');
    items.slice(0, 3).forEach((o) => dots.appendChild(el('span', `dot c-${o.color}`)));
    if (items.length > 3) dots.appendChild(el('span', 'more', `+${items.length - 3}`));
    items.slice(0, maxChips).forEach((o) => {
      const c = el('span', `chip c-${o.color}${o.allDay ? '' : ' timed'}`, o.title);
      chips.appendChild(c);
    });
    if (items.length > maxChips) chips.appendChild(el('span', 'more', `${items.length - maxChips}개 더`));
    cell.appendChild(dots);
    cell.appendChild(chips);

    const label = `${+d.slice(5, 7)}월 ${+d.slice(8)}일 ${WD_LONG[wdOf(d)]}${hol ? `, ${hol.join(', ')}` : ''}${items.length ? `, 일정 ${items.length}개` : ''}`;
    cell.setAttribute('aria-label', label);
    grid.appendChild(cell);
  }
}
