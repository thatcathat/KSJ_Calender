//! 트레이 아이콘과 메뉴. 창을 닫아도 트레이에 남아 알림을 계속 울린다.

use crate::state::AppState;
use crate::window;
use crate::DEV;
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "열기", true, None::<&str>)?,
            &MenuItem::with_id(app, "today", "오늘 보기", true, None::<&str>)?,
            &MenuItem::with_id(app, "new", "새 일정", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?,
        ],
    )?;
    let icon = app.default_window_icon().cloned().expect("tauri.conf.json의 bundle.icon");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(if DEV {
            "데스크 캘린더 (개발)"
        } else {
            "데스크 캘린더"
        })
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => window::show(app, None),
            "today" => window::show(app, Some(("navigate", Value::Null))),
            "new" => window::show(app, Some(("new-event", Value::Null))),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::show(tray.app_handle(), None);
            }
        })
        .build(app)?;
    Ok(())
}

fn quit(app: &AppHandle) {
    app.state::<AppState>().quit_requested();
    app.exit(0);
}
