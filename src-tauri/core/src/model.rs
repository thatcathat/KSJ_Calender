//! 저장 파일(calendar-data.json)의 모양. 예전 JS 앱과 같은 JSON을 읽고 쓴다.
//!
//! 읽을 때는 너그럽게: 필드가 없거나 타입이 달라도 기본값으로 채우고, 모르는 필드는 `extra`에 담아
//! 다시 저장할 때 그대로 남긴다. 한 필드가 이상하다고 파일 전체를 '깨진 파일'로 보면 안 되기 때문.

use crate::holidays::CustomHoliday;
use crate::js::{self, as_str, field, rest, to_int, to_string};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Freq {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "daily" => Self::Daily,
            "weekly" => Self::Weekly,
            "monthly" => Self::Monthly,
            "yearly" => Self::Yearly,
            _ => return None,
        })
    }
}

/// 매월 반복 방식: 같은 날짜 / n번째 요일 / 마지막 요일
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MonthlyMode {
    Day,
    Nth,
    Last,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub freq: Freq,
    pub interval: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byweekday: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_mode: Option<MonthlyMode>,
    /// 0은 예전 JS처럼 '횟수 제한 없음'으로 본다
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
}

impl Recurrence {
    /// 저장된 반복 정보 읽기. freq를 모르면 반복 없음으로 본다.
    pub fn from_value(v: &Value) -> Option<Self> {
        let freq = Freq::parse(as_str(field(v, "freq"))?)?;
        Some(Self {
            freq,
            interval: js::parse_int(field(v, "interval")).filter(|n| *n >= 1).unwrap_or(1),
            byweekday: field(v, "byweekday").and_then(Value::as_array).map(|a| {
                a.iter()
                    .filter_map(|d| to_int(Some(d)))
                    .filter(|d| (0..=6).contains(d))
                    .map(|d| d as u32)
                    .collect()
            }),
            monthly_mode: as_str(field(v, "monthlyMode")).map(|m| match m {
                "nth" => MonthlyMode::Nth,
                "last" => MonthlyMode::Last,
                _ => MonthlyMode::Day,
            }),
            count: js::parse_int(field(v, "count")),
            until: as_str(field(v, "until")).map(str::to_string),
        })
    }

    /// 횟수 제한 (0이나 없음은 제한 없음)
    pub fn count_limit(&self) -> Option<i64> {
        self.count.filter(|c| *c != 0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: Option<String>,
    pub color: String,
    pub location: String,
    pub memo: String,
    pub reminders: Vec<i64>,
    pub recurrence: Option<Recurrence>,
    pub exdates: Vec<String>,
    /// '이 일정만' 수정으로 반복에서 떨어져 나온 일정의 원래 반복 id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

const EVENT_KEYS: &[&str] = &[
    "id",
    "title",
    "start",
    "end",
    "color",
    "location",
    "memo",
    "reminders",
    "recurrence",
    "exdates",
    "seriesId",
    "createdAt",
    "updatedAt",
];

/// 숫자 배열 중 정수만
pub fn int_list(v: Option<&Value>) -> Vec<i64> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| to_int(Some(x))).collect())
        .unwrap_or_default()
}

impl Event {
    pub fn from_value(v: &Value) -> Self {
        let s = |k: &str| to_string(field(v, k));
        Self {
            id: s("id"),
            title: s("title"),
            start: s("start"),
            end: field(v, "end").filter(|e| !e.is_null()).map(|e| to_string(Some(e))),
            color: s("color"),
            location: s("location"),
            memo: s("memo"),
            reminders: int_list(field(v, "reminders")),
            recurrence: field(v, "recurrence").and_then(Recurrence::from_value),
            exdates: field(v, "exdates")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default(),
            series_id: as_str(field(v, "seriesId")).map(str::to_string),
            created_at: s("createdAt"),
            updated_at: s("updatedAt"),
            extra: rest(v, EVENT_KEYS),
        }
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("Event는 항상 JSON으로 바꿀 수 있음")
    }
}

impl<'de> Deserialize<'de> for Event {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self::from_value(&Value::deserialize(d)?))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Memo {
    pub fn from_value(v: &Value) -> Self {
        let s = |k: &str| to_string(field(v, k));
        Self {
            id: s("id"),
            text: s("text"),
            done: field(v, "done").and_then(Value::as_bool).unwrap_or(false),
            created_at: s("createdAt"),
            updated_at: s("updatedAt"),
            extra: rest(v, &["id", "text", "done", "createdAt", "updatedAt"]),
        }
    }
}

