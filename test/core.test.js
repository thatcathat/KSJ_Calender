'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { holidaysForYear } = require('../src/holidays');
const { expandEvent, expandAll, describe } = require('../src/recurrence');
const { createEvent, updateEvent, deleteEvent, restoreEvent, saveMemo, deleteMemo, reorderMemos } = require('../src/events');
const { dueReminders, Notifier } = require('../src/notifier');
const { Store } = require('../src/store');
const { parse } = require('../src/dates');

const subs = (y) => holidaysForYear(y).filter((h) => h.kind === 'substitute').map((h) => h.date);
const names = (y) => Object.fromEntries(holidaysForYear(y).map((h) => [h.date, h.name]));

// ── 공휴일 ──────────────────────────────────────
test('2027 대체공휴일 7일 — 우주항공청 2027년 월력요항과 일치', () => {
  assert.deepEqual(subs(2027), ['2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']);
});

test('2027 설날·추석·부처님 오신 날 양력 날짜', () => {
  const n = names(2027);
  assert.equal(n['2027-02-07'], '설날');
  assert.equal(n['2027-09-15'], '추석');
  assert.equal(n['2027-05-13'], '부처님 오신 날');
});

test('2026 공휴일 — 노동절·제헌절 신설, 지방선거일, 대체공휴일', () => {
  const n = names(2026);
  assert.equal(n['2026-05-01'], '노동절');
  assert.equal(n['2026-07-17'], '제헌절');
  assert.equal(n['2026-06-03'], '전국동시지방선거일');
  assert.equal(n['2026-02-17'], '설날');
  assert.equal(n['2026-09-25'], '추석');
  // 추석 연휴 마지막 날이 토요일이어도 설·추석은 토요일 대체 대상 아님
  assert.deepEqual(subs(2026), ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']);
});

test('2025 — 어린이날·부처님 오신 날 겹침, 추석 일요일 겹침', () => {
  assert.deepEqual(subs(2025), ['2025-03-03', '2025-05-06', '2025-10-08']);
  assert.equal(names(2025)['2025-05-01'], undefined, '2025년 노동절은 아직 공휴일 아님');
});

test('직접 추가한 공휴일은 대체공휴일 날짜에서 제외된다', () => {
  // 2027-10-04(월)을 임시공휴일로 지정하면 개천절 대체공휴일은 그 다음 평일로
  const list = holidaysForYear(2027, [{ date: '2027-10-04', name: '임시공휴일' }]);
  const sub = list.find((h) => h.name === '대체공휴일(개천절)');
  assert.equal(sub.date, '2027-10-05');
});

// ── 반복 ────────────────────────────────────────
const base = { id: 'e1', title: 't', reminders: [], exdates: [] };

test('매주 월·수, 시간 일정', () => {
  const ev = { ...base, start: '2026-10-05T09:00', end: '2026-10-05T10:00', recurrence: { freq: 'weekly', interval: 1, byweekday: [1, 3] } };
  const occ = expandEvent(ev, '2026-10-01', '2026-10-15').map((o) => o.start);
  assert.deepEqual(occ, ['2026-10-05T09:00', '2026-10-07T09:00', '2026-10-12T09:00', '2026-10-14T09:00']);
});

test('매월 셋째 수요일 / 마지막 금요일', () => {
  const nth = { ...base, start: '2026-10-21T14:00', end: '2026-10-21T15:00', recurrence: { freq: 'monthly', monthlyMode: 'nth' } };
  assert.deepEqual(expandEvent(nth, '2026-10-01', '2027-01-01').map((o) => o.start.slice(0, 10)), ['2026-10-21', '2026-11-18', '2026-12-16']);
  const last = { ...base, start: '2026-10-30', end: '2026-10-31', recurrence: { freq: 'monthly', monthlyMode: 'last' } };
  assert.deepEqual(expandEvent(last, '2026-10-01', '2027-01-01').map((o) => o.start), ['2026-10-30', '2026-11-27', '2026-12-25']);
  assert.equal(describe(nth), '매월 3번째 수요일');
});

test('종료일·횟수·제외일', () => {
  const ev = { ...base, start: '2026-10-01', end: '2026-10-02', recurrence: { freq: 'daily', until: '2026-10-05' }, exdates: ['2026-10-03'] };
  assert.deepEqual(expandEvent(ev, '2026-09-01', '2026-12-01').map((o) => o.start), ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']);
  const cnt = { ...base, start: '2026-10-01T08:00', end: '2026-10-01T08:30', recurrence: { freq: 'daily', interval: 2, count: 3 } };
  assert.deepEqual(expandEvent(cnt, '2026-09-01', '2026-12-01').map((o) => o.start), ['2026-10-01T08:00', '2026-10-03T08:00', '2026-10-05T08:00']);
});

test('여러 날 걸친 일정은 범위와 겹치면 포함', () => {
  const ev = { ...base, start: '2026-10-19', end: '2026-10-24', recurrence: null };
  assert.equal(expandEvent(ev, '2026-10-21', '2026-10-22').length, 1);
  assert.equal(expandEvent(ev, '2026-10-24', '2026-10-25').length, 0, 'end는 배타');
});

test('정렬: 종일 일정이 먼저, 그다음 시간순', () => {
  const evs = [
    { ...base, id: 'a', start: '2026-10-21T15:00', end: '2026-10-21T16:00' },
    { ...base, id: 'b', start: '2026-10-21', end: '2026-10-22' },
    { ...base, id: 'c', start: '2026-10-21T09:00', end: '2026-10-21T10:00' },
  ];
  assert.deepEqual(expandAll(evs, '2026-10-21', '2026-10-22').map((o) => o.eventId), ['b', 'c', 'a']);
});

// ── 수정·삭제 범위 ───────────────────────────────
function seriesData() {
  const data = { events: [], memos: [] };
  const ev = createEvent(data, { title: '운동', start: '2026-10-05T07:00', end: '2026-10-05T08:00', recurrence: { freq: 'weekly', byweekday: [1] } });
  return { data, ev };
}

test('"이 일정만" 수정: 원래 발생은 제외, 단일 일정 생성', () => {
  const { data, ev } = seriesData();
  updateEvent(data, ev.id, { scope: 'this', occurrenceStart: '2026-10-12T07:00', changes: { title: '운동(PT)', start: '2026-10-12T19:00', end: '2026-10-12T20:00' } });
  const occ = expandAll(data.events, '2026-10-12', '2026-10-13');
  assert.deepEqual(occ.map((o) => [o.title, o.start]), [['운동(PT)', '2026-10-12T19:00']]);
  assert.equal(expandAll(data.events, '2026-10-19', '2026-10-20')[0].title, '운동');
});

test('"이후 모두" 수정: 앞 반복은 끝나고 새 반복이 이어진다', () => {
  const { data, ev } = seriesData();
  updateEvent(data, ev.id, { scope: 'future', occurrenceStart: '2026-10-19T07:00', changes: { title: '아침 운동', start: '2026-10-19T06:30', end: '2026-10-19T07:30' } });
  const titles = expandAll(data.events, '2026-10-01', '2026-11-01').map((o) => `${o.start} ${o.title}`);
  assert.deepEqual(titles, ['2026-10-05T07:00 운동', '2026-10-12T07:00 운동', '2026-10-19T06:30 아침 운동', '2026-10-26T06:30 아침 운동']);
});

test('"모든 반복" 수정: 날짜를 옮기면 전체가 같은 만큼 이동', () => {
  const { data, ev } = seriesData();
  updateEvent(data, ev.id, { scope: 'all', occurrenceStart: '2026-10-12T07:00', changes: { start: '2026-10-13T08:00', end: '2026-10-13T09:00', recurrence: { freq: 'weekly', byweekday: [2] } } });
  const occ = expandAll(data.events, '2026-10-01', '2026-10-21').map((o) => o.start);
  assert.deepEqual(occ, ['2026-10-06T08:00', '2026-10-13T08:00', '2026-10-20T08:00']);
});

test('횟수 반복을 "이후 모두"로 나누면 남은 횟수 유지', () => {
  const data = { events: [], memos: [] };
  const ev = createEvent(data, { title: 'x', start: '2026-10-01', end: '2026-10-02', recurrence: { freq: 'daily', count: 5 } });
  updateEvent(data, ev.id, { scope: 'future', occurrenceStart: '2026-10-03', changes: { title: 'y', start: '2026-10-03', end: '2026-10-04' } });
  const occ = expandAll(data.events, '2026-09-01', '2026-12-01').map((o) => `${o.start} ${o.title}`);
  assert.deepEqual(occ, ['2026-10-01 x', '2026-10-02 x', '2026-10-03 y', '2026-10-04 y', '2026-10-05 y']);
});

test('삭제 범위: 이 일정만 / 이후 모두 / 전체', () => {
  let { data, ev } = seriesData();
  deleteEvent(data, ev.id, { scope: 'this', occurrenceStart: '2026-10-12T07:00' });
  assert.deepEqual(expandAll(data.events, '2026-10-01', '2026-10-27').map((o) => o.start.slice(0, 10)), ['2026-10-05', '2026-10-19', '2026-10-26']);
  deleteEvent(data, ev.id, { scope: 'future', occurrenceStart: '2026-10-19T07:00' });
  assert.deepEqual(expandAll(data.events, '2026-10-01', '2026-12-01').map((o) => o.start.slice(0, 10)), ['2026-10-05']);
  deleteEvent(data, ev.id, { scope: 'all' });
  assert.equal(data.events.length, 0);
});

test('반복 일정 삭제 되돌리기: 이 일정만 / 이후 모두 / 전체 모두 원래대로', () => {
  for (const scope of ['this', 'future', 'all']) {
    const { data, ev } = seriesData();
    const snapshot = JSON.parse(JSON.stringify(ev));
    const before = expandAll(data.events, '2026-10-01', '2026-12-01').map((o) => o.start);
    deleteEvent(data, ev.id, { scope, occurrenceStart: '2026-10-19T07:00' });
    restoreEvent(data, snapshot);
    assert.equal(data.events.length, 1, scope);
    assert.equal(data.events[0].id, ev.id, scope);
    assert.deepEqual(expandAll(data.events, '2026-10-01', '2026-12-01').map((o) => o.start), before, scope);
  }
});

test('입력 정리: 종료가 시작보다 앞이면 기본 길이로', () => {
  const data = { events: [], memos: [] };
  const a = createEvent(data, { title: '  ', start: '2026-10-21T10:00', end: '2026-10-21T09:00', color: 'pink' });
  assert.equal(a.title, '(제목 없음)');
  assert.equal(a.end, '2026-10-21T11:00');
  assert.equal(a.color, 'blue');
  const b = createEvent(data, { title: 'b', start: '2026-10-21', end: '2026-10-21' });
  assert.equal(b.end, '2026-10-22');
});

// ── 알림 ────────────────────────────────────────
test('알림: 10분 전, 종일 일정은 당일 오전 9시 기준', () => {
  const evs = [
    { ...base, id: 'm', start: '2026-10-21T15:00', end: '2026-10-21T16:00', reminders: [10, 60] },
    { ...base, id: 'd', start: '2026-10-22', end: '2026-10-23', reminders: [0, 1440] },
  ];
  const due = (from, to) => dueReminders(evs, parse(from), parse(to)).map((d) => d.key);
  assert.deepEqual(due('2026-10-21T14:49', '2026-10-21T14:50'), ['m::2026-10-21T15:00@10']);
  assert.deepEqual(due('2026-10-21T13:59', '2026-10-21T14:00'), ['m::2026-10-21T15:00@60']);
  assert.deepEqual(due('2026-10-21T08:59', '2026-10-21T09:00'), ['d::2026-10-22@1440']);
  assert.deepEqual(due('2026-10-22T08:59', '2026-10-22T09:00'), ['d::2026-10-22@0']);
  assert.deepEqual(due('2026-10-21T14:50', '2026-10-21T14:55'), [], '이미 지난 구간은 다시 울리지 않음');
});

test('알림: 반복 일정의 각 발생마다 울림', () => {
  const evs = [{ ...base, id: 'r', start: '2026-10-01T09:00', end: '2026-10-01T09:30', reminders: [5], recurrence: { freq: 'daily' } }];
  assert.deepEqual(dueReminders(evs, parse('2026-10-21T08:54'), parse('2026-10-21T08:55')).map((d) => d.key), ['r::2026-10-21T09:00@5']);
});

test('알림: 절전에서 깨어나면 지난 알림은 최근 5분 이내 것만 울림', () => {
  const evs = [
    { ...base, id: 'a', start: '2026-10-21T01:10', end: '2026-10-21T02:00', reminders: [10] },
    { ...base, id: 'b', start: '2026-10-21T07:58', end: '2026-10-21T08:30', reminders: [0] },
  ];
  const fired = [];
  const n = new Notifier(() => evs, (x) => fired.push(x.occ.eventId));
  n.last = parse('2026-10-20T23:00'); // 잠들기 전 마지막 확인
  n.tick(new Date(2026, 9, 21, 8, 0)); // 다음 날 아침 8시에 깨어남
  assert.deepEqual(fired, ['b']);
});

// ── 메모·저장소 ─────────────────────────────────
test('메모 추가·수정·삭제와 파일 저장/복구', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  const s1 = new Store(dir);
  const m = s1.mutate((d) => saveMemo(d, { text: '장보기: 우유' }));
  s1.mutate((d) => saveMemo(d, { id: m.id, text: '장보기: 우유, 계란' }));
  s1.mutate((d) => createEvent(d, { title: '회의', start: '2026-10-21T10:00' }));
  const s2 = new Store(dir);
  assert.equal(s2.data.memos[0].text, '장보기: 우유, 계란');
  assert.equal(s2.data.events[0].title, '회의');
  // 본 파일이 깨지면 백업에서 복구
  s2.mutate((d) => deleteMemo(d, m.id));
  fs.writeFileSync(path.join(dir, 'calendar-data.json'), '{깨진 파일');
  const s3 = new Store(dir);
  assert.equal(s3.data.events.length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.broken-')));
});

test('날짜별 백업: 하루 한 장, 최근 7일치만 남기고, 본 파일·.bak이 깨지면 여기서 복구', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  const s = new Store(dir);
  const bdir = path.join(dir, 'backups');
  s.mutate((d) => createEvent(d, { title: '회의', start: '2026-10-21T10:00' }));
  assert.ok(!fs.existsSync(bdir), '첫 저장은 이전 파일이 없어 백업하지 않음');
  s.mutate((d) => saveMemo(d, { text: '메모' }));
  s.mutate((d) => saveMemo(d, { text: '메모2' }));
  assert.equal(fs.readdirSync(bdir).length, 1, '같은 날은 한 장만');
  assert.equal(JSON.parse(fs.readFileSync(s.dailyBackups()[0], 'utf8')).memos.length, 0, '그날 첫 저장 직전 상태');

  // 예전 백업 9장이 있으면, 오늘 것을 포함해 최신 7장만 남는다
  for (const f of fs.readdirSync(bdir)) fs.unlinkSync(path.join(bdir, f));
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(bdir, `calendar-data-2020-01-0${i}.json`), '{}');
  s.save();
  const names = fs.readdirSync(bdir).sort();
  assert.equal(names.length, 7);
  assert.equal(names[0], 'calendar-data-2020-01-04.json');

  fs.writeFileSync(path.join(dir, 'calendar-data.json'), '{깨진 파일');
  fs.writeFileSync(path.join(dir, 'calendar-data.json.bak'), '{깨진 백업');
  assert.equal(new Store(dir).data.events[0].title, '회의');
});

