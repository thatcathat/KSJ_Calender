# 데스크 캘린더

Windows용 데스크톱 캘린더. 위에서부터 **달력 → 선택한 날짜의 일정 → 메모** 순서로 한 화면에 보입니다.

- 월/주 달력, 일요일·공휴일 빨강 / 토요일 파랑, 창을 넓히면 날짜 칸에 일정 제목 표시
  - 머리 줄: 제목 · ‹ › · 검색 · ⋯(월/주 보기, 설정). 오늘이 없는 달(주)을 볼 때만 제목 옆에 '오늘' 버튼이 나타남
- 일정 추가·수정·삭제, 종일/여러 날 일정, 장소·설명, 색 7가지
  - 삭제 후 되돌리기 (반복 일정도 포함)
  - 고친 내용이 있는 채로 일정 창을 닫으면 한 번 확인
- 반복: 매일 / 매주(요일 선택) / 매월(날짜·n번째 요일·마지막 요일) / 매년, 간격·종료일·횟수
  - 반복 일정 수정·삭제 시 **이 일정만 / 이후 일정 / 모든 일정** 선택
- 알림: 일정마다 여러 개 (정시~1주 전, 종일 일정은 오전 9시 기준). 창을 닫아도 트레이에서 계속 실행
  - 트레이에 있는 동안은 화면 엔진을 닫아 메모리를 거의 쓰지 않음(약 8MB, 창을 열면 약 190MB). 다시 열 때 1초쯤 걸림
  - 앱이 꺼져 있었거나 PC가 절전 중이라 놓친 알림은 최근 5분 이내 것만 울림 (깨어날 때 한꺼번에 울리지 않게)
  - 알림을 누르면 그 날짜로 이동
- 한국 공휴일 자동 계산: 설·추석·부처님 오신 날(음력), 대체공휴일 규칙, 2026년부터 공휴일인 노동절·제헌절 포함
  - 선거일·임시공휴일은 설정 → '직접 추가한 공휴일'에 넣으면 됩니다
- 일정 검색: 제목·장소로 찾고, 결과를 누르면 그 날짜로 이동 (반복 일정은 다음 날짜로 표시)
- 메모: 날짜와 상관없는 메모 여러 개, 입력 즉시 자동 저장, 삭제 후 되돌리기
  - 오른쪽 동그라미(또는 Alt+Enter)로 완료 표시, 왼쪽 손잡이를 끌거나 Alt+↑↓로 순서 바꾸기
- 음력 날짜 표시, 다크 모드(시스템 설정 따름)
- 테두리 없는 창: 창 맨 위 가장자리에 마우스를 올리면 창 버튼(최소화·최대화·닫기) 띠가 내려오고, 달력 머리 줄을 잡고 창을 옮길 수 있음

## 실행 (개발용)

