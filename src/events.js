'use strict';
// 일정 데이터 조작(순수 함수). 저장은 store.js가 맡는다.
const crypto = require('crypto');
const { DAY, parse, fmtLike, isDateOnly, addDays } = require('./dates');
const { countBefore, durationOf } = require('./recurrence');

const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
const COLORS = ['blue', 'red', 'green', 'amber', 'violet', 'teal', 'slate'];

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function cleanRecurrence(r) {
  if (!r || !FREQS.includes(r.freq)) return null;
  const out = { freq: r.freq, interval: Math.min(999, Math.max(1, parseInt(r.interval, 10) || 1)) };
  if (r.freq === 'weekly' && Array.isArray(r.byweekday)) {
    out.byweekday = [...new Set(r.byweekday.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  }
  if (r.freq === 'monthly') out.monthlyMode = ['nth', 'last'].includes(r.monthlyMode) ? r.monthlyMode : 'day';
  if (r.count) out.count = Math.min(9999, Math.max(1, parseInt(r.count, 10)));
  else if (r.until && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) out.until = r.until;
  return out;
}

/** 입력값을 검증·정리한 일정 필드 */
function cleanFields(input) {
  const title = String(input.title ?? '').trim().slice(0, 200) || '(제목 없음)';
  const start = String(input.start);
  parse(start); // 형식 검사
  let end = input.end ? String(input.end) : null;
  if (end) {
    parse(end);
    if (isDateOnly(start) !== isDateOnly(end)) end = null;
  }
  const s = parse(start);
  if (!end || parse(end) <= s) {
    end = isDateOnly(start) ? fmtLike(s + DAY, start) : (end && parse(end) === s ? end : fmtLike(s + 3600000, start));
  }
  const reminders = Array.isArray(input.reminders)
    ? [...new Set(input.reminders.map(Number).filter((m) => Number.isFinite(m) && m >= 0 && m <= 40320))].sort((a, b) => a - b)
    : [];
  return {
    title,
    start,
    end,
    color: COLORS.includes(input.color) ? input.color : 'blue',
    location: String(input.location ?? '').slice(0, 300),
    memo: String(input.memo ?? '').slice(0, 5000),
    reminders,
    recurrence: cleanRecurrence(input.recurrence),
  };
}

function createEvent(data, input) {
  const ev = { id: newId(), ...cleanFields(input), exdates: [], createdAt: nowIso(), updatedAt: nowIso() };
  data.events.push(ev);
  return ev;
}

function findIndex(data, id) {
  const i = data.events.findIndex((e) => e.id === id);
  if (i < 0) throw new Error('일정을 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
  return i;
}

// 반복을 occurrenceStart '직전'에서 끝낸다. 남은 횟수(count 사용 시)를 반환.
function truncateBefore(series, occurrenceStart) {
  const r = series.recurrence;
  let remaining = null;
  if (r.count) {
    const before = countBefore(series, occurrenceStart);
    remaining = Math.max(1, r.count - before);
    series.recurrence = { ...r, count: before };
    delete series.recurrence.until;
  } else {
    series.recurrence = { ...r, until: addDays(occurrenceStart.slice(0, 10), -1) };
  }
  series.exdates = (series.exdates || []).filter((x) => x < occurrenceStart);
  series.updatedAt = nowIso();
  return remaining;
}

/**
 * 일정 수정.
 * @param scope 'all' | 'this' | 'future' (반복 일정일 때만 의미 있음)
 * @param occurrenceStart 사용자가 연 발생의 시작값
 */
function updateEvent(data, id, { scope = 'all', occurrenceStart, changes }) {
  const i = findIndex(data, id);
  const series = data.events[i];
  const merged = cleanFields({ ...series, ...changes });

  if (!series.recurrence) {
    Object.assign(series, merged, { updatedAt: nowIso() });
    if (merged.recurrence) series.exdates = [];
    return series;
  }

  const occ = occurrenceStart || series.start;

  if (scope === 'this') {
    series.exdates = [...new Set([...(series.exdates || []), occ])];
    series.updatedAt = nowIso();
    const single = { id: newId(), ...merged, recurrence: null, exdates: [], seriesId: series.id, createdAt: nowIso(), updatedAt: nowIso() };
    data.events.push(single);
    return single;
  }

  if (scope === 'future' && occ !== series.start) {
    const remaining = truncateBefore(series, occ);
    const rec = merged.recurrence ? { ...merged.recurrence } : null;
    if (rec && remaining && series.recurrence.count && !('count' in (changes.recurrence || {}))) rec.count = remaining;
    const next = { id: newId(), ...merged, recurrence: rec, exdates: [], createdAt: nowIso(), updatedAt: nowIso() };
    data.events.push(next);
    return next;
  }

  // 'all' — 열어 본 발생에서 바꾼 만큼 반복 전체의 시작을 옮긴다
  if (!merged.recurrence) {
    Object.assign(series, merged, { exdates: [], updatedAt: nowIso() });
    return series;
  }
  const dayDelta = Math.round((parse(merged.start.slice(0, 10)) - parse(occ.slice(0, 10))) / DAY);
  const newStartDate = addDays(series.start.slice(0, 10), dayDelta);
  const newStart = newStartDate + merged.start.slice(10);
  const dur = durationOf(merged);
  Object.assign(series, merged, {
    start: newStart,
    end: fmtLike(parse(newStart) + dur, newStart),
    exdates: dayDelta === 0 && isDateOnly(newStart) === isDateOnly(series.start) ? series.exdates || [] : [],
    updatedAt: nowIso(),
  });
  return series;
}

function deleteEvent(data, id, { scope = 'all', occurrenceStart } = {}) {
  const i = findIndex(data, id);
  const series = data.events[i];
  const occ = occurrenceStart || series.start;
  if (!series.recurrence || scope === 'all' || (scope === 'future' && occ === series.start)) {
    data.events.splice(i, 1);
    return;
  }
  if (scope === 'this') {
    series.exdates = [...new Set([...(series.exdates || []), occ])];
  } else if (scope === 'future') {
    truncateBefore(series, occ);
  }
  series.updatedAt = nowIso();
}

// ── 메모 ─────────────────────────────────────────
// id가 있으면 수정, 없거나 못 찾으면 새로 만든다(되돌리기 시 원래 id·위치로 복원).
function saveMemo(data, { id, text, index }) {
  const body = String(text ?? '').slice(0, 20000);
  if (id) {
    const m = data.memos.find((x) => x.id === id);
    if (m) {
      m.text = body;
      m.updatedAt = nowIso();
      return m;
    }
  }
  const validId = typeof id === 'string' && /^[\w-]{8,64}$/.test(id) ? id : newId();
  const m = { id: validId, text: body, createdAt: nowIso(), updatedAt: nowIso() };
  const at = Number.isInteger(index) ? Math.min(Math.max(index, 0), data.memos.length) : 0;
  data.memos.splice(at, 0, m);
  return m;
}

function deleteMemo(data, id) {
  data.memos = data.memos.filter((m) => m.id !== id);
}

module.exports = { createEvent, updateEvent, deleteEvent, saveMemo, deleteMemo, cleanFields, COLORS };
