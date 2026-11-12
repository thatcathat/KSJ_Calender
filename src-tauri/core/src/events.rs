//! 일정·메모 추가/수정/삭제/되살리기. 저장은 `store`가 맡는다.
//! 화면에서 오는 입력은 JSON 값 그대로 받아, 예전 JS와 같은 규칙으로 검증·정리한다.

use crate::dates::{add_days, fmt_like, is_date_only, now_iso, parse, DAY, HOUR};
use crate::js::{self, as_str, field, is_valid_id, to_number, truncate_utf16, truthy};
use crate::model::{CalendarKind, Data, Event, Freq, Memo, MonthlyMode, Recurrence};
use crate::recurrence::{count_before, duration_of};
use serde_json::{Map, Value};

pub const COLORS: &[&str] = &["blue", "red", "green", "amber", "violet", "teal", "slate"];
const MAX_REMINDER_MINUTES: f64 = 40320.0; // 4주

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 반복 정보 정리. 모르는 freq면 반복 없음
pub fn clean_recurrence(r: Option<&Value>) -> Option<Recurrence> {
    let r = r.filter(|v| v.is_object())?;
    let freq = Freq::parse(as_str(field(r, "freq"))?)?;
    let interval = js::parse_int(field(r, "interval")).filter(|n| *n != 0).unwrap_or(1).clamp(1, 999);
    let byweekday = (freq == Freq::Weekly)
        .then(|| field(r, "byweekday").and_then(Value::as_array))
        .flatten()
        .map(|a| {
            let mut days: Vec<u32> = a
                .iter()
                .map(|d| to_number(Some(d)))
                .filter(|d| d.fract() == 0.0 && (0.0..=6.0).contains(d))
                .map(|d| d as u32)
                .collect();
            days.sort_unstable();
            days.dedup();
            days
        });
    let monthly_mode = (freq == Freq::Monthly).then(|| match as_str(field(r, "monthlyMode")) {
        Some("nth") => MonthlyMode::Nth,
        Some("last") => MonthlyMode::Last,
        _ => MonthlyMode::Day,
    });
    let (mut count, mut until) = (None, None);
    if truthy(field(r, "count")) {
        count = js::parse_int(field(r, "count")).map(|c| c.clamp(1, 9999));
    } else if let Some(u) = as_str(field(r, "until")).filter(|u| is_ymd(u)) {
        until = Some(u.to_string());
    }
    // 음력은 매년 반복에서만
    let calendar = CalendarKind::parse(field(r, "calendar")).filter(|_| freq == Freq::Yearly);
    Some(Recurrence {
        freq,
        interval,
        byweekday,
        monthly_mode,
        count,
        until,
        calendar,
    })
}

/// `^\d{4}-\d{2}-\d{2}$`
fn is_ymd(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// 검증·정리한 일정 필드
#[derive(Debug, Clone, PartialEq)]
pub struct Fields {
    pub title: String,
    pub start: String,
    pub end: String,
    pub color: String,
    pub location: String,
    pub memo: String,
    pub reminders: Vec<i64>,
    pub recurrence: Option<Recurrence>,
}

impl Fields {
    fn apply_to(self, ev: &mut Event) {
        ev.title = self.title;
        ev.start = self.start;
        ev.end = Some(self.end);
        ev.color = self.color;
        ev.location = self.location;
        ev.memo = self.memo;
        ev.reminders = self.reminders;
        ev.recurrence = self.recurrence;
    }

    fn into_event(self, id: String) -> Event {
        let now = now_iso();
        let mut ev = Event {
            id,
            created_at: now.clone(),
            updated_at: now,
            ..Default::default()
        };
        self.apply_to(&mut ev);
        ev
    }
}

/// 입력값을 검증·정리한 일정 필드
pub fn clean_fields(input: &Value) -> Result<Fields, String> {
    let title = truncate_utf16(js::to_string(field(input, "title")).trim(), 200);
    let title = if title.is_empty() { "(제목 없음)".to_string() } else { title };
    let start = match field(input, "start") {
        None => "undefined".to_string(),
        Some(v) => js::to_string(Some(v)),
    };
    let s = parse(&start)?; // 형식 검사
    let mut end = truthy(field(input, "end")).then(|| js::to_string(field(input, "end")));
    if let Some(e) = &end {
        parse(e)?;
        if is_date_only(&start) != is_date_only(e) {
            end = None;
        }
    }
    let end_ms = end.as_deref().map(parse).transpose()?;
    let end = match (end, end_ms) {
        (Some(e), Some(ms)) if ms > s => e,
        (Some(e), Some(ms)) if ms == s && !is_date_only(&start) => e,
        _ => fmt_like(s + if is_date_only(&start) { DAY } else { HOUR }, &start),
    };
    let mut reminders: Vec<i64> = field(input, "reminders")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|m| to_number(Some(m)))
                .filter(|m| m.is_finite() && m.fract() == 0.0 && (0.0..=MAX_REMINDER_MINUTES).contains(m))
                .map(|m| m as i64)
                .collect()
        })
        .unwrap_or_default();
    reminders.sort_unstable();
    reminders.dedup();
    let color = as_str(field(input, "color"))
        .filter(|c| COLORS.contains(c))
        .unwrap_or("blue")
        .to_string();
    let recurrence = clean_recurrence(field(input, "recurrence"));
    // 음력 표 밖의 날짜로 음력 반복을 만들면 한 번도 안 보이는 일정이 되므로 막는다
    if recurrence.as_ref().is_some_and(Recurrence::is_lunar_yearly) && lunar_of(s).is_none() {
        return Err(format!("음력 반복은 {}년까지의 날짜에만 쓸 수 있어요.", crate::lunar::LAST_YEAR));
    }
    Ok(Fields {
        title,
        start,
        end,
        color,
        location: truncate_utf16(&js::to_string(field(input, "location")), 300),
        memo: truncate_utf16(&js::to_string(field(input, "memo")), 5000),
        reminders,
        recurrence,
    })
}

