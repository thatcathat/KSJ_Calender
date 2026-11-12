'use strict';
// Tauri로 실행될 때 화면이 쓰는 window.api를 만든다. 모양은 예전 Electron preload.js와 같다.
// 명령은 src-tauri/src/commands.rs에 있다. (Electron으로 실행되면 preload.js가 이미 만들어 두므로 아무것도 안 함)
(function setupTauriApi() {
  if (window.api || !window.__TAURI__) return;
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // 아직 끝나지 않은 명령. 트레이로 닫을 때 저장이 끝나길 기다리는 데 쓴다.
  const inflight = new Set();

  // Rust 쪽 오류는 문자열로 오므로 Error로 바꿔 화면의 오류 처리(err.message)가 그대로 동작하게
  async function call(cmd, args) {
    const p = invoke(cmd, args);
    inflight.add(p);
    try {
      return await p;
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : (err && err.message) || String(err));
    } finally {
      inflight.delete(p);
    }
  }

  const LISTEN = ['navigate', 'new-event', 'day-changed', 'win-state', 'pointer-out', 'update-status'];
  // 이벤트 등록(비동기)이 다 끝나야 Rust가 모아 둔 이벤트를 보내도 놓치지 않는다
  const listening = [];

  window.api = {
    range: (start, end) => call('range', { start, end }),
    holidays: (fromYear, toYear) => call('holidays', { fromYear, toYear }),
    lunar: (date) => call('lunar', { date: String(date) }),
    search: (query) => call('search', { query }),

    getEvent: (id) => call('event_get', { id }),
    createEvent: (input) => call('event_create', { input }),
    updateEvent: (id, opts) => call('event_update', { id, opts }),
    deleteEvent: (id, opts) => call('event_delete', { id, opts }),
    restoreEvent: (snapshot) => call('event_restore', { snapshot }),

    listMemos: () => call('memo_list'),
    saveMemo: (memo) => call('memo_save', { memo }),
    deleteMemo: (id) => call('memo_delete', { id }),
    reorderMemos: (ids) => call('memo_reorder', { ids }),

    getSettings: () => call('settings_get'),
    setSettings: (patch) => call('settings_set', { patch }),
    openDataFolder: () => call('data_open_folder'),

    update: {
      status: () => call('update_status'),
      check: () => call('update_check'),
      install: () => call('update_install'),
    },

    win: {
      minimize: () => call('win_minimize'),
      toggleMaximize: () => call('win_toggle_maximize'),
      close: () => call('win_close'),
      isMaximized: () => call('win_is_maximized'),
      watchPointer: () => call('win_watch_pointer'),
    },

    on(channel, cb) {
      if (!LISTEN.includes(channel)) return;
      listening.push(listen(channel, (e) => cb(e.payload)));
    },
  };

  // ── 트레이로 닫을 때 ──
  // 창은 이미 숨겨진 상태. 쓰던 메모를 저장하고(메모는 입력칸을 벗어날 때 저장된다), 저장이 끝나면
  // Rust가 화면 엔진을 닫아 메모리를 돌려준다. 대화상자가 열려 있으면 쓰던 내용이 사라지지 않게 그대로 둔다.
  listening.push(listen('close-to-tray', async () => {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    await Promise.allSettled([...inflight]);
    call('win_release', { keep: !!document.querySelector('dialog[open]') }).catch(() => {});
  }));

  // 모든 스크립트가 api.on 등록을 마친 뒤 준비됐다고 알린다
  window.addEventListener('load', () => {
    Promise.all(listening).then(() => call('screen_ready')).catch(() => {});
  });

  // ── 창 옮기기 ──
  // Electron은 CSS -webkit-app-region: drag 로 잡고 끌었지만 WebView2에선 동작하지 않는다.
  // 같은 영역(styles.css에서 drag로 표시한 곳)에서 누른 채 움직이면 창 끌기를 시작하고, 두 번 누르면 최대화한다.
  const DRAG = '.titlebar, .cal-head';
  const NO_DRAG = 'button, input, select, textarea, a, label, .win-controls';
  const dragArea = (target) => target instanceof Element && target.closest(DRAG) && !target.closest(NO_DRAG);
  let pressed = null;

  document.addEventListener('mousedown', (e) => {
    pressed = e.button === 0 && dragArea(e.target) ? { x: e.screenX, y: e.screenY } : null;
  });
  document.addEventListener('mousemove', (e) => {
    if (!pressed || !(e.buttons & 1)) { pressed = null; return; }
    // 살짝 떨린 클릭은 끌기로 보지 않는다
    if (Math.abs(e.screenX - pressed.x) + Math.abs(e.screenY - pressed.y) < 3) return;
    pressed = null;
    call('win_start_drag').catch(() => {});
  });
  document.addEventListener('mouseup', () => { pressed = null; });
  document.addEventListener('dblclick', (e) => {
    if (e.button === 0 && dragArea(e.target)) call('win_toggle_maximize').catch(() => {});
  });
})();
