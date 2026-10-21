'use strict';
// 화면(renderer)에 노출하는 최소한의 API. Node 기능은 직접 노출하지 않는다.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

const LISTEN = ['navigate', 'new-event', 'day-changed', 'win-state', 'pointer-out', 'update-status'];

contextBridge.exposeInMainWorld('api', {
  range: (start, end) => call('range', start, end),
  holidays: (fromYear, toYear) => call('holidays', fromYear, toYear),
  lunar: (date) => call('lunar', date),
  search: (query) => call('search', query),

  getEvent: (id) => call('event:get', id),
  createEvent: (input) => call('event:create', input),
  updateEvent: (id, opts) => call('event:update', id, opts),
  deleteEvent: (id, opts) => call('event:delete', id, opts),
  restoreEvent: (snapshot) => call('event:restore', snapshot),

  listMemos: () => call('memo:list'),
  saveMemo: (memo) => call('memo:save', memo),
  deleteMemo: (id) => call('memo:delete', id),
  reorderMemos: (ids) => call('memo:reorder', ids),

  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  openDataFolder: () => call('data:open-folder'),

  update: {
    status: () => call('update:status'),
    check: () => call('update:check'),
    install: () => call('update:install'),
  },

  win: {
    minimize: () => call('win:minimize'),
    toggleMaximize: () => call('win:toggle-maximize'),
    close: () => call('win:close'),
    isMaximized: () => call('win:is-maximized'),
    watchPointer: () => call('win:watch-pointer'),
  },

  on(channel, cb) {
    if (!LISTEN.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