fn lunar_of(ms: i64) -> Option<crate::lunar::LunarDate> {
    let (y, m, d, ..) = crate::dates::parts(ms);
    crate::lunar::solar_to_lunar(i32::try_from(y).ok()?, m, d)
}

pub fn create_event(data: &mut Data, input: &Value) -> Result<Event, String> {
    let ev = clean_fields(input)?.into_event(new_id());
    data.events.push(ev.clone());
    Ok(ev)
}

fn find_index(data: &Data, id: &str) -> Result<usize, String> {
    data.events
        .iter()
        .position(|e| e.id == id)
        .ok_or_else(|| "일정을 찾을 수 없어요. 이미 삭제됐을 수 있어요.".to_string())
}

/// 반복을 occurrence_start '직전'에서 끝낸다. 남은 횟수(횟수 반복일 때)를 돌려준다.
fn truncate_before(series: &mut Event, occurrence_start: &str) -> Result<Option<i64>, String> {
    let mut r = series.recurrence.clone().ok_or("반복 일정이 아님")?;
    let mut remaining = None;
    if let Some(count) = r.count_limit() {
        let before = count_before(series, occurrence_start)?;
        remaining = Some((count - before).max(1));
        r.count = Some(before);
        r.until = None;
    } else {
        r.until = Some(add_days(&occurrence_start[..occurrence_start.len().min(10)], -1)?);
    }
    series.recurrence = Some(r);
    series.exdates.retain(|x| x.as_str() < occurrence_start);
    series.updated_at = now_iso();
    Ok(remaining)
}

fn add_exdate(series: &mut Event, occ: &str) {
    if !series.exdates.iter().any(|x| x == occ) {
        series.exdates.push(occ.to_string());
    }
}

fn date_part(s: &str) -> &str {
    &s[..s.len().min(10)]
}

/// 일정 수정.
/// `opts`: `{ scope: 'all' | 'this' | 'future', occurrenceStart, changes }`
/// (scope는 반복 일정일 때만 의미 있음, occurrenceStart는 사용자가 연 발생의 시작값)
pub fn update_event(data: &mut Data, id: &str, opts: &Value) -> Result<Event, String> {
    let scope = as_str(field(opts, "scope")).unwrap_or("all");
    let changes = field(opts, "changes").cloned().unwrap_or(Value::Object(Map::new()));
    let i = find_index(data, id)?;
    let series = &mut data.events[i];

    // { ...series, ...changes }
    let mut merged_input = series.to_value();
    if let (Some(base), Some(ch)) = (merged_input.as_object_mut(), changes.as_object()) {
        for (k, v) in ch {
            base.insert(k.clone(), v.clone());
        }
    }
    let merged = clean_fields(&merged_input)?;

    if series.recurrence.is_none() {
        let has_rec = merged.recurrence.is_some();
        merged.apply_to(series);
        series.updated_at = now_iso();
        if has_rec {
            series.exdates.clear();
        }
        return Ok(series.clone());
    }

    let occ = as_str(field(opts, "occurrenceStart"))
        .filter(|s| !s.is_empty())
        .unwrap_or(&series.start)
        .to_string();

    if scope == "this" {
        add_exdate(series, &occ);
        series.updated_at = now_iso();
        let series_id = series.id.clone();
        let mut single = Fields {
            recurrence: None,
            ..merged
        }
        .into_event(new_id());
        single.series_id = Some(series_id);
        data.events.push(single.clone());
        return Ok(single);
    }

    if scope == "future" && occ != series.start {
        let remaining = truncate_before(series, &occ)?;
        let mut rec = merged.recurrence.clone();
        let changes_has_count = field(&changes, "recurrence")
            .and_then(Value::as_object)
            .is_some_and(|r| r.contains_key("count"));
        let series_count = series.recurrence.as_ref().and_then(Recurrence::count_limit);
        if let (Some(rec), Some(remaining), Some(_)) = (rec.as_mut(), remaining, series_count) {
            if !changes_has_count {
                rec.count = Some(remaining);
            }
        }
        let next = Fields { recurrence: rec, ..merged }.into_event(new_id());
        data.events.push(next.clone());
        return Ok(next);
    }

    // 'all' — 열어 본 발생에서 바꾼 만큼 반복 전체의 시작을 옮긴다
    if merged.recurrence.is_none() {
        merged.apply_to(series);
        series.exdates.clear();
        series.updated_at = now_iso();
        return Ok(series.clone());
    }
    let day_delta = ((parse(date_part(&merged.start))? - parse(date_part(&occ))?) as f64 / DAY as f64).round() as i64;
    let new_start = add_days(date_part(&series.start), day_delta)? + &merged.start[date_part(&merged.start).len()..];
    let probe = Event {
        start: merged.start.clone(),
        end: Some(merged.end.clone()),
        ..Default::default()
    };
    let dur = duration_of(&probe)?;
    let keep_exdates = day_delta == 0 && is_date_only(&new_start) == is_date_only(&series.start);
    let exdates = if keep_exdates {
        std::mem::take(&mut series.exdates)
    } else {
        Vec::new()
    };
    let end = fmt_like(parse(&new_start)? + dur, &new_start);
    merged.apply_to(series);
    series.start = new_start;
    series.end = Some(end);
    series.exdates = exdates;
    series.updated_at = now_iso();
    Ok(series.clone())
}

