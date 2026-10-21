'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, nativeTheme, screen } = require('electron');
const KoreanLunarCalendar = require('korean-lunar-calendar');

const { Store } = require('./src/store');
const { holidayMap } = require('./src/holidays');
const { expandAll } = require('./src/recurrence');
const events = require('./src/events');
const { Notifier } = require('./src/notifier');

const APP_ID = 'com.deskcalendar.app';
const START_HIDDEN = process.argv.includes('--hidden');

let win = null;
let tray = null;
let store = null;
let notifier = null;
let quitting = false;

// 하나만 실행
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// 날짜·시간 입력칸을 한국어(오전/오후) 형식으로
app.commandLine.appendSwitch('lang', 'ko');

// Windows 알림이 앱 이름으로 표시되려면 필요
app.setAppUserModelId(APP_ID);

const asset = (name) => path.join(__dirname, 'assets', name);

function iconImage(size) {
  const img = nativeImage.createFromPath(asset('icon.png'));
  return size ? img.resize({ width: size, height: size }) : img;
}

function validBounds(b) {
  if (!b || typeof b.width !== 'number') return null;
  // 모니터가 바뀌어 화면 밖에 뜨는 걸 방지
  const area = screen.getDisplayMatching(b).workArea;
  const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 20 && b.y < area.y + area.height - 80;
  return visible ? b : { width: b.width, height: b.height };
}

function createWindow() {
  const s = store.data.settings;
  // 기본 크기가 바뀌면(WINDOW_LAYOUT 증가) 예전에 저장된 창 크기는 한 번 무시한다
  const WINDOW_LAYOUT = 2;
  if (s.windowLayout !== WINDOW_LAYOUT) {
    s.windowBounds = null;
    s.windowLayout = WINDOW_LAYOUT;
  }
  const bounds = validBounds(s.windowBounds) || { width: 350, height: 630 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 480,
    show: false,
    title: '데스크 캘린더',
    icon: asset('icon.png'),
    frame: false, // 기본 제목 표시줄·테두리 제거 (가장자리 크기 조절과 창 스냅은 유지)
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12161f' : '#f3f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (!START_HIDDEN) win.show();
  });


  // 외부 링크·이동 차단
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  const saveBounds = () => {
    if (!win || win.isMinimized() || win.isMaximized()) return;
    store.data.settings.windowBounds = win.getBounds();
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', (e) => {
    try { store.save(); } catch { /* 무시 */ }
    if (!quitting && store.data.settings.closeToTray) {
      e.preventDefault();
      win.hide();
      if (!store.data.settings.trayHintShown && Notification.isSupported()) {
        new Notification({
          title: '데스크 캘린더가 트레이에서 실행 중이에요',
          body: '알림을 계속 받을 수 있어요. 완전히 끄려면 트레이 아이콘에서 "종료"를 누르세요.',
          icon: asset('icon.png'),
        }).show();
        store.mutate((d) => { d.settings.trayHintShown = true; });
      }
    }
  });
  win.on('closed', () => { win = null; });

  // 최대화 상태를 화면에 알려 버튼 모양(최대화/이전 크기로)을 바꾼다
  const sendWinState = () => win && win.webContents.send('win-state', { maximized: win.isMaximized() });
  win.on('maximize', sendWinState);
  win.on('unmaximize', sendWinState);
}

function showWindow(sendChannel, payload) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (sendChannel) {
    const send = () => win.webContents.send(sendChannel, payload);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
}

// 마우스가 창 안에 있는지 커서 위치로 확인 (끌기 영역 위에서는 화면이 마우스 이동을 못 받기 때문)
let pointerTimer = null;
function pointerInside() {
  if (!win || !win.isVisible()) return false;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}
function watchPointer() {
  clearInterval(pointerTimer);
  const check = () => {
    if (!win) { clearInterval(pointerTimer); return; }
    if (!pointerInside()) {
      clearInterval(pointerTimer);
      win.webContents.send('pointer-out');
    }
  };
  pointerTimer = setInterval(check, 120);
  check();
}

function createTray() {
  tray = new Tray(iconImage(16));
  tray.setToolTip('데스크 캘린더');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => showWindow() },
    { label: '오늘 보기', click: () => showWindow('navigate', null) },
    { label: '새 일정', click: () => showWindow('new-event') },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}

// 포터블 실행 파일은 매번 임시 폴더에 풀려 실행되므로, 실제 exe 위치를 써야 한다
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || null;

