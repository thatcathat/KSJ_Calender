use calendar_core::model::Data;
use calendar_core::store::Store;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

pub struct AppState {
    store: Mutex<Store>,
    /// 트레이에서 '종료'를 눌러 끄는 중 (창 닫기를 트레이로 숨기기로 바꾸지 않음)
    quitting: AtomicBool,
    /// 마우스가 창 밖으로 나갔는지 지켜보는 작업의 번호. 새로 시작하면 이전 것은 멈춘다.
    pub pointer_watch: AtomicU64,
    /// 마지막으로 화면에 알린 최대화 상태
    pub maximized: AtomicBool,
    /// 창을 새로 만드는 중 (트레이를 여러 번 눌러도 하나만 만들게)
    pub creating: AtomicBool,
    /// 트레이로 닫은 뒤 화면 엔진을 닫는 작업의 번호. 그사이 다시 열거나 또 닫으면 바뀐다.
    pub close_gen: AtomicU64,
    /// 화면이 이벤트를 받을 준비가 됐는지와, 그 전에 보낸 이벤트(예: 알림을 눌러 그 날짜로 이동)
    pub screen: Mutex<Screen>,
}

#[derive(Default)]
pub struct Screen {
    pub ready: bool,
    pub pending: Vec<(String, Value)>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
            quitting: AtomicBool::new(false),
            pointer_watch: AtomicU64::new(0),
            maximized: AtomicBool::new(false),
            creating: AtomicBool::new(false),
            close_gen: AtomicU64::new(0),
            screen: Mutex::new(Screen::default()),
        }
    }

    pub fn screen(&self) -> MutexGuard<'_, Screen> {
        self.screen.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 저장소 잠금. 다른 스레드가 잠근 채 패닉했어도 데이터는 계속 쓴다.
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 데이터를 바꾸고 저장. `f`가 실패하면 저장하지 않는다.
    pub fn mutate<T>(&self, f: impl FnOnce(&mut Data) -> Result<T, String>) -> Result<T, String> {
        let mut store = self.store();
        let result = f(&mut store.data)?;
        store.save().map_err(|e| format!("저장하지 못했어요: {e}"))?;
        Ok(result)
    }

    pub fn save(&self) {
        if let Err(err) = self.store().save() {
            eprintln!("저장 실패: {err}");
        }
    }

    pub fn quit_requested(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
}
