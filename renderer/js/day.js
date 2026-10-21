'use strict';
/* global api */
// 2. 선택한 날짜의 일력 페이지와 일정 목록
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

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
  for (const o of items) {
    const li = el('li');
    const btn = el('button', `item c-${o.color}`);
    btn.type = 'button';
    btn.dataset.end = o.end;
    if (o.allDay) btn.dataset.allDay = '1';
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
    if (o.recurring) { const s = el('span'); s.append(icon(ICON.repeat), o.repeatText); meta.appendChild(s); }
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
  markPast();
}

// 끝난 일정은 흐리게. 창을 켜 둔 채 시간이 지나도 맞도록 주기적으로 다시 표시한다(목록은 다시 그리지 않음).
function markPast() {
  const now = nowStr();
  for (const btn of document.querySelectorAll('#agenda .item')) {
    const end = btn.dataset.end;
    btn.classList.toggle('past', btn.dataset.allDay ? end <= state.today : end <= now);
  }
}
setInterval(markPast, 30000);
