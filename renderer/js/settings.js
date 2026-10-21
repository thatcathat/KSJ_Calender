'use strict';
/* global api */
// 설정 창과 업데이트 상태
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 설정 ─────────────────────────────────────
const sdlg = $('#settingsDialog');
const sform = $('#settingsForm');

function renderSettings() {
  const s = state.settings;
  sform.querySelectorAll('[data-week]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.week === s.weekStartsOn)));
  const sel = sform.defaultReminder;
  sel.replaceChildren(new Option('없음', ''));
  for (const [v, label] of TIMED_REMINDERS.slice(0, 7)) sel.appendChild(new Option(label, String(v)));
  sel.value = s.defaultReminders && s.defaultReminders.length ? String(s.defaultReminders[0]) : '';
  sform.showHolidays.checked = s.showHolidays;
  sform.closeToTray.checked = s.closeToTray;
  sform.launchAtLogin.checked = s.launchAtLogin;
  const ul = $('#customHolidayList');
  ul.replaceChildren();
  for (const h of [...s.customHolidays].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const li = el('li');
    li.append(el('span', 'd', h.date.replace(/-/g, '.')), el('span', 'n', h.name));
    const x = el('button', 'icon-btn');
    x.type = 'button';
    x.setAttribute('aria-label', `${h.name} 삭제`);
    x.appendChild(icon(ICON.close));
    x.addEventListener('click', () => saveSettings({ customHolidays: s.customHolidays.filter((c) => c !== h) }, true));
    li.appendChild(x);
    ul.appendChild(li);
  }
}

async function saveSettings(patch, holidaysChanged) {
  try {
    state.settings = await api.setSettings(patch);
    state.weekStartsOn = state.settings.weekStartsOn;
    if (holidaysChanged) state.holidayYears = null;
    renderSettings();
    await refresh();
  } catch (err) { fail(err); }
}

sform.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => saveSettings({ weekStartsOn: +b.dataset.week })));
sform.defaultReminder.addEventListener('change', (e) => saveSettings({ defaultReminders: e.target.value === '' ? [] : [+e.target.value] }));
sform.showHolidays.addEventListener('change', (e) => saveSettings({ showHolidays: e.target.checked }, true));
sform.closeToTray.addEventListener('change', (e) => saveSettings({ closeToTray: e.target.checked }));
sform.launchAtLogin.addEventListener('change', (e) => saveSettings({ launchAtLogin: e.target.checked }));
$('#chAdd').addEventListener('click', () => {
  const date = $('#chDate').value;
  const name = $('#chName').value.trim() || '공휴일';
  if (!date) { toast('날짜를 선택하세요'); return; }
  $('#chDate').value = '';
  $('#chName').value = '';
  saveSettings({ customHolidays: [...state.settings.customHolidays.filter((h) => h.date !== date), { date, name }] }, true);
});
$('#openDataBtn').addEventListener('click', () => api.openDataFolder().catch(fail));
$('#menuSettings').addEventListener('click', () => pickMenu(() => { renderSettings(); sdlg.showModal(); }));

// ── 업데이트 ─────────────────────────────────
let update = null;

function renderUpdate() {
  if (!update) return;
  const { state: st, version, newVersion, percent } = update;
  $('#appVersion').textContent = `버전 ${version}`;
  const text = {
    unsupported: '설치형에서만 자동 업데이트돼요.',
    checking: '확인하는 중…',
    latest: '최신 버전이에요.',
    downloading: `새 버전 ${newVersion} 받는 중… ${percent || 0}%`,
    ready: `새 버전 ${newVersion}을 설치할 준비가 됐어요.`,
    error: '업데이트를 확인하지 못했어요.',
  }[st] || '';
  $('#updateText').textContent = text;
  const btn = $('#updateBtn');
  btn.hidden = st === 'unsupported';
  btn.disabled = st === 'checking' || st === 'downloading';
  btn.textContent = st === 'ready' ? '재시작해서 업데이트' : st === 'error' ? '다시 확인' : '업데이트 확인';
}

function setUpdate(next) {
  const becameReady = next.state === 'ready' && (!update || update.state !== 'ready');
  update = next;
  renderUpdate();
  if (becameReady) toast(`새 버전 ${next.newVersion}이 준비됐어요`, { label: '재시작', run: () => api.update.install().catch(fail) });
}

$('#updateBtn').addEventListener('click', () => {
  if (update && update.state === 'ready') api.update.install().catch(fail);
  else api.update.check().then(setUpdate).catch(fail);
});
api.on('update-status', setUpdate);
