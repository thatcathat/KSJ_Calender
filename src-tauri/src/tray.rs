//! 트레이 아이콘과 메뉴. 창을 닫아도 트레이에 남아 알림을 계속 울린다.

use crate::state::AppState;
use crate::{updater, window, DEV};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const ID: &str = "main";

/// 새 버전을 받아 두었으면 '재시작해서 업데이트' 항목을 넣는다
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "열기", true, None::<&str>)?,
            &MenuItem::with_id(app, "today", "오늘 보기", true, None::<&str>)?,
            &MenuItem::with_id(app, "new", "새 일정", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
        ],
    )?;
    if let Some(version) = updater::ready_version(app) {
        menu.append(&MenuItem::with_id(
            app,
            "update",
            format!("재시작해서 업데이트 ({version})"),
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?)?;
    Ok(menu)
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned().expect("tauri.conf.json의 bundle.icon");
    TrayIconBuilder::with_id(ID)
        .icon(icon)
        .tooltip(if DEV {
            "데스크 캘린더 (개발)"
        } else {
            "데스크 캘린더"
        })
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => window::show(app, None),
            "today" => window::show(app, Some(("navigate", Value::Null))),
            "new" => window::show(app, Some(("new-event", Value::Null))),
            "update" => {
                updater::install(app, true);
            }
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

/// 메뉴를 다시 만든다 (업데이트를 받아 둔 뒤)
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// 종료. 받아 둔 새 버전이 있으면 설치하고 끝낸다(다시 띄우지는 않음).
fn quit(app: &AppHandle) {
    app.state::<AppState>().quit_requested();
    if !updater::install(app, false) {
        app.exit(0);
    }
}
