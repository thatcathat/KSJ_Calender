'use strict';
// JSON 파일 저장소. 쓰기는 임시 파일 → rename 으로 원자적으로 하고,
// 직전 정상본을 .bak 으로 남겨 파일이 깨져도 복구할 수 있게 한다.
const fs = require('fs');
const path = require('path');

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
      try {
        data = this.readFile(this.backup);
      } catch {
        data = emptyData();
      }
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

  /** 데이터를 바꾸는 작업을 실행하고 저장 */
  mutate(fn) {
    const result = fn(this.data);
    this.save();
    return result;
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
