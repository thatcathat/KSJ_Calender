'use strict';
// JSON 파일 저장소. 쓰기는 임시 파일 → rename 으로 원자적으로 하고,
// 직전 정상본을 .bak 으로 남겨 파일이 깨져도 복구할 수 있게 한다.
// .bak은 저장할 때마다 덮어써지므로, 실수로 지운 걸 며칠 뒤 되살릴 수 있게 날짜별 백업도 남긴다.
const fs = require('fs');
const path = require('path');
const { todayStr } = require('./dates');

const DAILY_KEEP = 7; // 날짜별 백업을 며칠치 남길지
const DAILY_RE = /^calendar-data-\d{4}-\d{2}-\d{2}\.json$/;

const DEFAULT_SETTINGS = {
  closeToTray: true,
  launchAtLogin: false,
  weekStartsOn: 0, // 0=일요일, 1=월요일
  calendarMode: 'month', // 'month' | 'week'
  defaultReminders: [10],
  showHolidays: true,
  customHolidays: [], // [{date:'YYYY-MM-DD', name}]
  trayHintShown: false,
  windowBounds: null,
  windowLayout: 0,
};

function emptyData() {
  return { version: 1, events: [], memos: [], settings: { ...DEFAULT_SETTINGS } };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'calendar-data.json');
    this.backup = `${this.file}.bak`;
    this.dailyDir = path.join(dir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this.load();
  }

  readFile(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) throw new Error('형식이 올바르지 않음');
    return parsed;
  }

  load() {
    if (!fs.existsSync(this.file)) return emptyData();
    let data;
    try {
      data = this.readFile(this.file);
    } catch (err) {
      // 깨진 파일은 보관해 두고 백업본으로 복구 시도
      const broken = `${this.file}.broken-${Date.now()}`;
      try { fs.renameSync(this.file, broken); } catch { /* 무시 */ }
      console.error('데이터 파일을 읽지 못해 백업에서 복구합니다:', err.message);
      // .bak → 최근 날짜별 백업 순으로, 처음 읽히는 것을 쓴다
      for (const file of [this.backup, ...this.dailyBackups().reverse()]) {
        try {
          data = this.readFile(file);
          break;
        } catch { /* 다음 후보 */ }
      }
      if (!data) data = emptyData();
    }
    data.memos = Array.isArray(data.memos) ? data.memos : [];
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    for (const ev of data.events) ev.exdates = Array.isArray(ev.exdates) ? ev.exdates : [];
    return data;
  }

  save() {
    const json = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, json, 'utf8');
    if (fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.backup); } catch { /* 무시 */ }
      this.saveDailyBackup();
    }
    // Windows에서 백신 등이 파일을 잠깐 잡고 있으면 rename이 실패할 수 있어 몇 번 재시도
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        const until = Date.now() + 50 * (i + 1);
        while (Date.now() < until) { /* 짧게 대기 */ }
      }
    }
  }

  /** 날짜별 백업 파일 경로, 오래된 것부터 */
  dailyBackups() {
    try {
      return fs.readdirSync(this.dailyDir).filter((f) => DAILY_RE.test(f)).sort().map((f) => path.join(this.dailyDir, f));
    } catch {
      return [];
    }
  }

  // 그날 처음 저장할 때, 저장 직전 상태(= 전날까지의 내용)를 하루 한 장 남기고 오래된 것은 지운다
  saveDailyBackup(now = new Date()) {
    try {
      const target = path.join(this.dailyDir, `calendar-data-${todayStr(now)}.json`);
      if (fs.existsSync(target)) return;
      fs.mkdirSync(this.dailyDir, { recursive: true });
      fs.copyFileSync(this.file, target);
      const all = this.dailyBackups();
      for (const old of all.slice(0, Math.max(0, all.length - DAILY_KEEP))) fs.unlinkSync(old);
    } catch (err) {
      console.error('날짜별 백업 실패', err.message);
    }
  }

  /** 데이터를 바꾸는 작업을 실행하고 저장 */
  mutate(fn) {
    const result = fn(this.data);
    this.save();
    return result;
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
