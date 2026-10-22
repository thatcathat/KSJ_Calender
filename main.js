'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, nativeTheme, screen } = require('electron');
const KoreanLunarCalendar = require('korean-lunar-calendar');

const { Store } = require('./src/store');
const { holidayMap } = require('./src/holidays');
const { expandAll } = require('./src/recurrence');
const { searchEvents } = require('./src/search');
const events = require('./src/events');
const { Notifier } = require('./src/notifier');
const { createUpdater } = require('./src/updater');

const APP_ID = 'com.deskcalendar.app';
const START_HIDDEN = process.argv.includes('--hidden');

let win = null;
let tray = null;
let store = null;
let notifier = null;
let updater = null;
let quitting = false;

// 소스로 실행(npm start)할 때는 데이터 폴더를 따로 써서, 설치된 앱의 일정을 건드리지 않고 나란히 띄울 수 있게 한다.
// 아래 '하나만 실행' 잠금도 이 폴더 기준이라 함께 분리된다.
const DEV = !app.isPackaged;
if (DEV) app.setPath('userData', app.getPath('userData') + '-dev');

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

// 창 바탕색(styles.css의 --paper와 같은 값)
const paperColor = () => (nativeTheme.shouldUseDarkColors ? '#12161f' : '#f3f5f8');

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
    backgroundColor: paperColor(),
    // Windows 11이 창 둘레에 그리는 1px 테두리를 바탕색으로 칠해 보이지 않게 한다
    accentColor: paperColor(),
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
        showNotification({
          title: '데스크 캘린더가 트레이에서 실행 중이에요',
          body: '알림을 계속 받을 수 있어요. 완전히 끄려면 트레이 아이콘에서 "종료"를 누르세요.',
        });
        store.mutate((d) => { d.settings.trayHintShown = true; });
      }
    }
  });
  win.on('closed', () => { win = null; });

  // 밝은/어두운 모드가 바뀌면 바탕색과 테두리 색도 따라간다
  const syncTheme = () => {
    if (!win) return;
    win.setBackgroundColor(paperColor());
    win.setAccentColor(paperColor());
  };
  nativeTheme.on('updated', syncTheme);
  win.once('closed', () => nativeTheme.off('updated', syncTheme));

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

function trayMenu() {
  const ready = updater && updater.status().state === 'ready';
  return Menu.buildFromTemplate([
    { label: '열기', click: () => showWindow() },
    { label: '오늘 보기', click: () => showWindow('navigate', null) },
    { label: '새 일정', click: () => showWindow('new-event') },
    { type: 'separator' },
    ...(ready ? [{ label: `재시작해서 업데이트 (${updater.status().newVersion})`, click: () => updater.install() }] : []),
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(iconImage(16));
  tray.setToolTip(DEV ? '데스크 캘린더 (개발)' : '데스크 캘린더');
  tray.setContextMenu(trayMenu());
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

// 알림 객체를 참조하지 않으면 가비지 컬렉션으로 사라져 클릭 이벤트가 오지 않는다.
// 알림 센터에 남은 알림을 나중에 눌러도 동작하도록 클릭될 때까지(최대 하루) 붙잡아 둔다.
const liveNotifications = new Set();
const NOTIFICATION_KEEP = 24 * 3600 * 1000;

function showNotification(opts, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ icon: asset('icon.png'), ...opts });
  const release = () => {
    clearTimeout(timer);
    liveNotifications.delete(n);
  };
  const timer = setTimeout(release, NOTIFICATION_KEEP);
  liveNotifications.add(n);
  n.on('click', () => {
    release();
    if (onClick) onClick();
  });
  n.on('failed', release);
  n.show();
}

function notify({ title, body, date }) {
  showNotification({ title, body, silent: false }, () => showWindow('navigate', date));
}

// 자동 업데이트는 설치형에서만 (개발 모드·포터블판은 제외)
function setupUpdater() {
  updater = createUpdater({
    supported: app.isPackaged && !PORTABLE_EXE && process.platform === 'win32',
    onStatus: (status) => { if (win) win.webContents.send('update-status', status); },
    onReady: (status) => {
      if (tray) tray.setContextMenu(trayMenu());
      showNotification({
        title: `새 버전 ${status.newVersion}을 설치할 준비가 됐어요`,
        body: '클릭하면 재시작해서 업데이트해요. 그냥 두면 다음에 앱을 종료할 때 설치돼요.',
      }, () => updater.install());
    },
  });
  updater.start();
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
  handle('search', (query) => searchEvents(store.data.events, query));
  handle('event:get',(id) => store.data.events.find((e) => e.id === id) || null);
  handle('event:create', (input) => {
    const ev = store.mutate((d) => events.createEvent(d, input));
    return ev;
  });
  handle('event:update', (id, opts) => store.mutate((d) => events.updateEvent(d, id, opts)));
  handle('event:delete', (id, opts) => store.mutate((d) => events.deleteEvent(d, id, opts)));
  handle('event:restore', (snapshot) => store.mutate((d) => events.restoreEvent(d, snapshot)));

  handle('memo:list', () => store.data.memos);
  handle('memo:save', (memo) => store.mutate((d) => events.saveMemo(d, memo)));
  handle('memo:delete', (id) => store.mutate((d) => events.deleteMemo(d, id)));
  handle('memo:reorder', (ids) => store.mutate((d) => events.reorderMemos(d, ids)));

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

  handle('update:status', () => updater.status());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
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
  setupUpdater();

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

