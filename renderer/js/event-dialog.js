'use strict';
/* global api */
// 일정 추가·수정·삭제 창
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

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
    const c = el('span', 'pill removable', reminderLabel(m, allDay));
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
  initialForm = formSnapshot();
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

// ── 고친 내용이 있으면 닫기 전에 묻기 ──
let initialForm = '';

// 입력칸 값 + 칸 밖에서 고르는 것(알림 목록, 반복 요일)을 한 줄로
function formSnapshot() {
  const days = [...$('#weekdayPick').querySelectorAll('button[aria-pressed="true"]')].map((b) => b.dataset.wd);
  return JSON.stringify([[...new FormData(form)], reminders, days]);
}

function confirmDiscard() {
  const d = $('#discardDialog');
  return new Promise((resolve) => {
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'discard'), { once: true });
    d.showModal();
  });
}

async function closeEventDialog() {
  if (formSnapshot() === initialForm || await confirmDiscard()) dlg.close();
}

// Esc는 dialog가 바로 닫기 전에 가로챈다. cancel 이벤트만 막으면 Esc를 두 번 누를 때 브라우저가 강제로 닫아 버린다.
dlg.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  e.preventDefault();
  closeEventDialog();
});
dlg.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEventDialog();
});

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
    // 반복 일정도 삭제 전 상태를 통째로 받아 두었다가 그대로 되살린다
    const original = await api.getEvent(o.eventId);
    await api.deleteEvent(o.eventId, { scope, occurrenceStart: o.start });
    await refresh();
    toast('일정을 삭제했어요', original ? {
      label: '되돌리기',
      run: async () => {
        await api.restoreEvent(original);
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
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
  const d = b.closest('dialog');
  if (d === dlg) closeEventDialog();
  else d.close();
}));
