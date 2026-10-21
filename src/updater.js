'use strict';
// 자동 업데이트: GitHub Releases에 새 버전이 올라오면 백그라운드로 받아 두고,
// 재시작(또는 다음 종료) 때 설치한다. 설치형(NSIS)에서만 동작한다.
const { app } = require('electron');

const FIRST_CHECK_DELAY = 10 * 1000; // 시작 직후는 피해서 잠시 뒤 확인
const CHECK_EVERY = 6 * 3600 * 1000;

/**
 * @param {{supported:boolean, onStatus:(s)=>void, onReady:(s)=>void}} opts
 * 상태(state): 'unsupported' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
 */
function createUpdater({ supported, onStatus, onReady }) {
  let status = { state: supported ? 'idle' : 'unsupported', version: app.getVersion() };
  const set = (patch) => {
    status = { ...status, ...patch };
    onStatus(status);
  };

  if (!supported) {
    return { status: () => status, check: async () => status, install() {}, start() {} };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', newVersion: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent || 0);
    if (percent !== status.percent) set({ percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', newVersion: info.version, percent: 100 });
    onReady(status);
  });
  autoUpdater.on('error', (err) => {
    console.error('업데이트 실패', err);
    // 이미 받아 둔 업데이트가 있으면 그대로 둔다
    if (status.state !== 'ready') set({ state: 'error', error: err ? err.message || String(err) : '' });
  });

  async function check() {
    if (['checking', 'downloading', 'ready'].includes(status.state)) return status;
    try {
      await autoUpdater.checkForUpdates();
    } catch { /* 'error' 이벤트에서 처리 */ }
    return status;
  }

  return {
    status: () => status,
    check,
    // 조용히 설치한 뒤 앱을 다시 띄운다
    install() {
      if (status.state === 'ready') autoUpdater.quitAndInstall(true, true);
    },
    start() {
      setTimeout(check, FIRST_CHECK_DELAY);
      setInterval(check, CHECK_EVERY);
    },
  };
}

module.exports = { createUpdater };
