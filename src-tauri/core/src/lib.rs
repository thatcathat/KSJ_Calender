//! 데스크 캘린더의 화면과 상관없는 로직.
//! 창·트레이·알림 띄우기 같은 앱 부분은 상위 크레이트(src-tauri/src)에 있다.

pub mod dates;
pub mod events;
pub mod holidays;
pub mod js;
pub mod lunar;
mod lunar_data;
pub mod model;
pub mod notifier;
pub mod recurrence;
pub mod search;
pub mod store;
