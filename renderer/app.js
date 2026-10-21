'use strict';
/* global api */

// ── 날짜 유틸 (문자열 'YYYY-MM-DD' 기준, 시간대 영향 없게 UTC로 계산) ──────
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const toMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0));
const fromMs = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const addDays = (s, n) => fromMs(toMs(s) + n * DAY);
const wdOf = (s) => new Date(toMs(s)).getUTCDay();
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowStr = () => { const d = new Date(); return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const isDateOnly = (s) => s.length === 10;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WD_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const COLORS = ['blue', 'red', 'green', 'amber', 'violet', 'teal', 'slate'];
const COLOR_NAMES = { blue: '파랑', red: '빨강', green: '초록', amber: '노랑', violet: '보라', teal: '청록', slate: '회색' };

function addMonths(s, n) {
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, d = +s.slice(8, 10);
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

// 하루 [d, d+1) 와 겹치는지
function overlapsDay(o, d) {
  const next = addDays(d, 1);
  if (o.allDay) return o.start < next && o.end > d;
  return o.start < next && (o.end > `${d}T00:00` || o.start === o.end && o.start >= d);
}

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const icon = (paths) => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
};
const ICON = {
  repeat: ['M4 8.5a5 5 0 0 1 9-2.5l1.5 1.5', 'M14.5 4v3.5H11', 'M16 11.5a5 5 0 0 1-9 2.5L5.5 12.5', 'M5.5 16v-3.5H9'],
  bell: ['M6 8a4 4 0 1 1 8 0c0 4 1.5 5.5 1.5 5.5h-11S6 12 6 8Z', 'M8.5 16a1.6 1.6 0 0 0 3 0'],
  pin: ['M10 17s5-4.6 5-8.5a5 5 0 0 0-10 0C5 12.4 10 17 10 17Z', 'M10 10.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z'],
  close: ['M5 5l10 10M15 5 5 15'],
};

// ── 상태 ─────────────────────────────────────
const state = {
  selected: todayStr(),
  today: todayStr(),
  mode: 'month',
  weekStartsOn: 0,
  settings: null,
  occ: [],
  range: null,
  holidays: {},
  holidayYears: null,
  memos: [],
};

// ── 알림 시간 옵션 ─────────────────────────────
const TIMED_REMINDERS = [[0, '정시'], [5, '5분 전'], [10, '10분 전'], [15, '15분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [1440, '1일 전'], [2880, '2일 전'], [10080, '1주 전']];
const ALLDAY_REMINDERS = [[0, '당일 오전 9시'], [1440, '전날 오전 9시'], [2880, '2일 전 오전 9시'], [10080, '1주 전 오전 9시']];
function reminderLabel(m, allDay) {
  const found = (allDay ? ALLDAY_REMINDERS : TIMED_REMINDERS).find(([v]) => v === m);
  if (found) return found[1];
  if (m % 1440 === 0) return `${m / 1440}일 전`;
  if (m % 60 === 0) return `${m / 60}시간 전`;
  return `${m}분 전`;
}

// ── 토스트 ───────────────────────────────────
let toastTimer;
function toast(text, action) {
  const t = $('#toast');
  $('#toastText').textContent = text;
  const btn = $('#toastAction');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { t.hidden = true; action.run(); };
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
}
const fail = (err) => toast(err && err.message ? err.message : '처리하지 못했어요. 다시 시도해 주세요.');

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
  $('#modeMonth').setAttribute('aria-pressed', state.mode === 'month');
  $('#modeWeek').setAttribute('aria-pressed', state.mode === 'week');

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

// ── 2. 일력 페이지 + 일정 ─────────────────────
let lunarReq = 0;
async function renderDay() {
  const d = state.selected;
  const page = $('#daypage');
  page.className = ['daypage', ...dayClasses(d)].join(' ');
  $('#dayNum').textContent = String(+d.slice(8));
  const isToday = d === state.today;
  $('#dayWd').textContent = WD_LONG[wdOf(d)] + (isToday ? ' · 오늘' : '');
  const base = `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월`;
  $('#daySub').textContent = base;
  $('#dayHol').textContent = (state.holidays[d] || []).join(', ');

  const req = ++lunarReq;
  api.lunar(d).then((l) => {
    if (req !== lunarReq || !l) return;
    $('#daySub').textContent = `${base} · 음력 ${l.leap ? '윤' : ''}${l.month}월 ${l.day}일`;
  }).catch(() => {});

  const list = $('#agenda');
  list.replaceChildren();
  const items = state.occ.filter((o) => overlapsDay(o, d));
  if (!items.length) {
    const li = el('li', 'empty');
    li.appendChild(el('span', '', isToday ? '오늘은 일정이 없어요.' : '이 날은 일정이 없어요.'));
    list.appendChild(li);
    return;
  }
  const now = nowStr();
  for (const o of items) {
    const li = el('li');
    const btn = el('button', `item c-${o.color}`);
    btn.type = 'button';
    if (o.allDay ? o.end <= state.today : o.end <= now) btn.classList.add('past');
    btn.appendChild(el('span', 'bar'));
    const when = el('span', 'when');
    if (o.allDay) {
      const days = Math.round((toMs(o.end) - toMs(o.start)) / DAY);
      when.textContent = '종일';
      if (days > 1) when.appendChild(el('small', '', `${Math.round((toMs(d) - toMs(o.start)) / DAY) + 1}/${days}일째`));
    } else {
      const sDay = o.start.slice(0, 10);
      const eDay = o.end.slice(0, 10);
      when.textContent = sDay === d ? o.start.slice(11, 16) : '계속';
      if (o.end !== o.start) when.appendChild(el('small', '', eDay === d ? `~ ${o.end.slice(11, 16)}` : `~ ${+eDay.slice(5, 7)}/${+eDay.slice(8)} ${o.end.slice(11, 16)}`));
    }
    btn.appendChild(when);
    const what = el('span', 'what');
    what.appendChild(el('span', 'title', o.title));
    const meta = el('span', 'meta');
    if (o.location) { const s = el('span'); s.append(icon(ICON.pin), o.location); meta.appendChild(s); }
    if (o.recurring) { const s = el('span'); s.append(icon(ICON.repeat), describeRec(o)); meta.appendChild(s); }
    if (o.reminders && o.reminders.length) {
      const s = el('span');
      s.append(icon(ICON.bell), o.reminders.map((m) => reminderLabel(m, o.allDay)).join(', '));
      meta.appendChild(s);
    }
    if (meta.childNodes.length) what.appendChild(meta);
    btn.appendChild(what);
    btn.addEventListener('click', () => openEventDialog({ occ: o }));
    btn.setAttribute('aria-label', `${o.title}, ${when.textContent}`);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function describeRec(o) {
  const r = o.recurrence;
  if (!r) return '';
  const n = r.interval || 1;
  const sd = o.seriesStart || o.start;
  if (r.freq === 'daily') return n === 1 ? '매일' : `${n}일마다`;
  if (r.freq === 'weekly') {
    const days = (r.byweekday && r.byweekday.length ? r.byweekday : [wdOf(sd)]).slice().sort().map((x) => WD[x]).join('·');
    return `${n === 1 ? '매주' : `${n}주마다`} ${days}`;
  }
  if (r.freq === 'monthly') {
    const b = n === 1 ? '매월' : `${n}개월마다`;
    if (r.monthlyMode === 'nth') return `${b} ${Math.ceil(+sd.slice(8, 10) / 7)}번째 ${WD[wdOf(sd)]}요일`;
    if (r.monthlyMode === 'last') return `${b} 마지막 ${WD[wdOf(sd)]}요일`;
    return `${b} ${+sd.slice(8, 10)}일`;
  }
  return n === 1 ? '매년' : `${n}년마다`;
}

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
    const li = el('li', 'memo');
    li.dataset.id = m.id;
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
    li.append(ta, stamp, del);
    list.appendChild(li);
    requestAnimationFrame(() => autoGrow(ta));
    if (m.id === focusId) requestAnimationFrame(() => ta.focus());
  }
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
          const back = await api.saveMemo({ id: m.id, text, index });
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

// ── 일정 편집 다이얼로그 ─────────────────────────
const dlg = $('#eventDialog');
const form = $('#eventForm');
let editing = null; // { occ } 또는 null(새 일정)
let reminders = [];

function buildStaticControls() {
  const pick = $('#weekdayPick');
  for (let i = 0; i < 7; i++) {
    const b = el('button', '', WD[i]);
    b.type = 'button';
    b.dataset.wd = i;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', WD_LONG[i]);
    b.addEventListener('click', () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'));
    pick.appendChild(b);
  }
  const sw = $('#swatches');
  for (const c of COLORS) {
    const label = el('label', `c-${c}`);
    label.title = COLOR_NAMES[c];
    const input = el('input');
    input.type = 'radio';
    input.name = 'color';
    input.value = c;
    input.setAttribute('aria-label', COLOR_NAMES[c]);
    label.append(input, el('span'));
    sw.appendChild(label);
  }
}

function fillReminderAdd() {
  const allDay = form.allDay.checked;
  const sel = $('#reminderAdd');
  sel.replaceChildren(new Option('+ 알림 추가', ''));
  for (const [v, label] of allDay ? ALLDAY_REMINDERS : TIMED_REMINDERS) {
    if (!reminders.includes(v)) sel.appendChild(new Option(label, String(v)));
  }
  const chips = $('#reminderChips');
  chips.replaceChildren();
  for (const m of reminders) {
    const c = el('span', 'rchip', reminderLabel(m, allDay));
    const x = el('button');
    x.type = 'button';
    x.setAttribute('aria-label', `${reminderLabel(m, allDay)} 알림 삭제`);
    x.appendChild(icon(ICON.close));
    x.addEventListener('click', () => { reminders = reminders.filter((r) => r !== m); fillReminderAdd(); });
    c.appendChild(x);
    chips.appendChild(c);
  }
}

function startDateValue() { return form.startDate.value || state.selected; }

function updateRepeatUI() {
  const freq = form.freq.value;
  $('#repeatDetail').hidden = !freq;
  $('#intervalUnit').textContent = { daily: '일', weekly: '주', monthly: '개월', yearly: '년' }[freq] || '';
  $('#weekdayPick').hidden = freq !== 'weekly';
  const mm = $('#monthlyMode');
  mm.hidden = freq !== 'monthly';
  if (freq === 'monthly') {
    const sd = startDateValue();
    const day = +sd.slice(8, 10);
    const wd = wdOf(sd);
    const nth = Math.ceil(day / 7);
    const dim = new Date(Date.UTC(+sd.slice(0, 4), +sd.slice(5, 7), 0)).getUTCDate();
    const prev = mm.value;
    mm.replaceChildren(new Option(`매월 ${day}일`, 'day'));
    if (nth <= 4) mm.appendChild(new Option(`매월 ${nth}번째 ${WD_LONG[wd]}`, 'nth'));
    if (day + 7 > dim) mm.appendChild(new Option(`매월 마지막 ${WD_LONG[wd]}`, 'last'));
    if ([...mm.options].some((o) => o.value === prev)) mm.value = prev;
  }
  const endMode = form.endMode.value;
  form.until.hidden = endMode !== 'until';
  $('#countWrap').hidden = endMode !== 'count';
}

function setAllDayUI() {
  $('.when-grid').classList.toggle('all-day', form.allDay.checked);
}

function openEventDialog({ occ, date, startTime } = {}) {
  editing = occ ? { occ } : null;
  form.reset();
  $('#whenError').hidden = true;
  $('#eventDialogTitle').textContent = occ ? '일정 수정' : '새 일정';
  $('#deleteEventBtn').hidden = !occ;
  $('#weekdayPick').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));

  if (occ) {
    form.elements.title.value = occ.title === '(제목 없음)' ? '' : occ.title;
    form.allDay.checked = occ.allDay;
    form.startDate.value = occ.start.slice(0, 10);
    form.startTime.value = occ.allDay ? '09:00' : occ.start.slice(11, 16);
    if (occ.allDay) {
      form.endDate.value = addDays(occ.end, -1);
      form.endTime.value = '10:00';
    } else {
      form.endDate.value = occ.end.slice(0, 10);
      form.endTime.value = occ.end.slice(11, 16);
    }
    form.location.value = occ.location || '';
    form.memo.value = occ.memo || '';
    form.color.value = occ.color || 'blue';
    reminders = [...(occ.reminders || [])];
    const r = occ.recurrence;
    if (r) {
      form.freq.value = r.freq;
      form.interval.value = r.interval || 1;
      (r.byweekday || []).forEach((wd) => $(`#weekdayPick button[data-wd="${wd}"]`).setAttribute('aria-pressed', 'true'));
      form.endMode.value = r.count ? 'count' : r.until ? 'until' : 'never';
      if (r.count) form.count.value = r.count;
      if (r.until) form.until.value = r.until;
    }
    updateRepeatUI();
    if (r && r.freq === 'monthly') $('#monthlyMode').value = r.monthlyMode || 'day';
  } else {
    const d = date || state.selected;
    let s = startTime;
    if (!s) {
      // 오늘이면 다음 정각, 아니면 오전 9시
      const now = new Date();
      s = d === state.today && now.getHours() < 23 ? `${pad(now.getHours() + 1)}:00` : '09:00';
    }
    const [h, mi] = s.split(':').map(Number);
    form.allDay.checked = false;
    form.startDate.value = d;
    form.startTime.value = s;
    form.endDate.value = d;
    form.endTime.value = `${pad(Math.min(h + 1, 23))}:${pad(h + 1 > 23 ? 59 : mi)}`;
    form.color.value = 'blue';
    reminders = [...(state.settings.defaultReminders || [])];
    updateRepeatUI();
  }
  setAllDayUI();
  fillReminderAdd();
  dlg.showModal();
  requestAnimationFrame(() => form.elements.title.focus());
}

function collectForm() {
  const allDay = form.allDay.checked;
  const sd = form.startDate.value;
  const ed = form.endDate.value || sd;
  if (!sd) throw new Error('시작 날짜를 입력하세요.');
  let start, end;
  if (allDay) {
    if (ed < sd) throw new Error('종료 날짜가 시작 날짜보다 빠를 수 없어요.');
    start = sd;
    end = addDays(ed, 1);
  } else {
    start = `${sd}T${form.startTime.value || '09:00'}`;
    end = `${ed}T${form.endTime.value || form.startTime.value || '10:00'}`;
    if (end < start) throw new Error('종료 시간이 시작 시간보다 빠를 수 없어요.');
  }
  let recurrence = null;
  const freq = form.freq.value;
  if (freq) {
    recurrence = { freq, interval: +form.interval.value || 1 };
    if (freq === 'weekly') {
      recurrence.byweekday = [...$('#weekdayPick').querySelectorAll('button[aria-pressed="true"]')].map((b) => +b.dataset.wd);
      if (!recurrence.byweekday.length) recurrence.byweekday = [wdOf(sd)];
      // 시작일의 요일이 빠져 있으면 시작일도 포함되도록
      if (!recurrence.byweekday.includes(wdOf(sd))) recurrence.byweekday.push(wdOf(sd));
    }
    if (freq === 'monthly') recurrence.monthlyMode = $('#monthlyMode').value || 'day';
    if (form.endMode.value === 'count') recurrence.count = Math.max(1, +form.count.value || 1);
    if (form.endMode.value === 'until') {
      if (!form.until.value) throw new Error('반복 종료 날짜를 입력하세요.');
      if (form.until.value < sd) throw new Error('반복 종료 날짜가 시작 날짜보다 빨라요.');
      recurrence.until = form.until.value;
    }
  }
  return {
    title: form.elements.title.value.trim(),
    start,
    end,
    color: form.color.value || 'blue',
    location: form.location.value.trim(),
    memo: form.memo.value,
    reminders: [...reminders],
    recurrence,
  };
}

// 반복 일정 범위 묻기 → 'this' | 'future' | 'all' | null(취소)
function askScope(kind) {
  const sd = $('#scopeDialog');
  $('#scopeTitle').textContent = kind === 'delete' ? '반복 일정 삭제' : '반복 일정 수정';
  return new Promise((resolve) => {
    sd.returnValue = '';
    sd.addEventListener('close', () => resolve(['this', 'future', 'all'].includes(sd.returnValue) ? sd.returnValue : null), { once: true });
    sd.showModal();
  });
}

async function refresh() {
  await loadRange();
  renderCalendar();
  renderDay();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  let data;
  try {
    data = collectForm();
  } catch (err) {
    const box = $('#whenError');
    box.textContent = err.message;
    box.hidden = false;
    return;
  }
  try {
    if (!editing) {
      await api.createEvent(data);
      dlg.close();
      state.selected = data.start.slice(0, 10);
      toast('일정을 추가했어요');
    } else {
      const o = editing.occ;
      let scope = 'all';
      if (o.recurring) {
        dlg.close();
        scope = await askScope('edit');
        if (!scope) { dlg.showModal(); return; }
      }
      await api.updateEvent(o.eventId, { scope, occurrenceStart: o.start, changes: data });
      if (dlg.open) dlg.close();
      state.selected = data.start.slice(0, 10);
      toast('일정을 저장했어요');
    }
    await refresh();
  } catch (err) { fail(err); }
});

$('#deleteEventBtn').addEventListener('click', async () => {
  const o = editing && editing.occ;
  if (!o) return;
  let scope = 'all';
  dlg.close();
  if (o.recurring) {
    scope = await askScope('delete');
    if (!scope) { dlg.showModal(); return; }
  }
  try {
    const original = o.recurring ? null : await api.getEvent(o.eventId);
    await api.deleteEvent(o.eventId, { scope, occurrenceStart: o.start });
    await refresh();
    toast('일정을 삭제했어요', original ? {
      label: '되돌리기',
      run: async () => {
        await api.createEvent(original);
        await refresh();
      },
    } : null);
  } catch (err) { fail(err); }
});

form.allDay.addEventListener('change', () => {
  setAllDayUI();
  reminders = form.allDay.checked ? [] : [...(state.settings.defaultReminders || [])];
  fillReminderAdd();
});
form.freq.addEventListener('change', () => {
  if (form.freq.value === 'weekly') {
    const wd = wdOf(startDateValue());
    $(`#weekdayPick button[data-wd="${wd}"]`).setAttribute('aria-pressed', 'true');
  }
  updateRepeatUI();
});
form.endMode.addEventListener('change', updateRepeatUI);
form.startDate.addEventListener('change', () => {
  // 시작일을 옮기면 종료일도 같은 만큼 이동
  if (form.startDate.dataset.prev && form.endDate.value) {
    const delta = Math.round((toMs(form.startDate.value) - toMs(form.startDate.dataset.prev)) / DAY);
    if (delta) form.endDate.value = addDays(form.endDate.value, delta);
  }
  form.startDate.dataset.prev = form.startDate.value;
  updateRepeatUI();
});
form.startDate.addEventListener('focus', () => { form.startDate.dataset.prev = form.startDate.value; });
form.startTime.addEventListener('change', () => {
  if (form.startDate.value === form.endDate.value && form.endTime.value <= form.startTime.value) {
    const [h, m] = form.startTime.value.split(':').map(Number);
    form.endTime.value = `${pad(Math.min(h + 1, 23))}:${pad(h + 1 > 23 ? 59 : m)}`;
  }
});
$('#reminderAdd').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v !== '') {
    reminders = [...new Set([...reminders, +v])].sort((a, b) => a - b);
    fillReminderAdd();
  }
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ── 설정 ─────────────────────────────────────
const sdlg = $('#settingsDialog');
const sform = $('#settingsForm');

function renderSettings() {
  const s = state.settings;
  sform.querySelectorAll('[data-week]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.week === s.weekStartsOn)));
  const sel = sform.defaultReminder;
  sel.replaceChildren(new Option('없음', ''));
  for (const [v, label] of TIMED_REMINDERS.slice(0, 7)) sel.appendChild(new Option(label, String(v)));
  sel.value = s.defaultReminders && s.defaultReminders.length ? String(s.defaultReminders[0]) : '';
  sform.showHolidays.checked = s.showHolidays;
  sform.closeToTray.checked = s.closeToTray;
  sform.launchAtLogin.checked = s.launchAtLogin;
  const ul = $('#customHolidayList');
  ul.replaceChildren();
  for (const h of [...s.customHolidays].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const li = el('li');
    li.append(el('span', 'd', h.date.replace(/-/g, '.')), el('span', 'n', h.name));
    const x = el('button', 'icon-btn');
    x.type = 'button';
    x.setAttribute('aria-label', `${h.name} 삭제`);
    x.appendChild(icon(ICON.close));
    x.addEventListener('click', () => saveSettings({ customHolidays: s.customHolidays.filter((c) => c !== h) }, true));
    li.appendChild(x);
    ul.appendChild(li);
  }
}

async function saveSettings(patch, holidaysChanged) {
  try {
    state.settings = await api.setSettings(patch);
    state.weekStartsOn = state.settings.weekStartsOn;
    if (holidaysChanged) state.holidayYears = null;
    renderSettings();
    await refresh();
  } catch (err) { fail(err); }
}

sform.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => saveSettings({ weekStartsOn: +b.dataset.week })));
sform.defaultReminder.addEventListener('change', (e) => saveSettings({ defaultReminders: e.target.value === '' ? [] : [+e.target.value] }));
sform.showHolidays.addEventListener('change', (e) => saveSettings({ showHolidays: e.target.checked }, true));
sform.closeToTray.addEventListener('change', (e) => saveSettings({ closeToTray: e.target.checked }));
sform.launchAtLogin.addEventListener('change', (e) => saveSettings({ launchAtLogin: e.target.checked }));
$('#chAdd').addEventListener('click', () => {
  const date = $('#chDate').value;
  const name = $('#chName').value.trim() || '공휴일';
  if (!date) { toast('날짜를 선택하세요'); return; }
  $('#chDate').value = '';
  $('#chName').value = '';
  saveSettings({ customHolidays: [...state.settings.customHolidays.filter((h) => h.date !== date), { date, name }] }, true);
});
$('#openDataBtn').addEventListener('click', () => api.openDataFolder().catch(fail));
$('#settingsBtn').addEventListener('click', () => { renderSettings(); sdlg.showModal(); });

