//! Windows 토스트 알림. 알림을 누르면 앱 창을 열고 그 날짜로 이동한다.
//!
//! Windows 토스트는 AppUserModelID가 달린 시작 메뉴 바로가기가 있어야 앱 이름으로 뜬다.
//! 설치 프로그램이 만든 바로가기는 tauri.conf.json의 identifier를 쓰므로 같은 값을 쓴다.
//! 개발용 실행(target 폴더의 exe)은 바로가기가 없어 PowerShell 이름을 빌려 띄운다.

use crate::window;
use calendar_core::notifier::Alert;
use serde_json::json;
use tauri::AppHandle;

pub fn alert(app: &AppHandle, alert: Alert) {
    let handle = app.clone();
    let date = alert.date.clone();
    show(
        app,
        &alert.title,
        &alert.body,
        Some(Box::new(move || window::show(&handle, Some(("navigate", json!(date)))))),
    );
}

#[cfg(windows)]
pub fn show(app: &AppHandle, title: &str, body: &str, on_click: Option<Box<dyn Fn() + Send + Sync>>) {
    use tauri_winrt_notification::{Sound, Toast};

    let mut lines = body.splitn(2, '\n');
    let mut toast = Toast::new(&app_id(app))
        .title(title)
        .text1(lines.next().unwrap_or_default())
        .text2(lines.next().unwrap_or_default())
        .sound(Some(Sound::Default));
    if let Some(on_click) = on_click {
        toast = toast.on_activated(move |_| {
            on_click();
            Ok(())
        });
    }
    if let Err(err) = toast.show() {
        eprintln!("알림을 띄우지 못했어요: {err}");
    }
}

#[cfg(not(windows))]
pub fn show(_app: &AppHandle, title: &str, body: &str, _on_click: Option<Box<dyn Fn() + Send + Sync>>) {
    eprintln!("알림: {title} — {body}");
}

#[cfg(windows)]
fn app_id(app: &AppHandle) -> String {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_lowercase()));
    let from_target = exe_dir.is_some_and(|d| d.ends_with("\\target\\debug") || d.ends_with("\\target\\release"));
    if from_target {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    }
}
