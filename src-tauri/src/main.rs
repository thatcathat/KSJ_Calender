// 릴리스 빌드에서 콘솔 창이 같이 뜨지 않게
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod notify;
mod state;
mod tray;
mod updater;
mod window;

use calendar_core::dates::{now_floating, today_str, MIN};
use calendar_core::notifier::Notifier;
use calendar_core::store::Store;
use state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// 개발용 실행(`npm run tauri:dev`, 디버그 빌드)이면 데이터 폴더를 따로 써서,
/// 설치된 앱의 일정을 건드리지 않고 나란히 띄울 수 있게 한다.
pub const DEV: bool = cfg!(debug_assertions);

/// 알림 확인 간격과, 앱이 꺼져 있던(또는 절전 중이던) 동안 놓친 알림을 몇 분 전 것까지 울릴지
const TICK: Duration = Duration::from_secs(20);
const MISSED_GRACE_MS: i64 = 5 * MIN;

fn main() {
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        // 하나만 실행: 두 번째로 실행하면 이미 떠 있는 창을 보여 준다. 가장 먼저 등록해야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show(app, None)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::range,
            commands::holidays,
            commands::lunar,
            commands::search,
            commands::event_get,
            commands::event_create,
            commands::event_update,
            commands::event_delete,
            commands::event_restore,
            commands::memo_list,
            commands::memo_save,
            commands::memo_delete,
            commands::memo_reorder,
            commands::settings_get,
            commands::settings_set,
            commands::data_open_folder,
            commands::update_status,
            commands::update_check,
            commands::update_install,
            commands::win_minimize,
            commands::win_toggle_maximize,
            commands::win_close,
            commands::win_is_maximized,
            commands::win_watch_pointer,
            commands::win_start_drag,
            commands::win_release,
            commands::screen_ready,
        ])
        .setup(move |app| {
            // 예전 앱과 같은 폴더: %APPDATA%\DeskCalendar
            let dir = app.path().data_dir()?.join(if DEV { "DeskCalendar-dev" } else { "DeskCalendar" });
            app.manage(AppState::new(Store::open(dir)?));
            app.manage(updater::Updater::default());
            // 로그인 때 트레이로 시작하면 창(과 화면 엔진)은 처음 열 때 만든다
            if !start_hidden {
                window::create(app.handle())?;
            }
            tray::create(app.handle())?;
            commands::apply_login_item(app.handle());
            start_background(app.handle().clone());
            updater::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("앱을 시작하지 못했어요");

    app.run(|app, event| match event {
        // 트레이로 닫느라 마지막 창이 없어진 것이면 앱은 계속 돈다(트레이 '종료'는 code가 있음)
        RunEvent::ExitRequested { code: None, api, .. } if !app.state::<AppState>().is_quitting() => api.prevent_exit(),
        RunEvent::Exit => {
            let state = app.state::<AppState>();
            state.quit_requested();
            state.save();
        }
        _ => {}
    });
}

/// 알림 확인과 자정 넘김 감지. 창이 숨어 있어도 계속 돈다.
fn start_background(app: AppHandle) {
    std::thread::spawn(move || {
        let mut notifier = Notifier::new(now_floating(), MISSED_GRACE_MS);
        let mut last_day = today_str();
        loop {
            let alerts = {
                let state = app.state::<AppState>();
                let store = state.store();
                notifier.tick(now_floating(), &store.data.events)
            };
            for alert in alerts {
                notify::alert(&app, alert);
            }
            // 자정이 지나면 화면의 '오늘'을 갱신
            let today = today_str();
            if today != last_day {
                last_day = today;
                let _ = app.emit("day-changed", ());
            }
            std::thread::sleep(TICK);
        }
    });
}
