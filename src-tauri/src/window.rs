//! 메인 창: 테두리 없는 창, 크기·위치 기억, 밝은/어두운 바탕색, 트레이로 숨기기
//!
//! 트레이로 닫으면 창을 숨기는 데 그치지 않고 화면 엔진(WebView2)까지 닫는다. 화면 엔진이 메모리를
//! 거의 다(약 180MB) 쓰는데, 알림·저장·트레이는 Rust 쪽에서 돌아가므로 숨어 있는 동안엔 필요 없다.
//! 다시 열 때 새로 만든다. 순서:
//!   1. 닫기 → 창을 바로 숨기고 화면에 'close-to-tray'를 보낸다
//!   2. 화면이 쓰던 메모 등을 마저 저장하고 win_release를 부른다
//!      (열린 대화상자가 있으면 keep=true: 쓰던 일정이 사라지지 않게 예전처럼 숨기기만 한다)
//!   3. 화면이 응답하지 않으면 RELEASE_TIMEOUT 뒤에 그냥 닫는다

use crate::notify;
use crate::state::AppState;
use calendar_core::model::Bounds;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const MAIN: &str = "main";
const DEFAULT_SIZE: (f64, f64) = (350.0, 630.0);
/// 기본 크기가 바뀌면 올린다. 예전에 저장된 창 크기는 한 번 무시한다.
const WINDOW_LAYOUT: i64 = 2;
/// 트레이로 닫은 뒤 화면의 저장 완료 응답을 기다리는 최대 시간
const RELEASE_TIMEOUT: Duration = Duration::from_secs(3);

/// 창 바탕색 (styles.css의 --paper와 같은 값)
fn paper(dark: bool) -> Color {
    if dark {
        Color(0x12, 0x16, 0x1f, 0xff)
    } else {
        Color(0xf3, 0xf5, 0xf8, 0xff)
    }
}

/// 되살릴 창 자리: 위치(화면 밖이면 None), 너비, 높이
type Restored = (Option<(f64, f64)>, f64, f64);

/// 저장된 창 위치가 지금 모니터 구성에서 보이는지. 안 보이면 크기만 쓴다.
fn restore_bounds(app: &AppHandle, saved: Option<Bounds>) -> Option<Restored> {
    let b = saved?;
    let (x, y, w, h) = (f64::from(b.x), f64::from(b.y), f64::from(b.width), f64::from(b.height));
    // 모니터가 바뀌어 화면 밖에 뜨는 걸 방지 (예전 앱과 같은 기준)
    let visible = app.available_monitors().unwrap_or_default().iter().any(|m| {
        let s = m.scale_factor();
        let area = m.work_area();
        let (ax, ay) = (f64::from(area.position.x) / s, f64::from(area.position.y) / s);
        let (aw, ah) = (f64::from(area.size.width) / s, f64::from(area.size.height) / s);
        x < ax + aw - 80.0 && x + w > ax + 80.0 && y >= ay - 20.0 && y < ay + ah - 80.0
    });
    Some((visible.then_some((x, y)), w, h))
}

