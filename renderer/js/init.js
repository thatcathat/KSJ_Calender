'use strict';
/* global api */
// 시작
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 시작 ─────────────────────────────────────
(async function init() {
  buildStaticControls();
  try {
    state.settings = await api.getSettings();
    state.weekStartsOn = state.settings.weekStartsOn || 0;
    state.mode = state.settings.calendarMode === 'week' ? 'week' : 'month';
    state.memos = await api.listMemos();
  } catch (err) { fail(err); }
  await refresh();
  renderMemos();
  api.update.status().then(setUpdate).catch(() => {});
})();