function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (!app.isPackaged) return; // 개발 중(npm start)에는 등록하지 않음
  const opts = { openAtLogin: !!store.data.settings.launchAtLogin, args: ['--hidden'] };
  if (PORTABLE_EXE) opts.path = PORTABLE_EXE;
  app.setLoginItemSettings(opts);
}

// Windows 토스트 알림은 AppUserModelID가 달린 시작 메뉴 바로가기가 있어야 뜬다.
// 설치판은 설치 프로그램이 만들어 주므로, 포터블판일 때만 직접 만든다.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !PORTABLE_EXE) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', '데스크 캘린더.lnk');
    const opts = { target: PORTABLE_EXE, appUserModelId: APP_ID, icon: PORTABLE_EXE, iconIndex: 0, description: '데스크 캘린더' };
    shell.writeShortcutLink(lnk, require('fs').existsSync(lnk) ? 'replace' : 'create', opts);
  } catch (err) {
    console.error('시작 메뉴 바로가기 생성 실패', err);
  }
}

function notify({ title, body, date }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: asset('icon.png'), silent: false });
  n.on('click', () => showWindow('navigate', date));
  n.show();
}

// ── IPC ──────────────────────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      console.error(channel, err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerIpc() {
  handle('win:minimize', () => win && win.minimize());
  handle('win:toggle-maximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('win:close', () => win && win.close()); // 트레이로 숨기기 설정이 그대로 적용됨
  handle('win:is-maximized', () => !!win && win.isMaximized());
  handle('win:watch-pointer', () => watchPointer());

  handle('range', (start, end) => expandAll(store.data.events, String(start), String(end)));
  handle('holidays', (fromYear, toYear) => {
    if (!store.data.settings.showHolidays) return {};
    const a = Math.max(1900, Math.min(+fromYear, +toYear));
    const b = Math.min(2050, Math.max(+fromYear, +toYear), a + 5);
    return holidayMap(a, b, store.data.settings.customHolidays);
  });
  handle('lunar', (dateStr) => {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const cal = new KoreanLunarCalendar();
    if (!cal.setSolarDate(y, m, d)) return null;
    const l = cal.getLunarCalendar();
    return { month: l.month, day: l.day, leap: !!l.intercalation };
  });
  handle('event:get', (id) => store.data.events.find((e) => e.id === id) || null);
  handle('event:create', (input) => {
    const ev = store.mutate((d) => events.createEvent(d, input));
    return ev;
  });
  handle('event:update', (id, opts) => store.mutate((d) => events.updateEvent(d, id, opts)));
  handle('event:delete', (id, opts) => store.mutate((d) => events.deleteEvent(d, id, opts)));

  handle('memo:list', () => store.data.memos);
  handle('memo:save', (memo) => store.mutate((d) => events.saveMemo(d, memo)));
  handle('memo:delete', (id) => store.mutate((d) => events.deleteMemo(d, id)));

  handle('settings:get', () => store.data.settings);
  handle('settings:set', (patch) => {
    const allowed = ['closeToTray', 'launchAtLogin', 'weekStartsOn', 'calendarMode', 'defaultReminders', 'showHolidays', 'customHolidays'];
    store.mutate((d) => {
      for (const k of allowed) if (patch && k in patch) d.settings[k] = patch[k];
    });
    if (patch && 'launchAtLogin' in patch) applyLoginItem();
    return store.data.settings;
  });
  handle('data:open-folder', () => shell.openPath(store.dir));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  registerIpc();
  createWindow();
  createTray();
  applyLoginItem();
  ensureStartMenuShortcut();
  notifier = new Notifier(() => store.data.events, notify);
  notifier.start();

  // 자정이 지나면 화면의 '오늘'을 갱신
  let lastDay = new Date().toDateString();
  setInterval(() => {
    const today = new Date().toDateString();
    if (today !== lastDay) {
      lastDay = today;
      if (win) win.webContents.send('day-changed');
    }
  }, 30000);
});

app.on('before-quit', () => {
  quitting = true;
  if (notifier) notifier.stop();
  if (store) {
    try { store.save(); } catch { /* 무시 */ }
  }
});

// 트레이 상주 앱이므로 창이 모두 닫혀도 종료하지 않음(트레이 끄기 설정 시 종료)
app.on('window-all-closed', () => {
  if (!store || !store.data.settings.closeToTray) app.quit();
});

