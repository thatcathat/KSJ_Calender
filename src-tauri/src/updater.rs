//! 자동 업데이트: GitHub Releases의 latest.json을 보고 새 버전이 있으면 백그라운드로 받아 두고,
//! '재시작해서 업데이트'를 누르거나 트레이에서 종료할 때 설치한다. 설치형에서만 동작한다.
//! 상태 값(state)은 화면의 설정 창(renderer/js/settings.js)이 그대로 보여 준다.

use crate::state::AppState;
use crate::{notify, tray, DEV};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10); // 시작 직후는 피해서 잠시 뒤 확인
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

/// 'unsupported' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: &'static str,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Updater {
    status: Mutex<Option<Status>>,
    /// 받아 둔 새 버전 설치 파일
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

/// 설치 프로그램으로 설치한 앱인지 (설치 폴더에 uninstall.exe가 있다). 개발용 실행은 제외.
pub fn supported() -> bool {
    !DEV && std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

fn updater(app: &AppHandle) -> &Updater {
    app.state::<Updater>().inner()
}

pub fn status(app: &AppHandle) -> Status {
    let mut s = updater(app).status.lock().unwrap_or_else(|e| e.into_inner());
    s.get_or_insert_with(|| Status {
        state: if supported() { "idle" } else { "unsupported" },
        version: app.package_info().version.to_string(),
        new_version: None,
        percent: None,
        error: None,
    })
    .clone()
}

/// 상태를 바꾸고 화면에 알린다
fn set(app: &AppHandle, f: impl FnOnce(&mut Status)) -> Status {
    let mut next = status(app);
    f(&mut next);
    *updater(app).status.lock().unwrap_or_else(|e| e.into_inner()) = Some(next.clone());
    let _ = app.emit("update-status", &next);
    next
}

/// 시작 10초 뒤와 6시간마다 확인
pub fn start(app: AppHandle) {
    if !supported() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_DELAY);
        loop {
            tauri::async_runtime::block_on(check(&app));
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

/// 새 버전이 있는지 보고, 있으면 받아 둔다
pub async fn check(app: &AppHandle) -> Status {
    let now = status(app);
    if !supported() || matches!(now.state, "checking" | "downloading" | "ready") {
        return now;
    }
    set(app, |s| {
        s.state = "checking";
        s.error = None;
    });
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    let update = match found {
        Ok(Some(update)) => update,
        Ok(None) => return set(app, |s| s.state = "latest"),
        Err(err) => return fail(app, err),
    };

    let new_version = update.version.clone();
    set(app, |s| {
        s.state = "downloading";
        s.new_version = Some(new_version.clone());
        s.percent = Some(0);
    });
    let (mut got, mut last_percent) = (0u64, 0u32);
    let bytes = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                let percent = total.filter(|t| *t > 0).map_or(0, |t| (got * 100 / t).min(100) as u32);
                if percent != last_percent {
                    last_percent = percent;
                    set(app, |s| s.percent = Some(percent));
                }
            },
            || {},
        )
        .await;
    match bytes {
        Ok(bytes) => {
            *updater(app).ready.lock().unwrap_or_else(|e| e.into_inner()) = Some((update, bytes));
            let st = set(app, |s| {
                s.state = "ready";
                s.percent = Some(100);
            });
            tray::refresh(app);
            let handle = app.clone();
            notify::show(
                app,
                &format!("새 버전 {new_version}을 설치할 준비가 됐어요"),
                "클릭하면 재시작해서 업데이트해요. 그냥 두면 다음에 트레이에서 종료할 때 설치돼요.",
                Some(Box::new(move || {
                    install(&handle, true);
                })),
            );
            st
        }
        Err(err) => fail(app, err),
    }
}

fn fail(app: &AppHandle, err: tauri_plugin_updater::Error) -> Status {
    eprintln!("업데이트 실패: {err}");
    set(app, |s| {
        s.state = "error";
        s.error = Some(err.to_string());
    })
}

/// 받아 둔 새 버전 (트레이 메뉴에 표시)
pub fn ready_version(app: &AppHandle) -> Option<String> {
    updater(app)
        .ready
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|(u, _)| u.version.clone())
}

/// 받아 둔 새 버전을 설치한다. 설치 프로그램을 띄우고 앱은 바로 끝난다.
/// `restart`: 설치 뒤 앱을 다시 띄울지 (트레이 '종료'로 설치할 때는 띄우지 않는다)
/// 받아 둔 게 없으면 false
pub fn install(app: &AppHandle, restart: bool) -> bool {
    let Some((update, bytes)) = updater(app).ready.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return false;
    };
    // 설치하면 프로세스가 바로 끝나서 평소의 종료 처리(저장)를 거치지 않는다
    let state = app.state::<AppState>();
    state.quit_requested();
    state.save();
    if let Err(err) = update.restart_after_install(restart).install(bytes) {
        eprintln!("업데이트 설치 실패: {err}");
        fail(app, err);
        return false;
    }
    true
}