// ── 검색 ────────────────────────────────────────
test('검색: 제목·장소, 낱말 모두 포함, 다가오는 것 먼저·지난 것은 최근 순, 반복은 다음 발생 하나', () => {
  const { searchEvents } = require('../src/search');
  const evs = [
    { ...base, id: 'past', title: '치과 정기검진', location: '강남', start: '2026-03-02T10:00', end: '2026-03-02T11:00' },
    { ...base, id: 'old', title: '치과', start: '2025-01-05', end: '2025-01-06' },
    { ...base, id: 'soon', title: '팀 회의', location: '3층 회의실', start: '2026-10-25T14:00', end: '2026-10-25T15:00' },
    { ...base, id: 'weekly', title: '주간 회의', start: '2026-09-07T09:00', end: '2026-09-07T10:00', recurrence: { freq: 'weekly' } },
    { ...base, id: 'ended', title: '스터디 회의', start: '2026-01-05T19:00', end: '2026-01-05T20:00', recurrence: { freq: 'weekly', count: 3 } },
    { ...base, id: 'multi', title: '출장', location: '부산', start: '2026-10-20', end: '2026-10-23' },
  ];
  const ids = (q) => searchEvents(evs, q, '2026-10-21').items.map((o) => `${o.eventId}@${o.start.slice(0, 10)}`);
  assert.deepEqual(ids('치과'), ['past@2026-03-02', 'old@2025-01-05']);
  assert.deepEqual(ids('회의'), ['soon@2026-10-25', 'weekly@2026-10-26', 'ended@2026-01-19']);
  assert.deepEqual(ids('회의실'), ['soon@2026-10-25'], '장소로도 찾음');
  assert.deepEqual(ids('치과 강남'), ['past@2026-03-02'], '낱말이 모두 들어 있어야 함');
  assert.deepEqual(ids('부산'), ['multi@2026-10-20'], '진행 중인 여러 날 일정은 다가오는 쪽');
  assert.deepEqual(ids('   '), []);
});

test('메모 완료 체크와 순서 바꾸기', () => {
  const data = { events: [], memos: [] };
  const a = saveMemo(data, { text: 'a' });
  const b = saveMemo(data, { text: 'b' });
  const c = saveMemo(data, { text: 'c' }); // 새 메모는 맨 위: c, b, a
  assert.equal(a.done, false);
  saveMemo(data, { id: b.id, text: 'b', done: true });
  saveMemo(data, { id: b.id, text: 'b 고침' });
  assert.equal(data.memos.find((m) => m.id === b.id).done, true, 'done을 안 넘기면 그대로');
  reorderMemos(data, [a.id, c.id]);
  assert.deepEqual(data.memos.map((m) => m.text), ['a', 'c', 'b 고침'], '목록에 없는 메모는 뒤로');
});
