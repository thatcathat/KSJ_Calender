'use strict';
// 알림 스케줄러: 주기적으로 '지난 확인 시각 ~ 지금' 사이에 울려야 할 알림을 찾는다.
const { MIN, DAY, parse, toFloating, fmtDate } = require('./dates');
const { expandAll } = require('./recurrence');

const ALL_DAY_BASE_HOUR = 9; // 종일 일정 알림의 기준 시각(그날 오전 9시)
const MAX_LEAD = 7 * DAY; // 가장 긴 알림(1주 전)

/** 발생의 '기준 시각'(floating ms) */
function baseTime(occ) {
  const s = parse(occ.start);
  return occ.allDay ? s + ALL_DAY_BASE_HOUR * 3600000 : s;
}

/**
 * (fromMs, toMs] 사이에 울려야 하는 알림 목록. 시각은 floating ms.
 * @returns {{key, occ, minutes, fireAt}[]}
 */
function dueReminders(events, fromMs, toMs) {
  const withReminders = events.filter((e) => Array.isArray(e.reminders) && e.reminders.length);
  if (!withReminders.length) return [];
  // 이 구간에 알림이 울릴 수 있는 발생: 시작이 (from, to + 최대 선행시간] 근처
  const occs = expandAll(withReminders, fromMs - DAY, toMs + MAX_LEAD + DAY);
  const due = [];
  for (const occ of occs) {
    const base = baseTime(occ);
    for (const m of occ.reminders) {
      const fireAt = base - m * MIN;
      if (fireAt > fromMs && fireAt <= toMs) {
        due.push({ key: `${occ.id}@${m}`, occ, minutes: m, fireAt });
      }
    }
  }
  due.sort((a, b) => a.fireAt - b.fireAt);
  return due;
}

function leadText(minutes, allDay) {
  if (allDay) {
    if (minutes === 0) return '오늘';
    if (minutes % 1440 === 0) return minutes === 1440 ? '내일' : `${minutes / 1440}일 후`;
  }
  if (minutes === 0) return '지금 시작';
  if (minutes < 60) return `${minutes}분 후 시작`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 후 시작`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 후 시작`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후 시작`;
}

function timeText(occ) {
  if (occ.allDay) return '종일';
  const d = new Date(parse(occ.start));
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${m}`;
}

class Notifier {
  /**
   * @param {() => object[]} getEvents
   * @param {(n:{title, body, date, occ}) => void} notify
   */
  constructor(getEvents, notify, { intervalMs = 20000, graceMs = 5 * MIN } = {}) {
    this.getEvents = getEvents;
    this.notify = notify;
    this.intervalMs = intervalMs;
    this.fired = new Map(); // key -> fireAt
    // 앱이 꺼져 있던 동안 지나간 알림은 최근 graceMs 이내의 것만 울린다
    this.last = toFloating(new Date()) - graceMs;
    this.timer = null;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  tick(now = new Date()) {
    const nowMs = toFloating(now);
    // 시계를 과거로 돌렸으면 기준점만 맞춘다
    if (nowMs < this.last) {
      this.last = nowMs;
      return [];
    }
    let due = [];
    try {
      due = dueReminders(this.getEvents(), this.last, nowMs).filter((d) => !this.fired.has(d.key));
    } catch (err) {
      console.error('알림 확인 실패', err);
    }
    for (const d of due) {
      this.fired.set(d.key, d.fireAt);
      const { occ } = d;
      const body = [`${timeText(occ)} · ${leadText(d.minutes, occ.allDay)}`, occ.location].filter(Boolean).join('\n');
      this.notify({ title: occ.title, body, date: fmtDate(parse(occ.start)), occ });
    }
    this.last = nowMs;
    // 오래된 기록 정리
    for (const [k, t] of this.fired) if (t < nowMs - 2 * DAY) this.fired.delete(k);
    return due;
  }
}

module.exports = { Notifier, dueReminders, leadText };
