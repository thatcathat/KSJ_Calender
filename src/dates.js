'use strict';
// 날짜는 모두 "떠 있는(floating) 현지 시각" 문자열로 다룬다.
//   종일:   'YYYY-MM-DD'
//   시간:   'YYYY-MM-DDTHH:mm'
// 계산할 때는 같은 벽시계 값을 UTC 밀리초로 바꿔서 쓴다(시간대·서머타임 영향 없음).

const DAY = 86400000;
const MIN = 60000;

const pad = (n) => String(n).padStart(2, '0');

function parse(str) {
  if (typeof str !== 'string') throw new TypeError('date string required');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(str);
  if (!m) throw new Error(`잘못된 날짜 형식: ${str}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const isDateOnly = (s) => typeof s === 'string' && s.length === 10;

// 원래 문자열의 형식(종일/시간)을 유지하며 포맷
const fmtLike = (ms, likeStr) => (isDateOnly(likeStr) ? fmtDate(ms) : fmtDateTime(ms));

const addDays = (dateStr, n) => fmtDate(parse(dateStr) + n * DAY);

const weekday = (dateStr) => new Date(parse(dateStr)).getUTCDay(); // 0=일

// 실제 시각(Date) → 현지 벽시계 기준 floating ms
function toFloating(date = new Date()) {
  return Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
  );
}

const todayStr = (date = new Date()) => fmtDate(toFloating(date));

module.exports = { DAY, MIN, pad, parse, fmtDate, fmtDateTime, fmtLike, isDateOnly, addDays, weekday, toFloating, todayStr };