impl<'de> Deserialize<'de> for Memo {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self::from_value(&Value::deserialize(d)?))
    }
}

/// 창 위치·크기
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 설정. 화면이 보낸 값을 그대로 저장하고 그대로 돌려주는 예전 동작을 유지하려고 JSON 객체로 들고,
/// 뒷단이 쓰는 값만 읽기 함수를 둔다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Settings(pub Map<String, Value>);

/// 화면이 바꿀 수 있는 설정
pub const SETTINGS_ALLOWED: &[&str] = &[
    "closeToTray",
    "launchAtLogin",
    "weekStartsOn",
    "calendarMode",
    "defaultReminders",
    "showHolidays",
    "customHolidays",
];

impl Default for Settings {
    fn default() -> Self {
        let Value::Object(m) = json!({
            "closeToTray": true,
            "launchAtLogin": false,
            "weekStartsOn": 0,
            "calendarMode": "month",
            "defaultReminders": [10],
            "showHolidays": true,
            "customHolidays": [],
            "trayHintShown": false,
            "windowBounds": null,
            "windowLayout": 0,
        }) else {
            unreachable!()
        };
        Self(m)
    }
}

impl Settings {
    /// 기본값 위에 저장된 값을 덮는다 (JS `{ ...DEFAULT_SETTINGS, ...saved }`)
    pub fn from_value(v: Option<&Value>) -> Self {
        let mut s = Self::default();
        if let Some(Value::Object(saved)) = v {
            for (k, val) in saved {
                s.0.insert(k.clone(), val.clone());
            }
        }
        s
    }

    fn flag(&self, key: &str) -> bool {
        js::truthy(self.0.get(key))
    }

    pub fn close_to_tray(&self) -> bool {
        self.flag("closeToTray")
    }
    pub fn launch_at_login(&self) -> bool {
        self.flag("launchAtLogin")
    }
    pub fn show_holidays(&self) -> bool {
        self.flag("showHolidays")
    }
    pub fn tray_hint_shown(&self) -> bool {
        self.flag("trayHintShown")
    }

    pub fn custom_holidays(&self) -> Vec<CustomHoliday> {
        self.0
            .get("customHolidays")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|h| {
                        let date = as_str(field(h, "date"))?.to_string();
                        Some(CustomHoliday {
                            date,
                            name: to_string(field(h, "name")),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 저장된 창 위치·크기. 소수(예: 625.0)로 저장돼 있어도 반올림해서 읽는다.
    pub fn window_bounds(&self) -> Option<Bounds> {
        let b = self.0.get("windowBounds")?;
        let num = |k: &str| Some(js::to_number(field(b, k))).filter(|n| n.is_finite()).map(f64::round);
        let (x, y, w, h) = (num("x")?, num("y")?, num("width")?, num("height")?);
        (w > 0.0 && h > 0.0).then_some(Bounds {
            x: x as i32,
            y: y as i32,
            width: w as u32,
            height: h as u32,
        })
    }

    pub fn window_layout(&self) -> i64 {
        to_int(self.0.get("windowLayout")).unwrap_or(0)
    }

    pub fn set(&mut self, key: &str, value: Value) {
        self.0.insert(key.to_string(), value);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Data {
    pub version: Value,
    pub events: Vec<Event>,
    pub memos: Vec<Memo>,
    pub settings: Settings,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            version: json!(1),
            events: Vec::new(),
            memos: Vec::new(),
            settings: Settings::default(),
            extra: Map::new(),
        }
    }
}

impl Data {
    /// `events` 배열이 없으면 올바른 저장 파일이 아니다.
    pub fn from_value(v: &Value) -> Result<Self, String> {
        let events = field(v, "events").and_then(Value::as_array).ok_or("형식이 올바르지 않음")?;
        Ok(Self {
            version: field(v, "version").cloned().unwrap_or(json!(1)),
            events: events.iter().filter(|e| e.is_object()).map(Event::from_value).collect(),
            memos: field(v, "memos")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter(|m| m.is_object()).map(Memo::from_value).collect())
                .unwrap_or_default(),
            settings: Settings::from_value(field(v, "settings")),
            extra: rest(v, &["version", "events", "memos", "settings"]),
        })
    }
}