// ── 업데이트 ─────────────────────────────────
let update = null;

function renderUpdate() {
  if (!update) return;
  const { state: st, version, newVersion, percent } = update;
  $('#appVersion').textContent = `버전 ${version}`;
  const text = {
    unsupported: '설치형에서만 자동 업데이트돼요.',
    checking: '확인하는 중…',
    latest: '최신 버전이에요.',
    downloading: `새 버전 ${newVersion} 받는 중… ${percent || 0}%`,
    ready: `새 버전 ${newVersion}을 설치할 준비가 됐어요.`,
    error: '업데이트를 확인하지 못했어요.',
  }[st] || '';
  $('#updateText').textContent = text;
  const btn = $('#updateBtn');
  btn.hidden = st === 'unsupported';
  btn.disabled = st === 'checking' || st === 'downloading';
  btn.textContent = st === 'ready' ? '재시작해서 업데이트' : st === 'error' ? '다시 확인' : '업데이트 확인';
}

function setUpdate(next) {
  const becameReady = next.state === 'ready' && (!update || update.state !== 'ready');
  update = next;
  renderUpdate();
  if (becameReady) toast(`새 버전 ${next.newVersion}이 준비됐어요`, { label: '재시작', run: () => api.update.install().catch(fail) });
}

$('#updateBtn').addEventListener('click', () => {
  if (update && update.state === 'ready') api.update.install().catch(fail);
  else api.update.check().then(setUpdate).catch(fail);
});
api.on('update-status', setUpdate);

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
$('#modeMonth').addEventListener('click', () => setMode('month'));
$('#modeWeek').addEventListener('click', () => setMode('week'));

$('#grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) select(cell.dataset.date); // 마우스로 고를 땐 포커스 테두리를 띄우지 않음
});
$('#grid').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) openEventDialog({ date: cell.dataset.date });
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderDay(); });

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

// ── 시작 ─────────────────────────────────────
(async function init() {
  buildStaticControls();
  try {
    state.settings = await api.getSettings();
    state.weekStartsOn = state.settings.weekStartsOn || 0;
    state.mode = state.settings.calendarMode === 'week' ? 'week' : 'month';
    state.memos = await api.listMemos();
  } catch (err) { fail(err); }
  await refresh();
  renderMemos();
  api.update.status().then(setUpdate).catch(() => {});
})();
