'use strict';
// 일정 검색: 제목·장소에 검색어(띄어쓰기로 나눈 낱말)가 모두 들어 있는 일정을 찾는다.
// 반복 일정은 하나로 묶어, 오늘 이후 가장 가까운 발생(없으면 가장 최근 발생)으로 보여 준다.
const { DAY, parse, fmtDate, todayStr } = require('./dates');
const { expandEvent } = require('./recurrence');

const SPAN = 2 * 365 * DAY; // 반복 일정의 발생을 찾는 범위(오늘 앞뒤)
const MAX_RESULTS = 50;

// 발생의 마지막 날(종료는 배타적이라 1ms 빼서 계산)
const lastDay = (occ) => fmtDate(Math.max(parse(occ.end) - 1, parse(occ.start)));

/**
 * @returns {{items: object[], total: number}} items는 다가오는 것(가까운 순) → 지난 것(최근 순), 최대 MAX_RESULTS개
 */
function searchEvents(events, query, today = todayStr()) {
  const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { items: [], total: 0 };
  const t = parse(today);
  const upcoming = [];
  const past = [];
  for (const ev of events) {
    const text = `${ev.title || ''} ${ev.location || ''}`.toLowerCase();
    if (!terms.every((w) => text.includes(w))) continue;
    let occs;
    try {
      // 한 번뿐인 일정은 날짜와 상관없이 그 일정 자체를 찾는다
      occs = ev.recurrence ? expandEvent(ev, t - SPAN, t + SPAN) : expandEvent(ev, parse(ev.start), parse(ev.start) + 1);
    } catch {
      continue;
    }
    const next = occs.find((o) => lastDay(o) >= today);
    if (next) upcoming.push({ ...next, upcoming: true });
    else if (occs.length) past.push({ ...occs[occs.length - 1], upcoming: false });
  }
  upcoming.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  past.sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0));
  const all = [...upcoming, ...past];
  return { items: all.slice(0, MAX_RESULTS), total: all.length };
}

module.exports = { searchEvents, MAX_RESULTS };
