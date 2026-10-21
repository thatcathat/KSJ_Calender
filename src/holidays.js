'use strict';
// 한국 공휴일 계산기 — 「관공서의 공휴일에 관한 규정」 기준
// 음력 명절은 korean-lunar-calendar(1000~2050년 지원)로 양력 변환한다.
const KoreanLunarCalendar = require('korean-lunar-calendar');
const { DAY, parse, fmtDate, weekday, pad } = require('./dates');

// 대체공휴일 규칙
//   'lunar'   : 설·추석 연휴 — 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일
//   'weekend' : 토·일 또는 다른 공휴일과 겹치면 다음 첫 평일
//   null      : 대체공휴일 없음
const FIXED = [
  { md: '01-01', name: '신정', sub: null },
  { md: '03-01', name: '삼일절', sub: 'weekend', subSince: 2021 },
  { md: '05-01', name: '노동절', sub: 'weekend', since: 2026, subSince: 2026 },
  { md: '05-05', name: '어린이날', sub: 'weekend', subSince: 2014 },
  { md: '06-06', name: '현충일', sub: null },
  { md: '07-17', name: '제헌절', sub: 'weekend', since: 2026, subSince: 2026, until: 2007 },
  { md: '08-15', name: '광복절', sub: 'weekend', subSince: 2021 },
  { md: '10-03', name: '개천절', sub: 'weekend', subSince: 2021 },
  { md: '10-09', name: '한글날', sub: 'weekend', subSince: 2021, since: 2013 },
  { md: '12-25', name: '성탄절', sub: 'weekend', subSince: 2023 },
];

// 선거일·임시공휴일 (정부 지정, 법 규칙으로 계산 불가)
// 새로 지정되면 앱 설정의 '직접 추가한 공휴일'로 넣으면 된다.
const SPECIAL = [
  { date: '2024-04-10', name: '국회의원 선거일' },
  { date: '2024-10-01', name: '국군의 날(임시공휴일)' },
  { date: '2025-01-27', name: '임시공휴일' },
  { date: '2025-06-03', name: '대통령 선거일' },
  { date: '2026-06-03', name: '전국동시지방선거일' },
];

function lunarToSolar(year, month, day) {
  const cal = new KoreanLunarCalendar();
  if (!cal.setLunarDate(year, month, day, false)) return null;
  const s = cal.getSolarCalendar();
  return `${s.year}-${pad(s.month)}-${pad(s.day)}`;
}

// 대체공휴일 적용 전의 기본 공휴일 목록
function baseHolidays(year) {
  const list = [];
  for (const h of FIXED) {
    const ok = (h.since ? year >= h.since : true) || (h.until && year <= h.until);
    if (!ok) continue;
    list.push({
      date: `${year}-${h.md}`, name: h.name, group: h.name,
      sub: h.sub && year >= (h.subSince || 0) ? h.sub : null,
    });
  }
  const seol = lunarToSolar(year, 1, 1);
  if (seol) {
    const s = parse(seol);
    list.push({ date: fmtDate(s - DAY), name: '설날 연휴', group: '설날', sub: year >= 2014 ? 'lunar' : null });
    list.push({ date: seol, name: '설날', group: '설날', sub: year >= 2014 ? 'lunar' : null });
    list.push({ date: fmtDate(s + DAY), name: '설날 연휴', group: '설날', sub: year >= 2014 ? 'lunar' : null });
  }
  const buddha = lunarToSolar(year, 4, 8);
  if (buddha) list.push({ date: buddha, name: '부처님 오신 날', group: '부처님 오신 날', sub: year >= 2023 ? 'weekend' : null });
  const chuseok = lunarToSolar(year, 8, 15);
  if (chuseok) {
    const c = parse(chuseok);
    list.push({ date: fmtDate(c - DAY), name: '추석 연휴', group: '추석', sub: year >= 2014 ? 'lunar' : null });
    list.push({ date: chuseok, name: '추석', group: '추석', sub: year >= 2014 ? 'lunar' : null });
    list.push({ date: fmtDate(c + DAY), name: '추석 연휴', group: '추석', sub: year >= 2014 ? 'lunar' : null });
  }
  return list;
}

/**
 * 한 해의 공휴일 목록 (대체공휴일 포함), 날짜순.
 * @param {number} year
 * @param {{date:string,name:string}[]} custom 사용자가 직접 추가한 공휴일
 * @returns {{date:string,name:string,kind:'holiday'|'substitute'|'special'|'custom'}[]}
 */
function holidaysForYear(year, custom = []) {
  const base = baseHolidays(year);
  const extra = [
    ...SPECIAL.filter((s) => s.date.startsWith(`${year}-`)).map((s) => ({ ...s, kind: 'special' })),
    ...custom.filter((s) => s && typeof s.date === 'string' && s.date.startsWith(`${year}-`))
      .map((s) => ({ date: s.date, name: s.name || '공휴일', kind: 'custom' })),
  ];

  const byDate = new Map();
  for (const h of base) {
    if (!byDate.has(h.date)) byDate.set(h.date, []);
    byDate.get(h.date).push(h);
  }
  const isHoliday = (d) => byDate.has(d) || extra.some((e) => e.date === d) || subs.some((s) => s.date === d);
  const subs = [];

  // 대체공휴일을 받을 '빠진 날'을 날짜순으로 모은다
  const claims = []; // { after: 'YYYY-MM-DD', name }
  const dates = [...byDate.keys()].sort();
  for (const d of dates) {
    const hs = byDate.get(d);
    const wd = weekday(d);
    const eligible = hs.filter((h) => h.sub);
    if (!eligible.length) continue;
    let losers;
    if (wd === 0 || wd === 6) {
      // 주말: 일요일은 모든 규칙, 토요일은 'weekend' 규칙만 대상(설·추석은 다른 공휴일과 겹칠 때만)
      losers = eligible.filter((h) => wd === 0 || h.sub === 'weekend' || hs.length > 1);
    } else {
      // 평일에 공휴일 여러 개가 겹치면 겹친 개수만큼(하루는 이미 쉬므로 -1)
      losers = eligible.slice(0, Math.max(0, hs.length - 1));
    }
    for (const h of losers) {
      // 설·추석은 연휴 마지막 날 이후부터 찾는다
      let after = d;
      if (h.sub === 'lunar') after = base.filter((b) => b.group === h.group).map((b) => b.date).sort().pop();
      claims.push({ after, name: h.group });
    }
  }

  for (const c of claims) {
    let t = parse(c.after) + DAY;
    for (let guard = 0; guard < 30; guard++, t += DAY) {
      const ds = fmtDate(t);
      const wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6 || isHoliday(ds)) continue;
      subs.push({ date: ds, name: `대체공휴일(${c.name})`, kind: 'substitute' });
      break;
    }
  }

  const all = [
    ...base.map((h) => ({ date: h.date, name: h.name, kind: 'holiday' })),
    ...subs,
    ...extra,
  ];
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return all;
}

/** 여러 해의 공휴일을 { 'YYYY-MM-DD': ['이름', ...] } 형태로 */
function holidayMap(fromYear, toYear, custom = []) {
  const map = {};
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of holidaysForYear(y, custom)) {
      (map[h.date] = map[h.date] || []).push(h.name);
    }
  }
  return map;
}

module.exports = { holidaysForYear, holidayMap, lunarToSolar };
