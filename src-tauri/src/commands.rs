//! 화면(renderer)이 부르는 명령. renderer/js/tauri-api.js가 `window.api`로 감싼다.
//! 실패하면 오류 문구(String)가 화면의 Promise reject로 간다.

use crate::state::AppState;
use crate::{updater, window, DEV};
use calendar_core::dates::{parse, today_str};
use calendar_core::events;
use calendar_core::holidays::holiday_map;
use calendar_core::js;
use calendar_core::lunar::solar_to_lunar;
use calendar_core::model::SETTINGS_ALLOWED;
use calendar_core::recurrence::expand_all;
use calendar_core::search::search_events;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

type Res<T> = Result<T, String>;

fn to_values<T: serde::Serialize>(items: &[T]) -> Value {
    serde_json::to_value(items).unwrap_or(Value::Null)
}

// ── 달력 ─────────────────────────────────────────

#[tauri::command]
pub async fn range(state: State<'_, AppState>, start: Value, end: Value) -> Res<Vec<Value>> {
    let (s, e) = (parse(&js::to_string(Some(&start)))?, parse(&js::to_string(Some(&end)))?);
    let store = state.store();
    Ok(expand_all(&store.data.events, s, e).iter().map(|o| o.to_value()).collect())
}

#[tauri::command]
pub async fn holidays(state: State<'_, AppState>, from_year: Value, to_year: Value) -> Res<Value> {
    let settings = state.store().data.settings.clone();
    let (f, t) = (js::to_number(Some(&from_year)), js::to_number(Some(&to_year)));
    if !settings.show_holidays() || f.is_nan() || t.is_nan() {
        return Ok(json!({}));
    }
    let a = f.min(t).max(1900.0) as i32;
    let b = (f.max(t).min(2050.0) as i32).min(a + 5);
    Ok(json!(holiday_map(a, b, &settings.custom_holidays())))
}

#[tauri::command]
pub async fn lunar(date: String) -> Res<Value> {
    let p = |a: usize, b: usize| date.get(a..b).and_then(|s| s.parse::<u32>().ok());
    let (Some(y), Some(m), Some(d)) = (p(0, 4), p(5, 7), p(8, 10)) else {
        return Ok(Value::Null);
    };
    Ok(solar_to_lunar(y as i32, m, d).map_or(Value::Null, |l| json!({ "month": l.month, "day": l.day, "leap": l.leap })))
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: Value) -> Res<Value> {
    let store = state.store();
    Ok(search_events(&store.data.events, &js::to_string(Some(&query)), &today_str()).to_value())
}

// ── 일정 ─────────────────────────────────────────

#[tauri::command]
pub async fn event_get(state: State<'_, AppState>, id: String) -> Res<Value> {
    let store = state.store();
    Ok(store.data.events.iter().find(|e| e.id == id).map_or(Value::Null, |e| e.to_value()))
}

#[tauri::command]
pub async fn event_create(state: State<'_, AppState>, input: Value) -> Res<Value> {
    state.mutate(|d| events::create_event(d, &input)).map(|e| e.to_value())
}

#[tauri::command]
pub async fn event_update(state: State<'_, AppState>, id: String, opts: Value) -> Res<Value> {
    state.mutate(|d| events::update_event(d, &id, &opts)).map(|e| e.to_value())
}

#[tauri::command]
pub async fn event_delete(state: State<'_, AppState>, id: String, opts: Option<Value>) -> Res<()> {
    let opts = opts.unwrap_or(Value::Null);
    state.mutate(|d| events::delete_event(d, &id, &opts))
}

#[tauri::command]
pub async fn event_restore(state: State<'_, AppState>, snapshot: Value) -> Res<Value> {
    state.mutate(|d| events::restore_event(d, &snapshot)).map(|e| e.to_value())
}

// ── 메모 ─────────────────────────────────────────

#[tauri::command]
pub async fn memo_list(state: State<'_, AppState>) -> Res<Value> {
    Ok(to_values(&state.store().data.memos))
}