/// 창을 만들고, 화면을 다 불러오면 보인다
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    state.screen().ready = false;
    state.maximized.store(false, Ordering::SeqCst);
    let saved = {
        let mut store = state.store();
        let s = &mut store.data.settings;
        if s.window_layout() != WINDOW_LAYOUT {
            s.set("windowBounds", Value::Null);
            s.set("windowLayout", json!(WINDOW_LAYOUT));
        }
        s.window_bounds()
    };

    let shown_once = Arc::new(AtomicBool::new(false));
    let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("데스크 캘린더")
        .min_inner_size(320.0, 480.0)
        .decorations(false) // 기본 제목 표시줄·테두리 제거 (가장자리 크기 조절과 창 스냅은 유지)
        .visible(false)
        .background_color(paper(false))
        // 날짜·시간 입력칸을 한국어(오전/오후) 형식으로. 앞의 값은 wry 기본값이라 함께 넘겨야 한다.
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --lang=ko")
        .on_page_load(move |w, p| match p.event() {
            // 새로고침하면 화면이 다시 준비될 때까지 이벤트를 모아 둔다
            PageLoadEvent::Started => w.state::<AppState>().screen().ready = false,
            // 처음 한 번만 보인다(새로고침 때 숨긴 창이 다시 뜨지 않게)
            PageLoadEvent::Finished => {
                if !shown_once.swap(true, Ordering::SeqCst) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    builder = match restore_bounds(app, saved) {
        Some((Some((x, y)), w, h)) => builder.inner_size(w, h).position(x, y),
        Some((None, w, h)) => builder.inner_size(w, h).center(),
        None => builder.inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1).center(),
    };
    let win = builder.build()?;

    apply_theme(&win, win.theme().map(|t| t == Theme::Dark).unwrap_or(false));
    let w = win.clone();
    win.on_window_event(move |e| on_event(&w, e));
    Ok(())
}

fn on_event(win: &WebviewWindow, event: &WindowEvent) {
    let app = win.app_handle();
    let state = app.state::<AppState>();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            state.save();
            let to_tray = state.store().data.settings.close_to_tray();
            if state.is_quitting() || !to_tray {
                state.quit_requested(); // 트레이로 숨기기를 껐으면 창을 닫을 때 앱도 끈다
                return;
            }
            api.prevent_close();
            let _ = win.hide();
            let first_time = !state.store().data.settings.tray_hint_shown();
            if first_time {
                notify::show(
                    app,
                    "데스크 캘린더가 트레이에서 실행 중이에요",
                    "알림을 계속 받을 수 있어요. 완전히 끄려면 트레이 아이콘에서 \"종료\"를 누르세요.",
                    None,
                );
                let _ = state.mutate(|d| {
                    d.settings.set("trayHintShown", json!(true));
                    Ok(())
                });
            }
            // 화면에 저장을 마치고 알려 달라고 한다. 응답이 없으면 잠시 뒤 그냥 화면 엔진을 닫는다.
            let id = state.close_gen.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit("close-to-tray", ());
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(RELEASE_TIMEOUT);
                if app.state::<AppState>().close_gen.load(Ordering::SeqCst) == id {
                    release(&app, false);
                }
            });
        }
        WindowEvent::Destroyed => state.screen().ready = false,
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            remember_bounds(win, &state);
            // 최대화 상태를 화면에 알려 버튼 모양(최대화/이전 크기로)을 바꾼다
            let max = win.is_maximized().unwrap_or(false);
            if state.maximized.swap(max, Ordering::SeqCst) != max {
                let _ = app.emit("win-state", json!({ "maximized": max }));
            }
        }
        // 밝은/어두운 모드가 바뀌면 바탕색과 테두리 색도 따라간다
        WindowEvent::ThemeChanged(theme) => apply_theme(win, *theme == Theme::Dark),
        _ => {}
    }
}

/// 창 위치·크기를 설정에 적어 둔다(파일 저장은 다음 저장 때). 최소화·최대화 중에는 그대로 둔다.
fn remember_bounds(win: &WebviewWindow, state: &AppState) {
    if win.is_minimized().unwrap_or(true) || win.is_maximized().unwrap_or(true) {
        return;
    }
    let Ok(scale) = win.scale_factor() else { return };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else {
        return;
    };
    let (pos, size) = (pos.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
    // 정수로 저장한다(예전 앱과 같은 모양)
    let r = |v: f64| v.round() as i64;
    let bounds = json!({ "x": r(pos.x), "y": r(pos.y), "width": r(size.width), "height": r(size.height) });
    state.store().data.settings.set("windowBounds", bounds);
}

fn apply_theme(win: &WebviewWindow, dark: bool) {
    let color = paper(dark);
    let _ = win.set_background_color(Some(color));
    #[cfg(windows)]
    set_border_color(win, color);
}

/// Windows 11이 창 둘레에 그리는 1px 테두리를 바탕색으로 칠해 보이지 않게 한다
#[cfg(windows)]
fn set_border_color(win: &WebviewWindow, Color(r, g, b, _): Color) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    let Ok(hwnd) = win.hwnd() else { return };
    let colorref: u32 = u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16;
    // SAFETY: 살아 있는 창의 핸들과 4바이트 COLORREF를 넘긴다
    unsafe {
        DwmSetWindowAttribute(hwnd.0 as _, DWMWA_BORDER_COLOR as u32, (&colorref as *const u32).cast(), 4);
    }
}

