'use strict';
// 반복 일정 전개. rrule을 'floating UTC'로 돌려 시간대 문제를 피한다.
const { RRule } = require('rrule');
const { DAY, parse, fmtDate, fmtLike, isDateOnly, addDays } = require('./dates');

const WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA]; // 0=일
const FREQ = { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY, yearly: RRule.YEARLY };
const MAX_OCCURRENCES = 5000;

/** 일정 길이(ms). 종일 일정의 end는 '다음 날(배타)' 기준 */
function durationOf(ev) {
  const s = parse(ev.start);
  const e = ev.end ? parse(ev.end) : s + (isDateOnly(ev.start) ? DAY : 3600000);
  return Math.max(e - s, isDateOnly(ev.start) ? DAY : 0);
}

/** 매월 n번째 요일 정보: { weekday, nth(1~5), isLast } */
function nthWeekdayOf(dateStr) {
  const d = new Date(parse(dateStr));
  const day = d.getUTCDate();
  const nth = Math.ceil(day / 7);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { weekday: d.getUTCDay(), nth, isLast: day + 7 > daysInMonth };
}

function buildRule(ev) {
  const r = ev.recurrence;
  const dtstart = new Date(parse(ev.start));
  const opts = {
    freq: FREQ[r.freq],
    interval: Math.max(1, parseInt(r.interval, 10) || 1),
    dtstart,
  };
  if (r.freq === 'weekly') {
    const days = Array.isArray(r.byweekday) && r.byweekday.length ? r.byweekday : [dtstart.getUTCDay()];
    opts.byweekday = days.map((d) => WEEKDAYS[d]);
  } else if (r.freq === 'monthly') {
    if (r.monthlyMode === 'nth' || r.monthlyMode === 'last') {
      const info = nthWeekdayOf(ev.start);
      opts.byweekday = [WEEKDAYS[info.weekday].nth(r.monthlyMode === 'last' ? -1 : info.nth)];
    } else {
      opts.bymonthday = [dtstart.getUTCDate()];
    }
  }
  if (r.count) opts.count = Math.max(1, parseInt(r.count, 10));
  else if (r.until) opts.until = new Date(parse(r.until) + DAY - 1000); // 종료일 포함
  return new RRule(opts);
}

/**
 * 일정 하나를 [rangeStart, rangeEnd) 구간과 겹치는 발생(occurrence)들로 펼친다.
 * @returns {{id, eventId, start, end, allDay, recurring, ...}[]}
 */
function expandEvent(ev, rangeStart, rangeEnd) {
  const rs = typeof rangeStart === 'number' ? rangeStart : parse(rangeStart);
  const re = typeof rangeEnd === 'number' ? rangeEnd : parse(rangeEnd);
  const dur = durationOf(ev);
  const repeatText = ev.recurrence ? describe(ev) : ''; // 화면은 이 문구를 그대로 쓴다
  const make = (startMs) => {
    const start = fmtLike(startMs, ev.start);
    return {
      ...ev,
      id: `${ev.id}::${start}`,
      eventId: ev.id,
      seriesStart: ev.start,
      start,
      end: fmtLike(startMs + dur, ev.start),
      allDay: isDateOnly(ev.start),
      recurring: !!ev.recurrence,
      repeatText,
    };
  };

  if (!ev.recurrence) {
    const s = parse(ev.start);
    return s < re && s + Math.max(dur, 1) > rs ? [make(s)] : [];
  }

  const rule = buildRule(ev);
  const ex = new Set(ev.exdates || []);
  const out = [];
  // 시작이 rangeStart보다 앞이어도 길이 때문에 걸치는 발생까지 포함
  const dates = rule.between(new Date(rs - dur), new Date(re), true);
  for (const d of dates) {
    const ms = d.getTime();
    if (ms >= re || ms + Math.max(dur, 1) <= rs) continue;
    const occ = make(ms);
    if (ex.has(occ.start)) continue;
    out.push(occ);
    if (out.length >= MAX_OCCURRENCES) break;
  }
  return out;
}

function expandAll(events, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of events) {
    try {
      out.push(...expandEvent(ev, rangeStart, rangeEnd));
    } catch (err) {
      console.error('일정 전개 실패', ev.id, err);
    }
  }
  out.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.title || '').localeCompare(b.title || '');
  });
  return out;
}

/** occurrenceStart 이전까지 발생한 횟수 (반복 '이후 모두' 분할에 사용) */
function countBefore(ev, occurrenceStart) {
  const rule = buildRule(ev);
  const until = parse(occurrenceStart);
  return rule.between(new Date(parse(ev.start)), new Date(until), true).filter((d) => d.getTime() < until).length;
}

/** 반복을 사람이 읽을 수 있는 한국어로 */
function describe(ev) {
  const r = ev.recurrence;
  if (!r) return '';
  const n = Math.max(1, parseInt(r.interval, 10) || 1);
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  let s;
  if (r.freq === 'daily') s = n === 1 ? '매일' : `${n}일마다`;
  else if (r.freq === 'weekly') {
    const days = (r.byweekday && r.byweekday.length ? r.byweekday : [new Date(parse(ev.start)).getUTCDay()])
      .slice().sort().map((d) => names[d]).join('·');
    s = `${n === 1 ? '매주' : `${n}주마다`} ${days}요일`;
  } else if (r.freq === 'monthly') {
    const base = n === 1 ? '매월' : `${n}개월마다`;
    if (r.monthlyMode === 'nth' || r.monthlyMode === 'last') {
      const info = nthWeekdayOf(ev.start);
      s = `${base} ${r.monthlyMode === 'last' ? '마지막' : `${info.nth}번째`} ${names[info.weekday]}요일`;
    } else s = `${base} ${new Date(parse(ev.start)).getUTCDate()}일`;
  } else {
    const d = new Date(parse(ev.start));
    s = `${n === 1 ? '매년' : `${n}년마다`} ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  }
  if (r.count) s += `, ${r.count}회`;
  else if (r.until) s += `, ${r.until.replace(/-/g, '.')}까지`;
  return s;
}

module.exports = { expandEvent, expandAll, countBefore, durationOf, nthWeekdayOf, describe, addDays, fmtDate };