/// 일정 삭제. `opts`: `{ scope, occurrenceStart }`
pub fn delete_event(data: &mut Data, id: &str, opts: &Value) -> Result<(), String> {
    let scope = as_str(field(opts, "scope")).unwrap_or("all");
    let i = find_index(data, id)?;
    let series = &mut data.events[i];
    let occ = as_str(field(opts, "occurrenceStart"))
        .filter(|s| !s.is_empty())
        .unwrap_or(&series.start)
        .to_string();
    if series.recurrence.is_none() || scope == "all" || (scope == "future" && occ == series.start) {
        data.events.remove(i);
        return Ok(());
    }
    if scope == "this" {
        add_exdate(series, &occ);
    } else if scope == "future" {
        truncate_before(series, &occ)?;
    }
    series.updated_at = now_iso();
    Ok(())
}

/// 삭제 되돌리기: 삭제 전에 받아 둔 일정을 id·제외일·분할 정보까지 그대로 되살린다.
/// 반복 일정의 '이 일정만/이후 모두' 삭제는 원래 일정을 고치는 것이라, 같은 id가 있으면 그 자리를 덮어쓴다.
pub fn restore_event(data: &mut Data, snapshot: &Value) -> Result<Event, String> {
    let id = as_str(field(snapshot, "id"))
        .filter(|id| is_valid_id(id))
        .ok_or("되살릴 일정 정보가 올바르지 않아요.")?;
    let mut ev = clean_fields(snapshot)?.into_event(id.to_string());
    ev.exdates = field(snapshot, "exdates")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    ev.series_id = as_str(field(snapshot, "seriesId")).map(str::to_string);
    if let Some(c) = as_str(field(snapshot, "createdAt")) {
        ev.created_at = c.to_string();
    }
    match data.events.iter().position(|e| e.id == ev.id) {
        Some(i) => data.events[i] = ev.clone(),
        None => data.events.push(ev.clone()),
    }
    Ok(ev)
}

// ── 메모 ─────────────────────────────────────────

/// id가 있으면 수정, 없거나 못 찾으면 새로 만든다(되돌리기 시 원래 id·위치로 복원).
/// done(완료 체크)은 넘겨줄 때만 바꾼다. `memo`: `{ id?, text, index?, done? }`
pub fn save_memo(data: &mut Data, memo: &Value) -> Memo {
    let body = truncate_utf16(&js::to_string(field(memo, "text")), 20000);
    let id = field(memo, "id");
    let done = field(memo, "done").and_then(Value::as_bool);
    if truthy(id) {
        let id_str = js::to_string(id);
        if let Some(m) = data.memos.iter_mut().find(|m| m.id == id_str) {
            m.text = body;
            if let Some(d) = done {
                m.done = d;
            }
            m.updated_at = now_iso();
            return m.clone();
        }
    }
    let valid_id = as_str(id).filter(|s| is_valid_id(s)).map_or_else(new_id, str::to_string);
    let now = now_iso();
    let m = Memo {
        id: valid_id,
        text: body,
        done: done == Some(true),
        created_at: now.clone(),
        updated_at: now,
        ..Default::default()
    };
    let index = field(memo, "index").and_then(Value::as_f64).filter(|f| f.fract() == 0.0);
    let at = index.map_or(0, |i| i.clamp(0.0, data.memos.len() as f64) as usize);
    data.memos.insert(at, m.clone());
    m
}

pub fn delete_memo(data: &mut Data, id: &str) {
    data.memos.retain(|m| m.id != id);
}

/// 메모 순서 바꾸기: ids 순서대로. ids에 없는 메모는 원래 순서대로 뒤에 둔다.
pub fn reorder_memos(data: &mut Data, ids: &[String]) -> Vec<Memo> {
    let rank = |m: &Memo| ids.iter().position(|id| *id == m.id).unwrap_or(usize::MAX);
    data.memos.sort_by_key(rank); // 안정 정렬이라 같은 순위는 원래 순서 유지
    data.memos.clone()
}