/// 화면이 저장을 마쳤다고 알려 왔을 때(또는 기다리다 지쳤을 때) 화면 엔진을 닫는다.
/// `keep`이면 닫지 않고 숨긴 채 둔다. 그사이 창을 다시 열었으면 아무것도 안 한다.
pub fn release(app: &AppHandle, keep: bool) {
    let state = app.state::<AppState>();
    state.close_gen.fetch_add(1, Ordering::SeqCst); // 기다리던 작업 취소
    if keep {
        return;
    }
    let Some(win) = app.get_webview_window(MAIN) else { return };
    if !win.is_visible().unwrap_or(true) {
        let _ = win.destroy();
    }
}

/// 창을 보이고 앞으로 가져온다. 화면 엔진을 닫아 두었으면 새로 만든다.
/// `send`가 있으면 화면이 준비된 뒤 그 이벤트를 보낸다.
pub fn show(app: &AppHandle, send: Option<(&str, Value)>) {
    let state = app.state::<AppState>();
    state.close_gen.fetch_add(1, Ordering::SeqCst); // 닫던 중이었으면 취소
    if let Some((event, payload)) = send {
        send_to_screen(app, event, payload);
    }
    match app.get_webview_window(MAIN) {
        Some(win) => {
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            let _ = win.show();
            let _ = win.set_focus();
        }
        None => {
            if state.creating.swap(true, Ordering::SeqCst) {
                return; // 이미 만드는 중
            }
            // Windows에서는 이벤트 처리 중에 창을 만들면 멈출 수 있어 따로 스레드에서 만든다
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(err) = create(&app) {
                    eprintln!("창을 만들지 못했어요: {err}");
                }
                app.state::<AppState>().creating.store(false, Ordering::SeqCst);
            });
        }
    }
}

/// 화면이 준비됐으면 바로 보내고, 아니면 준비될 때까지 모아 둔다
pub fn send_to_screen(app: &AppHandle, event: &str, payload: Value) {
    let state = app.state::<AppState>();
    let mut screen = state.screen();
    if screen.ready {
        let _ = app.emit(event, payload);
    } else {
        screen.pending.push((event.to_string(), payload));
    }
}

/// 화면이 이벤트를 받을 준비를 마쳤다(tauri-api.js가 부름). 모아 둔 이벤트를 보낸다.
pub fn screen_ready(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut screen = state.screen();
    screen.ready = true;
    for (event, payload) in screen.pending.drain(..) {
        let _ = app.emit(&event, payload);
    }
}

/// 마우스가 창 밖으로 나갈 때까지 커서 위치를 확인하다가 화면에 'pointer-out'을 보낸다.
/// (위쪽 띠를 접을 때 쓴다)
pub fn watch_pointer(app: &AppHandle) {
    let state = app.state::<AppState>();
    let id = state.pointer_watch.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || loop {
        if app.state::<AppState>().pointer_watch.load(Ordering::SeqCst) != id {
            return; // 새로 시작된 확인이 이어받음
        }
        if !pointer_inside(&app) {
            let _ = app.emit("pointer-out", ());
            return;
        }
        std::thread::sleep(Duration::from_millis(120));
    });
}

fn pointer_inside(app: &AppHandle) -> bool {
    let Some(win) = app.get_webview_window(MAIN) else { return false };
    if !win.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(p), Ok(pos), Ok(size)) = (app.cursor_position(), win.outer_position(), win.outer_size()) else {
        return false;
    };
    let (x0, y0) = (f64::from(pos.x), f64::from(pos.y));
    p.x >= x0 && p.x < x0 + f64::from(size.width) && p.y >= y0 && p.y < y0 + f64::from(size.height)
}