[Tauri 2](https://tauri.app) 앱입니다. 화면은 HTML·CSS·JS(`renderer/`), 나머지는 Rust(`src-tauri/`)입니다.

준비물: [Node.js](https://nodejs.org) 20 이상, [Rust](https://rustup.rs), Visual Studio(또는 Build Tools)의 'C++를 사용한 데스크톱 개발'(MSVC·Windows SDK)

```bash
npm install
npm start
```

- 개발 모드는 데이터를 `%APPDATA%\DeskCalendar-dev`에 따로 저장합니다. 설치된 앱과 동시에 띄워도 서로의 일정에 영향이 없고, 트레이 아이콘에 '(개발)'이 붙습니다.
- 화면(`renderer/`)만 고쳤으면 앱 창에서 `Ctrl+R`로 새로고침하면 반영됩니다. Rust 코드를 고치면 `npm start`가 알아서 다시 빌드해 띄웁니다.
- 개발 모드의 알림은 'Windows PowerShell' 이름으로 뜹니다(알림에 필요한 시작 메뉴 바로가기가 없어서). 설치형은 '데스크 캘린더'로 뜹니다.

```bash
npm test                # 단위 테스트 (src-tauri/core/tests)
```

## 설치 파일 만들기

```bash
npm run build           # src-tauri\target\release\bundle\nsis\DeskCalendar_<버전>_x64-setup.exe
```

로컬 빌드는 GitHub에 올리지 않습니다. 배포는 아래 '새 버전 배포'로 하세요.

서명 키를 지정하지 않으면 설치 파일은 만들어지지만, 마지막 업데이트 서명 단계에서 "no private key" 오류로 끝납니다(만들어진 설치 파일은 그대로 써도 됩니다). 서명까지 하려면 PowerShell에서:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\deskcalendar.key"; npm run build
```

## 새 버전 배포 · 자동 업데이트

`v`로 시작하는 태그를 push하면 GitHub Actions(`.github/workflows/release.yml`)가 Windows에서 테스트·빌드한 뒤,
[Releases](https://github.com/thatcathat/KSJ_Calender/releases)에 설치 파일(`DeskCalendar-Setup-<버전>.exe`)과 `latest.json`을 한 번에 올립니다.

```bash
npm version patch       # 예: 2.0.0 → 2.0.1, package.json 수정·커밋·태그(v2.0.1)까지 한 번에 (기능 추가는 minor)
git push --follow-tags  # 커밋과 태그를 함께 push → 빌드 시작
```

- 태그와 `package.json` 버전이 다르거나 테스트가 실패하면 빌드가 멈춥니다.
- 설치된 앱은 시작 10초 뒤와 6시간마다 `latest.json`을 확인해 새 버전을 백그라운드로 받아 두고, 알림·트레이 메뉴·설정에서 '재시작해서 업데이트'를 누르거나 트레이에서 '종료'할 때 설치합니다.
- 설정 아래쪽에서 현재 버전을 보고 직접 '업데이트 확인'을 할 수 있습니다.
- 개발 모드(`npm start`)는 자동 업데이트하지 않습니다.

**업데이트 서명 키** — 새 버전은 비밀 키로 서명하고, 설치된 앱은 `src-tauri/tauri.conf.json`의 공개 키(`plugins.updater.pubkey`)로 확인한 뒤에만 설치합니다.

- 비밀 키: `%USERPROFILE%\.tauri\deskcalendar.key` (암호 없음). 저장소 비밀값 `TAURI_SIGNING_PRIVATE_KEY`에 같은 내용이 등록돼 있습니다.
- **이 파일을 잃으면 이미 설치된 앱에 업데이트를 보낼 수 없습니다**(새 키로 바꾸면 사용자가 한 번 새로 설치해야 함). 비밀번호 관리자 등 안전한 곳에 따로 백업해 두세요.

> 서명되지 않은 exe라 처음 실행할 때 SmartScreen 경고가 나올 수 있어요. '추가 정보 → 실행'을 누르면 됩니다.

**1.x(Electron판)에서 옮기기** — 1.x는 2.0으로 자동 업데이트되지 않습니다. 설정 → 앱에서 옛 '데스크 캘린더'를 제거하고(일정 데이터는 `%APPDATA%\DeskCalendar`에 그대로 남음) 새 설치 파일로 설치하면 이어서 씁니다. 포터블판은 2.0부터 없습니다.

## 단축키

| 키 | 동작 |
|---|---|
| ← → ↑ ↓ | (달력에 포커스가 있을 때) 날짜 이동 |
| Page Up / Page Down | 이전 / 다음 달(주) |
| T | 오늘로 |
| N | 새 일정 |
| Enter / 날짜 더블클릭 | 그 날짜에 일정 추가 |
| Ctrl+F | 일정 검색 (Enter: 첫 결과로 이동, ↑↓: 결과 사이 이동) |
| Esc | 창 닫기 (일정 창은 고친 내용이 있으면 확인) |
| Alt+Enter | (메모를 쓰는 중) 완료 켜기/끄기 |
| Alt+↑ / Alt+↓ | (메모를 쓰는 중) 메모 순서 바꾸기 |

## 데이터

`%APPDATA%\DeskCalendar\calendar-data.json` 에 저장됩니다(설정 → 데이터 → '폴더 열기').

- 저장할 때마다 직전 상태를 `calendar-data.json.bak`으로 남깁니다.
- 하루에 한 번은 `backups\calendar-data-YYYY-MM-DD.json`으로 그날 처음 저장하기 직전 상태를 남기고, 최근 7일치를 보관합니다.
- 파일이 깨지면 `.bak` → 최근 날짜별 백업 순서로 자동 복구합니다(깨진 파일은 `.broken-<시각>`으로 보관).
- 실수로 지운 일정은 날짜별 백업 파일을 `calendar-data.json`으로 바꿔 넣으면(앱을 완전히 끈 상태에서) 되살릴 수 있습니다.

## 구조

```
src-tauri/                 Rust 앱 (Tauri 2)
  core/                    화면과 상관없는 로직. 단위 테스트는 core/tests/ — npm test
    src/dates.rs           날짜 유틸(시간대 영향 없는 문자열 날짜)
    src/lunar.rs           음력↔양력 (표는 lunar_data.rs, 1000~2050년)
    src/holidays.rs        한국 공휴일 계산
    src/recurrence.rs      반복 일정 전개, 반복 설명 문구
    src/events.rs          일정·메모 추가/수정/삭제/되살리기, 메모 순서
    src/search.rs          일정 검색
    src/notifier.rs        알림 시각 계산
    src/store.rs           JSON 저장소(.bak, 날짜별 백업, 자동 복구)
    src/model.rs, js.rs    저장 파일 모양, 화면에서 온 값 읽기
  src/main.rs              시작, 알림 확인·자정 넘김 감지
  src/window.rs            창(테두리 없음, 크기 기억, 트레이로 닫을 때 화면 엔진 닫기)
  src/tray.rs              트레이 메뉴
  src/notify.rs            Windows 알림(누르면 그 날짜로 이동)
  src/updater.rs           자동 업데이트(GitHub Releases의 latest.json)
  src/commands.rs          화면이 부르는 명령
  windows/hooks.nsh        설치 프로그램: 바로가기·프로그램 목록 이름을 '데스크 캘린더'로
  tauri.conf.json          앱·설치 파일·업데이트 설정 (개발 모드는 tauri.dev.conf.json을 덧씀)
renderer/                  화면 (index.html, styles.css, 글꼴: IBM Plex Sans KR)
renderer/js/               화면 스크립트 — 기능별 파일. index.html의 <script> 순서대로 실행되며 전역을 함께 씀
  tauri-api.js             화면이 쓰는 window.api(Rust 명령 연결), 창 끌기
  core.js                  공통 유틸·상태·토스트
  calendar.js              달력 칸, 머리 줄의 '오늘' 버튼
  day.js                   선택한 날짜의 일정 목록, 끝난 일정 흐리게
  memos.js                 메모(완료, 끌어서 순서 바꾸기)
  event-dialog.js          일정 창, 닫기 전 확인
  settings.js              설정 창, 업데이트 상태
  search.js                검색 창
  navigation.js            날짜 이동, 단축키, ⋯ 메뉴
  window-chrome.js         창 버튼 띠, 직접 그리는 스크롤바, 위아래 페이드
  init.js                  시작
scripts/release-files.mjs  릴리스에 올릴 설치 파일 이름 정리, latest.json 만들기
assets/icon.png            앱 아이콘 원본 (바꾸면 npm run tauri -- icon assets/icon.png -o src-tauri/icons)
```

## 화면 디자인 규칙

새 화면 요소를 추가할 때 맞춰 주세요. 값은 `renderer/styles.css` 맨 위 `:root`에 모여 있습니다.

- **여백**: 4·8·12·16px만 씁니다. 카드와 다이얼로그 안의 글자·버튼은 모두 끝에서 `--card-px`(16px) 떨어진 세로선에 맞춥니다. 목록 줄은 `--row-inset`만큼 안쪽에서 호버 배경을 칠하고, 글자는 같은 세로선에 둡니다.
- **제목**: 카드·다이얼로그 제목은 `--title-size`. 설정 항목 이름은 검정 14px(+ 회색 12px 설명), 입력칸 위 라벨은 회색 13px.
- **그림자**: 화면에 놓인 카드는 `--shadow-sheet`, 그 위에 떠 있는 것(다이얼로그·메뉴·토스트·끄는 메모)은 `--shadow-float`.
- **모서리**: 버튼·입력칸·목록 줄은 `--radius-s`, 카드·다이얼로그·메뉴·토스트는 `--radius-m`, 작은 버튼·태그는 `.pill`(완전히 둥근 알약).
- **닫기**: ✕는 항상 다이얼로그 오른쪽 위. 아래 버튼은 저장·삭제처럼 실제 동작만 둡니다(작은 확인 창은 버튼이 곧 선택지).
- **체크박스**: 앱 전체가 같은 동그라미 모양(체크하면 진하게 채우고 체크 표시)입니다.
- 창 둘레에 Windows 11이 그리는 1px 테두리는 `src-tauri/src/window.rs`에서 바탕색(`--paper`와 같은 값)으로 칠해 보이지 않게 합니다. 바탕색을 바꾸면 두 곳을 함께 고치세요.

## 공휴일 규칙 메모

- 설·추석 연휴: 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일이 대체공휴일 (토요일은 해당 없음)
- 삼일절·노동절·어린이날·부처님 오신 날·제헌절·광복절·개천절·한글날·성탄절: 토·일 또는 다른 공휴일과 겹치면 다음 첫 평일
- 신정·현충일: 대체공휴일 없음
- 음력 표(`src-tauri/core/src/lunar_data.rs`, korean-lunar-calendar에서 옮김)가 2050년까지 지원합니다.
- 법이 바뀌면 `src-tauri/core/src/holidays.rs`의 `FIXED`, 정부 지정 임시공휴일은 `SPECIAL` 목록을 고치면 됩니다.
