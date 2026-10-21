'use strict';
/* global api */
// 일정 검색 창
// 여러 스크립트가 전역을 함께 쓴다. index.html의 <script> 순서를 지켜야 한다.

// ── 일정 검색 ─────────────────────────────────
const searchDlg = $('#searchDialog');
const searchInput = $('#searchInput');
let searchReq = 0;
let searchTimer;

function openSearch() {
  if (document.querySelector('dialog[open]')) return;
  searchDlg.showModal();
  searchInput.select();
  runSearch();
}

function searchItem(o) {
  const btn = el('button', `item c-${o.color}`);
  btn.type = 'button';
  if (!o.upcoming) btn.classList.add('past');
  btn.appendChild(el('span', 'bar'));
  const d = o.start.slice(0, 10);
  const when = el('span', 'when', `${+d.slice(5, 7)}월 ${+d.slice(8)}일`);
  const sub = [d.slice(0, 4) !== state.today.slice(0, 4) ? `${d.slice(0, 4)}년` : '', WD[wdOf(d)], o.allDay ? '' : o.start.slice(11, 16)];
  when.appendChild(el('small', '', sub.filter(Boolean).join(' ')));
  btn.appendChild(when);
  const what = el('span', 'what');
  what.appendChild(el('span', 'title', o.title));
  const meta = el('span', 'meta');
  if (o.location) { const s = el('span'); s.append(icon(ICON.pin), o.location); meta.appendChild(s); }
  if (o.recurring) { const s = el('span'); s.append(icon(ICON.repeat), o.repeatText); meta.appendChild(s); }
  if (meta.childNodes.length) what.appendChild(meta);
  btn.appendChild(what);
  btn.setAttribute('aria-label', `${o.title}, ${when.textContent}`);
  btn.addEventListener('click', () => {
    searchDlg.close();
    select(d);
  });
  const li = el('li');
  li.appendChild(btn);
  return li;
}

async function runSearch() {
  const q = searchInput.value.trim();
  const req = ++searchReq;
  const list = $('#searchResults');
  const status = $('#searchStatus');
  if (!q) {
    list.replaceChildren();
    status.textContent = '제목이나 장소에 들어간 말로 찾아요. 반복 일정은 다음 날짜로 보여요.';
    return;
  }
  let res;
  try {
    res = await api.search(q);
  } catch (err) { fail(err); return; }
  if (req !== searchReq) return; // 그 사이 검색어가 바뀜
  list.replaceChildren(...res.items.map(searchItem));
  status.textContent = !res.total ? '찾는 일정이 없어요.'
    : res.total > res.items.length ? `${res.total}개 중 가까운 ${res.items.length}개만 보여요.` : '';
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});
// Enter는 첫 번째 결과로 이동
$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);
  await runSearch();
  $('#searchResults .item')?.click();
});
// ↑↓로 검색칸과 결과 사이를 오간다
searchDlg.addEventListener('keydown', (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!step) return;
  const stops = [searchInput, ...searchDlg.querySelectorAll('#searchResults .item')];
  const i = stops.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  stops[Math.min(Math.max(i + step, 0), stops.length - 1)].focus();
});
$('#searchBtn').addEventListener('click', openSearch);