#[tauri::command]
pub async fn memo_save(state: State<'_, AppState>, memo: Value) -> Res<Value> {
    state.mutate(|d| Ok(events::save_memo(d, &memo))).map(|m| json!(m))
}

#[tauri::command]
pub async fn memo_delete(state: State<'_, AppState>, id: String) -> Res<()> {
    state.mutate(|d| {
        events::delete_memo(d, &id);
        Ok(())
    })
}

#[tauri::command]
pub async fn memo_reorder(state: State<'_, AppState>, ids: Value) -> Res<Value> {
    let ids: Vec<String> = ids
        .as_array()
        .map(|a| a.iter().map(|v| js::to_string(Some(v))).collect())
        .unwrap_or_default();
    state.mutate(|d| Ok(events::reorder_memos(d, &ids))).map(|m| to_values(&m))
}

// ── 설정 ─────────────────────────────────────────

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Res<Value> {
    Ok(json!(state.store().data.settings))
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, state: State<'_, AppState>, patch: Value) -> Res<Value> {
    let settings = state.mutate(|d| {
        if let Some(p) = patch.as_object() {
            for key in SETTINGS_ALLOWED {
                if let Some(v) = p.get(*key) {
                    d.settings.set(key, v.clone());
                }
            }
        }
        Ok(d.settings.clone())
    })?;
    if js::field(&patch, "launchAtLogin").is_some() {
        apply_login_item(&app);
    }
    Ok(json!(settings))
}

/// 로그인할 때 자동 실행(창 없이 트레이로). 개발용 실행에서는 등록하지 않는다.
pub fn apply_login_item(app: &AppHandle) {
    if DEV {
        return;
    }
    let enable = app.state::<AppState>().store().data.settings.launch_at_login();
    let launcher = app.autolaunch();
    let result = if enable { launcher.enable() } else { launcher.disable() };
    if let Err(err) = result {
        // 등록돼 있지 않은 걸 끄려 할 때도 실패로 오므로 기록만 한다
        eprintln!("자동 실행 설정 실패: {err}");
    }
}

#[tauri::command]
pub async fn data_open_folder(app: AppHandle, state: State<'_, AppState>) -> Res<()> {
    let dir = state.store().dir.to_string_lossy().into_owned();
    app.opener().open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

// ── 업데이트 (src/updater.rs) ─────────────────────

#[tauri::command]
pub async fn update_status(app: AppHandle) -> Res<updater::Status> {
    Ok(updater::status(&app))
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Res<updater::Status> {
    Ok(updater::check(&app).await)
}

/// 받아 둔 새 버전을 설치하고 다시 띄운다 (앱은 여기서 끝난다)
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Res<()> {
    updater::install(&app, true);
    Ok(())
}

// ── 창 ───────────────────────────────────────────

#[tauri::command]
pub fn win_minimize(window: WebviewWindow) -> Res<()> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn win_toggle_maximize(window: WebviewWindow) -> Res<bool> {
    let max = window.is_maximized().map_err(|e| e.to_string())?;
    if max { window.unmaximize() } else { window.maximize() }.map_err(|e| e.to_string())?;
    Ok(!max)
}

/// 트레이로 숨기기 설정이 그대로 적용된다
#[tauri::command]
pub fn win_close(window: WebviewWindow) -> Res<()> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn win_is_maximized(window: WebviewWindow) -> Res<bool> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn win_watch_pointer(app: AppHandle) {
    window::watch_pointer(&app);
}

/// 트레이로 닫은 뒤 화면이 저장을 마쳤다는 응답. `keep`이면 화면 엔진을 닫지 않는다(열린 대화상자가 있을 때).
#[tauri::command]
pub fn win_release(app: AppHandle, keep: bool) {
    window::release(&app, keep);
}

/// 화면이 이벤트를 받을 준비를 마쳤다
#[tauri::command]
pub fn screen_ready(app: AppHandle) {
    window::screen_ready(&app);
}

/// 달력 머리 줄·위쪽 띠를 잡고 창 옮기기
#[tauri::command]
pub fn win_start_drag(window: WebviewWindow) -> Res<()> {
    window.start_dragging().map_err(|e| e.to_string())
}
