'use strict';
/* global api */
// 공통: 날짜 유틸, DOM 도우미, 화면 상태, 알림 시간 옵션, 토스트
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

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
  grip: ['M7.5 5.5h.01M12.5 5.5h.01M7.5 10h.01M12.5 10h.01M7.5 14.5h.01M12.5 14.5h.01'],
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
