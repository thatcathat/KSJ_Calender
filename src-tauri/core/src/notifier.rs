//! 알림 계산: 주기적으로 '지난 확인 시각 ~ 지금' 사이에 울려야 할 알림을 찾는다.
//! 실제로 알림을 띄우는 일은 앱(src-tauri/src)이 맡는다.

use crate::dates::{fmt_date, parts, DAY, HOUR, MIN};
use crate::model::Event;
use crate::recurrence::{expand_all, Occurrence};
use std::collections::HashMap;

const ALL_DAY_BASE_HOUR: i64 = 9; // 종일 일정 알림의 기준 시각(그날 오전 9시)
const MAX_LEAD: i64 = 7 * DAY; // 가장 긴 알림(1주 전)

/// 발생의 '기준 시각'(floating ms)
fn base_time(occ: &Occurrence) -> i64 {
    if occ.all_day {
        occ.start_ms + ALL_DAY_BASE_HOUR * HOUR
    } else {
        occ.start_ms
    }
}

pub struct Due {
    /// `${발생 id}@${분}` — 같은 알림을 두 번 울리지 않으려고 쓴다
    pub key: String,
    pub occ: Occurrence,
    pub minutes: i64,
    pub fire_at: i64,
}

/// (from_ms, to_ms] 사이에 울려야 하는 알림 목록. 시각은 floating ms.
pub fn due_reminders(events: &[Event], from_ms: i64, to_ms: i64) -> Vec<Due> {
    let with_reminders: Vec<Event> = events.iter().filter(|e| !e.reminders.is_empty()).cloned().collect();
    if with_reminders.is_empty() {
        return vec![];
    }
    // 이 구간에 알림이 울릴 수 있는 발생: 시작이 (from, to + 최대 선행시간] 근처
    let mut due = Vec::new();
    for occ in expand_all(&with_reminders, from_ms - DAY, to_ms + MAX_LEAD + DAY) {
        let base = base_time(&occ);
        for &m in &occ.event.reminders {
            let fire_at = base - m * MIN;
            if fire_at > from_ms && fire_at <= to_ms {
                due.push(Due {
                    key: format!("{}@{m}", occ.id()),
                    occ: occ.clone(),
                    minutes: m,
                    fire_at,
                });
            }
        }
    }
    due.sort_by_key(|d| d.fire_at);
    due
}

pub fn lead_text(minutes: i64, all_day: bool) -> String {
    if all_day {
        if minutes == 0 {
            return "오늘".into();
        }
        if minutes % 1440 == 0 {
            return if minutes == 1440 {
                "내일".into()
            } else {
                format!("{}일 후", minutes / 1440)
            };
        }
    }
    match minutes {
        0 => "지금 시작".into(),
        m if m < 60 => format!("{m}분 후 시작"),
        m if m % 1440 == 0 => format!("{}일 후 시작", m / 1440),
        m if m % 60 == 0 => format!("{}시간 후 시작", m / 60),
        m => format!("{}시간 {}분 후 시작", m / 60, m % 60),
    }
}

fn time_text(occ: &Occurrence) -> String {
    if occ.all_day {
        return "종일".into();
    }
    let (_, _, _, h, m, _) = parts(occ.start_ms);
    format!(
        "{} {}:{m:02}",
        if h < 12 { "오전" } else { "오후" },
        if h % 12 == 0 { 12 } else { h % 12 }
    )
}

/// 띄울 알림 한 건
#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    pub title: String,
    pub body: String,
    /// 누르면 이동할 날짜 `YYYY-MM-DD`
    pub date: String,
    pub event_id: String,
}

pub struct Notifier {
    grace: i64,
    /// key → fire_at
    fired: HashMap<String, i64>,
    /// 마지막으로 확인한 시각(floating ms)
    pub last: i64,
}

impl Notifier {
    /// 앱이 꺼져 있던 동안 지나간 알림은 최근 `grace_ms` 이내의 것만 울린다
    pub fn new(now_ms: i64, grace_ms: i64) -> Self {
        Self {
            grace: grace_ms,
            fired: HashMap::new(),
            last: now_ms - grace_ms,
        }
    }

    pub fn tick(&mut self, now_ms: i64, events: &[Event]) -> Vec<Alert> {
        // 시계를 과거로 돌렸으면 기준점만 맞춘다
        if now_ms < self.last {
            self.last = now_ms;
            return vec![];
        }
        // 절전·최대 절전에서 깨어나 확인 간격이 크게 벌어졌으면, 앱을 새로 켤 때처럼 최근 grace 이내의 것만 울린다
        let from = self.last.max(now_ms - self.grace);
        let mut alerts = Vec::new();
        for d in due_reminders(events, from, now_ms) {
            if self.fired.contains_key(&d.key) {
                continue;
            }
            self.fired.insert(d.key.clone(), d.fire_at);
            let occ = &d.occ;
            let mut body = format!("{} · {}", time_text(occ), lead_text(d.minutes, occ.all_day));
            if !occ.event.location.is_empty() {
                body.push('\n');
                body.push_str(&occ.event.location);
            }
            alerts.push(Alert {
                title: occ.event.title.clone(),
                body,
                date: fmt_date(occ.start_ms),
                event_id: occ.event.id.clone(),
            });
        }
        self.last = now_ms;
        // 오래된 기록 정리
        self.fired.retain(|_, t| *t >= now_ms - 2 * DAY);
        alerts
    }
}
