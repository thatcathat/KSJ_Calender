//! 일정 검색: 제목·장소에 검색어(띄어쓰기로 나눈 낱말)가 모두 들어 있는 일정을 찾는다.
//! 반복 일정은 하나로 묶어, 오늘 이후 가장 가까운 발생(없으면 가장 최근 발생)으로 보여 준다.

use crate::dates::{fmt_date, parse, DAY};
use crate::model::Event;
use crate::recurrence::{expand_event, Occurrence};
use serde_json::{json, Value};

const SPAN: i64 = 2 * 365 * DAY; // 반복 일정의 발생을 찾는 범위(오늘 앞뒤)
pub const MAX_RESULTS: usize = 50;

/// 발생의 마지막 날(종료는 배타적이라 1ms 빼서 계산)
fn last_day(o: &Occurrence) -> String {
    let start = o.start_ms;
    let end = parse(&o.end).unwrap_or(start);
    fmt_date((end - 1).max(start))
}

pub struct SearchResult {
    /// (발생, 다가오는 것인지)
    pub items: Vec<(Occurrence, bool)>,
    pub total: usize,
}

impl SearchResult {
    /// 화면에 보내는 모양: `{ items: [{...발생, upcoming}], total }`
    pub fn to_value(&self) -> Value {
        let items: Vec<Value> = self
            .items
            .iter()
            .map(|(o, upcoming)| {
                let mut v = o.to_value();
                v.as_object_mut().expect("발생은 객체").insert("upcoming".into(), json!(upcoming));
                v
            })
            .collect();
        json!({ "items": items, "total": self.total })
    }
}

/// items는 다가오는 것(가까운 순) → 지난 것(최근 순), 최대 MAX_RESULTS개
pub fn search_events(events: &[Event], query: &str, today: &str) -> SearchResult {
    let lower = query.to_lowercase();
    let terms: Vec<&str> = lower.split_whitespace().collect();
    if terms.is_empty() {
        return SearchResult { items: vec![], total: 0 };
    }
    let Ok(t) = parse(today) else {
        return SearchResult { items: vec![], total: 0 };
    };
    let (mut upcoming, mut past) = (Vec::new(), Vec::new());
    for ev in events {
        let text = format!("{} {}", ev.title, ev.location).to_lowercase();
        if !terms.iter().all(|w| text.contains(w)) {
            continue;
        }
        // 한 번뿐인 일정은 날짜와 상관없이 그 일정 자체를 찾는다
        let occs = if ev.recurrence.is_some() {
            expand_event(ev, t - SPAN, t + SPAN)
        } else {
            parse(&ev.start).and_then(|s| expand_event(ev, s, s + 1))
        };
        let Ok(mut occs) = occs else { continue };
        if let Some(i) = occs.iter().position(|o| last_day(o).as_str() >= today) {
            upcoming.push((occs.swap_remove(i), true));
        } else if let Some(last) = occs.pop() {
            past.push((last, false));
        }
    }
    upcoming.sort_by(|a, b| a.0.start.cmp(&b.0.start));
    past.sort_by(|a, b| b.0.start.cmp(&a.0.start));
    let total = upcoming.len() + past.len();
    let items = upcoming.into_iter().chain(past).take(MAX_RESULTS).collect();
    SearchResult { items, total }
}
