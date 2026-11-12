//! 예전 JS 앱의 test/core.test.js를 그대로 옮긴 테스트. 같은 입력에 같은 결과가 나와야 한다.

use calendar_core::dates::{parse, to_floating};
use calendar_core::events::{create_event, delete_event, delete_memo, reorder_memos, restore_event, save_memo, update_event};
use calendar_core::holidays::{holidays_for_year, CustomHoliday, Kind};
use calendar_core::lunar::lunar_to_solar;
use calendar_core::model::{Data, Event};
use calendar_core::notifier::{due_reminders, Notifier};
use calendar_core::recurrence::{describe, expand_all, expand_event};
use calendar_core::search::search_events;
use calendar_core::store::Store;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn subs(y: i32) -> Vec<String> {
    holidays_for_year(y, &[])
        .into_iter()
        .filter(|h| h.kind == Kind::Substitute)
        .map(|h| h.date)
        .collect()
}

fn names(y: i32) -> HashMap<String, String> {
    holidays_for_year(y, &[]).into_iter().map(|h| (h.date, h.name)).collect()
}

// ── 공휴일 ──────────────────────────────────────
#[test]
fn holidays_2027_substitutes_match_kasa_almanac() {
    // 우주항공청 2027년 월력요항과 일치
    assert_eq!(
        subs(2027),
        [
            "2027-02-09",
            "2027-05-03",
            "2027-07-19",
            "2027-08-16",
            "2027-10-04",
            "2027-10-11",
            "2027-12-27"
        ]
    );
}

#[test]
fn holidays_2027_lunar_dates() {
    let n = names(2027);
    assert_eq!(n["2027-02-07"], "설날");
    assert_eq!(n["2027-09-15"], "추석");
    assert_eq!(n["2027-05-13"], "부처님 오신 날");
}

#[test]
fn holidays_2026() {
    let n = names(2026);
    assert_eq!(n["2026-05-01"], "노동절");
    assert_eq!(n["2026-07-17"], "제헌절");
    assert_eq!(n["2026-06-03"], "전국동시지방선거일");
    assert_eq!(n["2026-02-17"], "설날");
    assert_eq!(n["2026-09-25"], "추석");
    // 추석 연휴 마지막 날이 토요일이어도 설·추석은 토요일 대체 대상 아님
    assert_eq!(subs(2026), ["2026-03-02", "2026-05-25", "2026-08-17", "2026-10-05"]);
}

#[test]
fn holidays_2025_overlaps() {
    assert_eq!(subs(2025), ["2025-03-03", "2025-05-06", "2025-10-08"]);
    assert!(!names(2025).contains_key("2025-05-01"), "2025년 노동절은 아직 공휴일 아님");
}

#[test]
fn custom_holidays_push_substitutes() {
    // 2027-10-04(월)을 임시공휴일로 지정하면 개천절 대체공휴일은 그 다음 평일로
    let list = holidays_for_year(
        2027,
        &[CustomHoliday {
            date: "2027-10-04".into(),
            name: "임시공휴일".into(),
        }],
    );
    let sub = list.iter().find(|h| h.name == "대체공휴일(개천절)").unwrap();
    assert_eq!(sub.date, "2027-10-05");
}

// ── 반복 ────────────────────────────────────────
fn ev(extra: Value) -> Event {
    let mut base = json!({ "id": "e1", "title": "t", "reminders": [], "exdates": [] });
    for (k, v) in extra.as_object().unwrap() {
        base[k] = v.clone();
    }
    Event::from_value(&base)
}

fn starts(e: &Event, a: &str, b: &str) -> Vec<String> {
    expand_event(e, parse(a).unwrap(), parse(b).unwrap())
        .unwrap()
        .into_iter()
        .map(|o| o.start)
        .collect()
}

fn all(events: &[Event], a: &str, b: &str) -> Vec<calendar_core::recurrence::Occurrence> {
    expand_all(events, parse(a).unwrap(), parse(b).unwrap())
}

#[test]
fn weekly_mon_wed() {
    let e = ev(
        json!({ "start": "2026-10-05T09:00", "end": "2026-10-05T10:00", "recurrence": { "freq": "weekly", "interval": 1, "byweekday": [1, 3] } }),
    );
    assert_eq!(
        starts(&e, "2026-10-01", "2026-10-15"),
        ["2026-10-05T09:00", "2026-10-07T09:00", "2026-10-12T09:00", "2026-10-14T09:00"]
    );
}

#[test]
fn monthly_nth_and_last() {
    let nth =
        ev(json!({ "start": "2026-10-21T14:00", "end": "2026-10-21T15:00", "recurrence": { "freq": "monthly", "monthlyMode": "nth" } }));
    let days: Vec<String> = starts(&nth, "2026-10-01", "2027-01-01")
        .into_iter()
        .map(|s| s[..10].to_string())
        .collect();
    assert_eq!(days, ["2026-10-21", "2026-11-18", "2026-12-16"]);
    let last = ev(json!({ "start": "2026-10-30", "end": "2026-10-31", "recurrence": { "freq": "monthly", "monthlyMode": "last" } }));
    assert_eq!(
        starts(&last, "2026-10-01", "2027-01-01"),
        ["2026-10-30", "2026-11-27", "2026-12-25"]
    );
    assert_eq!(describe(&nth).unwrap(), "매월 3번째 수요일");
}

#[test]
fn until_count_exdates() {
    let e = ev(
        json!({ "start": "2026-10-01", "end": "2026-10-02", "recurrence": { "freq": "daily", "until": "2026-10-05" }, "exdates": ["2026-10-03"] }),
    );
    assert_eq!(
        starts(&e, "2026-09-01", "2026-12-01"),
        ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"]
    );
    let cnt =
        ev(json!({ "start": "2026-10-01T08:00", "end": "2026-10-01T08:30", "recurrence": { "freq": "daily", "interval": 2, "count": 3 } }));
    assert_eq!(
        starts(&cnt, "2026-09-01", "2026-12-01"),
        ["2026-10-01T08:00", "2026-10-03T08:00", "2026-10-05T08:00"]
    );
}

#[test]
fn multi_day_overlaps_range() {
    let e = ev(json!({ "start": "2026-10-19", "end": "2026-10-24", "recurrence": null }));
    assert_eq!(starts(&e, "2026-10-21", "2026-10-22").len(), 1);
    assert_eq!(starts(&e, "2026-10-24", "2026-10-25").len(), 0, "end는 배타");
}

#[test]
fn sort_all_day_first_then_time() {
    let evs = [
        ev(json!({ "id": "a", "start": "2026-10-21T15:00", "end": "2026-10-21T16:00" })),
        ev(json!({ "id": "b", "start": "2026-10-21", "end": "2026-10-22" })),
        ev(json!({ "id": "c", "start": "2026-10-21T09:00", "end": "2026-10-21T10:00" })),
    ];
    let ids: Vec<String> = all(&evs, "2026-10-21", "2026-10-22").into_iter().map(|o| o.event.id).collect();
    assert_eq!(ids, ["b", "c", "a"]);
}

// ── 음력 매년 반복 ───────────────────────────────
fn solar(y: i32, m: u32, d: u32, leap: bool) -> String {
    let (y, m, d) = lunar_to_solar(y, m, d, leap).expect("음력 표 안의 날짜");
    format!("{y}-{m:02}-{d:02}")
}

fn lunar_yearly(start: &str, extra: Value) -> Event {
    let mut rec = json!({ "freq": "yearly", "calendar": "lunar" });
    for (k, v) in extra.as_object().unwrap() {
        rec[k] = v.clone();
    }
    ev(json!({ "start": start, "end": calendar_core::dates::add_days(start, 1).unwrap(), "recurrence": rec }))
}

#[test]
fn lunar_yearly_follows_lunar_date() {
    // 음력 1월 1일(설날)에 시작 → 해마다 설날
    let e = lunar_yearly("2026-02-17", json!({}));
    let expected: Vec<String> = (2026..=2030).map(|y| solar(y, 1, 1, false)).collect();
    assert_eq!(starts(&e, "2026-01-01", "2030-12-31"), expected);
    assert_eq!(expected[1], "2027-02-07", "2027 설날과 같음");
    assert_eq!(describe(&e).unwrap(), "매년 음력 1월 1일");
    // 저장할 때 calendar가 그대로 남는다
    assert_eq!(e.to_value()["recurrence"]["calendar"], "lunar");
}

#[test]
fn lunar_yearly_from_leap_month_uses_regular_month_after() {
    // 2025년 윤6월 1일에 시작 → 시작일 자신, 그다음부터는 평달 6월 1일
    let start = solar(2025, 6, 1, true);
    let e = lunar_yearly(&start, json!({}));
    assert_eq!(
        starts(&e, "2025-01-01", "2027-12-31"),
        [start, solar(2026, 6, 1, false), solar(2027, 6, 1, false)]
    );
    assert_eq!(describe(&e).unwrap(), "매년 음력 6월 1일");
}

#[test]
fn lunar_yearly_day_30_falls_back_to_29() {
    // 그해엔 30일까지 있고 이듬해엔 29일까지인 달을 찾는다
    let (y, m) = (2000..2049)
        .flat_map(|y| (1..=12).map(move |m| (y, m)))
        .find(|&(y, m)| lunar_to_solar(y, m, 30, false).is_some() && lunar_to_solar(y + 1, m, 30, false).is_none())
        .expect("그런 달은 흔하다");
    let e = lunar_yearly(&solar(y, m, 30, false), json!({ "count": 2 }));
    assert_eq!(
        starts(&e, &format!("{y}-01-01"), &format!("{}-12-31", y + 2)),
        [solar(y, m, 30, false), solar(y + 1, m, 29, false)]
    );
}

#[test]
fn lunar_yearly_stops_after_table_and_counts() {
    let e = lunar_yearly(&solar(2048, 3, 3, false), json!({}));
    assert_eq!(starts(&e, "2040-01-01", "2099-12-31").len(), 3, "2048·2049·2050년까지만");
    let every2 = lunar_yearly("2026-02-17", json!({ "interval": 2, "count": 3 }));
    assert_eq!(
        starts(&every2, "2026-01-01", "2040-12-31"),
        [solar(2026, 1, 1, false), solar(2028, 1, 1, false), solar(2030, 1, 1, false)]
    );
    assert_eq!(describe(&every2).unwrap(), "2년마다 음력 1월 1일, 3회");
}

#[test]
fn lunar_yearly_input_rules() {
    let mut data = Data::default();
    // 매년이 아니면 calendar는 무시
    let weekly = create_event(
        &mut data,
        &json!({ "title": "w", "start": "2026-10-05", "recurrence": { "freq": "weekly", "calendar": "lunar" } }),
    )
    .unwrap();
    assert!(weekly.recurrence.unwrap().calendar.is_none());
    // 음력 표 밖이면 저장하지 않는다
    let err = create_event(
        &mut data,
        &json!({ "title": "x", "start": "2051-03-01", "recurrence": { "freq": "yearly", "calendar": "lunar" } }),
    );
    assert!(err.unwrap_err().contains("2050년"));
    // 양력 매년은 2051년도 괜찮다
    assert!(create_event(
        &mut data,
        &json!({ "title": "y", "start": "2051-03-01", "recurrence": { "freq": "yearly" } })
    )
    .is_ok());
}

// ── 수정·삭제 범위 ───────────────────────────────
fn series_data() -> (Data, Event) {
    let mut data = Data::default();
    let e = create_event(
        &mut data,
        &json!({ "title": "운동", "start": "2026-10-05T07:00", "end": "2026-10-05T08:00", "recurrence": { "freq": "weekly", "byweekday": [1] } }),
    )
    .unwrap();
    (data, e)
}

fn titled(data: &Data, a: &str, b: &str) -> Vec<String> {
    all(&data.events, a, b)
        .into_iter()
        .map(|o| format!("{} {}", o.start, o.event.title))
        .collect()
}

#[test]
fn edit_this_only() {
    let (mut data, e) = series_data();
    update_event(
        &mut data,
        &e.id,
        &json!({ "scope": "this", "occurrenceStart": "2026-10-12T07:00", "changes": { "title": "운동(PT)", "start": "2026-10-12T19:00", "end": "2026-10-12T20:00" } }),
    )
    .unwrap();
    assert_eq!(titled(&data, "2026-10-12", "2026-10-13"), ["2026-10-12T19:00 운동(PT)"]);
    assert_eq!(all(&data.events, "2026-10-19", "2026-10-20")[0].event.title, "운동");
}

#[test]
fn edit_future() {
    let (mut data, e) = series_data();
    update_event(
        &mut data,
        &e.id,
        &json!({ "scope": "future", "occurrenceStart": "2026-10-19T07:00", "changes": { "title": "아침 운동", "start": "2026-10-19T06:30", "end": "2026-10-19T07:30" } }),
    )
    .unwrap();
    assert_eq!(
        titled(&data, "2026-10-01", "2026-11-01"),
        [
            "2026-10-05T07:00 운동",
            "2026-10-12T07:00 운동",
            "2026-10-19T06:30 아침 운동",
            "2026-10-26T06:30 아침 운동"
        ]
    );
}

#[test]
fn edit_all_moves_series() {
    let (mut data, e) = series_data();
    update_event(
        &mut data,
        &e.id,
        &json!({ "scope": "all", "occurrenceStart": "2026-10-12T07:00", "changes": { "start": "2026-10-13T08:00", "end": "2026-10-13T09:00", "recurrence": { "freq": "weekly", "byweekday": [2] } } }),
    )
    .unwrap();
    let s: Vec<String> = all(&data.events, "2026-10-01", "2026-10-21").into_iter().map(|o| o.start).collect();
    assert_eq!(s, ["2026-10-06T08:00", "2026-10-13T08:00", "2026-10-20T08:00"]);
}

#[test]
fn split_count_series_keeps_remaining() {
    let mut data = Data::default();
    let e = create_event(
        &mut data,
        &json!({ "title": "x", "start": "2026-10-01", "end": "2026-10-02", "recurrence": { "freq": "daily", "count": 5 } }),
    )
    .unwrap();
    update_event(&mut data, &e.id, &json!({ "scope": "future", "occurrenceStart": "2026-10-03", "changes": { "title": "y", "start": "2026-10-03", "end": "2026-10-04" } })).unwrap();
    assert_eq!(
        titled(&data, "2026-09-01", "2026-12-01"),
        ["2026-10-01 x", "2026-10-02 x", "2026-10-03 y", "2026-10-04 y", "2026-10-05 y"]
    );
}

fn days(data: &Data, a: &str, b: &str) -> Vec<String> {
    all(&data.events, a, b).into_iter().map(|o| o.start[..10].to_string()).collect()
}

#[test]
fn delete_scopes() {
    let (mut data, e) = series_data();
    delete_event(&mut data, &e.id, &json!({ "scope": "this", "occurrenceStart": "2026-10-12T07:00" })).unwrap();
    assert_eq!(days(&data, "2026-10-01", "2026-10-27"), ["2026-10-05", "2026-10-19", "2026-10-26"]);
    delete_event(
        &mut data,
        &e.id,
        &json!({ "scope": "future", "occurrenceStart": "2026-10-19T07:00" }),
    )
    .unwrap();
    assert_eq!(days(&data, "2026-10-01", "2026-12-01"), ["2026-10-05"]);
    delete_event(&mut data, &e.id, &json!({ "scope": "all" })).unwrap();
    assert!(data.events.is_empty());
}

#[test]
fn undo_delete_restores_series() {
    for scope in ["this", "future", "all"] {
        let (mut data, e) = series_data();
        let snapshot = e.to_value();
        let before: Vec<String> = all(&data.events, "2026-10-01", "2026-12-01").into_iter().map(|o| o.start).collect();
        delete_event(&mut data, &e.id, &json!({ "scope": scope, "occurrenceStart": "2026-10-19T07:00" })).unwrap();
        restore_event(&mut data, &snapshot).unwrap();
        assert_eq!(data.events.len(), 1, "{scope}");
        assert_eq!(data.events[0].id, e.id, "{scope}");
        let after: Vec<String> = all(&data.events, "2026-10-01", "2026-12-01").into_iter().map(|o| o.start).collect();
        assert_eq!(after, before, "{scope}");
    }
}

#[test]
fn clean_input_defaults() {
    let mut data = Data::default();
    let a = create_event(
        &mut data,
        &json!({ "title": "  ", "start": "2026-10-21T10:00", "end": "2026-10-21T09:00", "color": "pink" }),
    )
    .unwrap();
    assert_eq!(a.title, "(제목 없음)");
    assert_eq!(a.end.as_deref(), Some("2026-10-21T11:00"));
    assert_eq!(a.color, "blue");
    let b = create_event(&mut data, &json!({ "title": "b", "start": "2026-10-21", "end": "2026-10-21" })).unwrap();
    assert_eq!(b.end.as_deref(), Some("2026-10-22"));
}

// ── 알림 ────────────────────────────────────────
#[test]
fn reminders_timed_and_all_day() {
    let evs = [
        ev(json!({ "id": "m", "start": "2026-10-21T15:00", "end": "2026-10-21T16:00", "reminders": [10, 60] })),
        ev(json!({ "id": "d", "start": "2026-10-22", "end": "2026-10-23", "reminders": [0, 1440] })),
    ];
    let due = |a: &str, b: &str| -> Vec<String> {
        due_reminders(&evs, parse(a).unwrap(), parse(b).unwrap())
            .into_iter()
            .map(|d| d.key)
            .collect()
    };
    assert_eq!(due("2026-10-21T14:49", "2026-10-21T14:50"), ["m::2026-10-21T15:00@10"]);
    assert_eq!(due("2026-10-21T13:59", "2026-10-21T14:00"), ["m::2026-10-21T15:00@60"]);
    assert_eq!(due("2026-10-21T08:59", "2026-10-21T09:00"), ["d::2026-10-22@1440"]);
    assert_eq!(due("2026-10-22T08:59", "2026-10-22T09:00"), ["d::2026-10-22@0"]);
    assert!(
        due("2026-10-21T14:50", "2026-10-21T14:55").is_empty(),
        "이미 지난 구간은 다시 울리지 않음"
    );
}

#[test]
fn reminders_each_occurrence() {
    let evs = [ev(
        json!({ "id": "r", "start": "2026-10-01T09:00", "end": "2026-10-01T09:30", "reminders": [5], "recurrence": { "freq": "daily" } }),
    )];
    let keys: Vec<String> = due_reminders(&evs, parse("2026-10-21T08:54").unwrap(), parse("2026-10-21T08:55").unwrap())
        .into_iter()
        .map(|d| d.key)
        .collect();
    assert_eq!(keys, ["r::2026-10-21T09:00@5"]);
}

#[test]
fn wake_from_sleep_only_recent() {
    let evs = [
        ev(json!({ "id": "a", "start": "2026-10-21T01:10", "end": "2026-10-21T02:00", "reminders": [10] })),
        ev(json!({ "id": "b", "start": "2026-10-21T07:58", "end": "2026-10-21T08:30", "reminders": [0] })),
    ];
    let mut n = Notifier::new(0, 5 * 60_000);
    n.last = parse("2026-10-20T23:00").unwrap(); // 잠들기 전 마지막 확인
    let wake = chrono::NaiveDate::from_ymd_opt(2026, 10, 21).unwrap().and_hms_opt(8, 0, 0).unwrap();
    let fired: Vec<String> = n.tick(to_floating(wake), &evs).into_iter().map(|a| a.event_id).collect();
    assert_eq!(fired, ["b"]);
}

#[test]
fn alert_text() {
    let evs = [ev(
        json!({ "id": "m", "title": "회의", "location": "3층", "start": "2026-10-21T15:00", "end": "2026-10-21T16:00", "reminders": [90] }),
    )];
    let mut n = Notifier::new(parse("2026-10-21T13:29").unwrap(), 5 * 60_000);
    let alerts = n.tick(parse("2026-10-21T13:30").unwrap(), &evs);
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].title, "회의");
    assert_eq!(alerts[0].body, "오후 3:00 · 1시간 30분 후 시작\n3층");
    assert_eq!(alerts[0].date, "2026-10-21");
    assert!(n.tick(parse("2026-10-21T13:30").unwrap(), &evs).is_empty(), "같은 알림은 한 번만");
}

// ── 메모·저장소 ─────────────────────────────────
fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cal-test-{}", uuid_like()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{nanos}-{:?}", std::thread::current().id()).replace(['(', ')'], "")
}

#[test]
fn memo_crud_and_store_recovery() {
    let dir = temp_dir();
    let mut s1 = Store::open(&dir).unwrap();
    let m = s1.mutate(|d| save_memo(d, &json!({ "text": "장보기: 우유" }))).unwrap();
    s1.mutate(|d| save_memo(d, &json!({ "id": m.id, "text": "장보기: 우유, 계란" })))
        .unwrap();
    s1.mutate(|d| create_event(d, &json!({ "title": "회의", "start": "2026-10-21T10:00" })).unwrap())
        .unwrap();
    let mut s2 = Store::open(&dir).unwrap();
    assert_eq!(s2.data.memos[0].text, "장보기: 우유, 계란");
    assert_eq!(s2.data.events[0].title, "회의");
    // 본 파일이 깨지면 백업에서 복구
    s2.mutate(|d| delete_memo(d, &m.id)).unwrap();
    fs::write(dir.join("calendar-data.json"), "{깨진 파일").unwrap();
    let s3 = Store::open(&dir).unwrap();
    assert_eq!(s3.data.events.len(), 1);
    assert!(fs::read_dir(&dir)
        .unwrap()
        .any(|f| f.unwrap().file_name().to_string_lossy().contains(".broken-")));
}

#[test]
fn daily_backups() {
    let dir = temp_dir();
    let mut s = Store::open(&dir).unwrap();
    let bdir = dir.join("backups");
    s.mutate(|d| create_event(d, &json!({ "title": "회의", "start": "2026-10-21T10:00" })).unwrap())
        .unwrap();
    assert!(!bdir.exists(), "첫 저장은 이전 파일이 없어 백업하지 않음");
    s.mutate(|d| save_memo(d, &json!({ "text": "메모" }))).unwrap();
    s.mutate(|d| save_memo(d, &json!({ "text": "메모2" }))).unwrap();
    assert_eq!(fs::read_dir(&bdir).unwrap().count(), 1, "같은 날은 한 장만");
    let first: Value = serde_json::from_str(&fs::read_to_string(&s.daily_backups()[0]).unwrap()).unwrap();
    assert_eq!(first["memos"].as_array().unwrap().len(), 0, "그날 첫 저장 직전 상태");

    // 예전 백업 9장이 있으면, 오늘 것을 포함해 최신 7장만 남는다
    for f in fs::read_dir(&bdir).unwrap() {
        fs::remove_file(f.unwrap().path()).unwrap();
    }
    for i in 1..=9 {
        fs::write(bdir.join(format!("calendar-data-2020-01-0{i}.json")), "{}").unwrap();
    }
    s.save().unwrap();
    let mut names: Vec<String> = fs::read_dir(&bdir)
        .unwrap()
        .map(|f| f.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names.len(), 7);
    assert_eq!(names[0], "calendar-data-2020-01-04.json");

    fs::write(dir.join("calendar-data.json"), "{깨진 파일").unwrap();
    fs::write(dir.join("calendar-data.json.bak"), "{깨진 백업").unwrap();
    assert_eq!(Store::open(&dir).unwrap().data.events[0].title, "회의");
}

#[test]
fn store_keeps_unknown_fields_and_old_json() {
    // 예전 JS 앱이 쓴 파일을 그대로 읽고, 모르는 필드는 남긴다
    let dir = temp_dir();
    let old = json!({
        "version": 1,
        "events": [{ "id": "x1", "title": "옛 일정", "start": "2026-10-21", "end": "2026-10-22", "color": "red", "location": "", "memo": "",
                     "reminders": [0], "recurrence": null, "exdates": [], "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "future": 1 }],
        "memos": [{ "id": "m1", "text": "옛 메모", "createdAt": "a", "updatedAt": "b" }],
        "settings": { "weekStartsOn": 1, "windowBounds": { "x": 10, "y": 20, "width": 400, "height": 700 }, "someNewThing": true },
        "topLevel": "kept"
    });
    fs::write(dir.join("calendar-data.json"), serde_json::to_string_pretty(&old).unwrap()).unwrap();
    let s = Store::open(&dir).unwrap();
    assert_eq!(s.data.events[0].title, "옛 일정");
    assert!(!s.data.memos[0].done);
    assert_eq!(s.data.settings.0["weekStartsOn"], 1);
    assert!(s.data.settings.close_to_tray(), "없는 설정은 기본값");
    assert_eq!(s.data.settings.window_bounds().unwrap().width, 400);
    s.save().unwrap();
    let saved: Value = serde_json::from_str(&fs::read_to_string(dir.join("calendar-data.json")).unwrap()).unwrap();
    assert_eq!(saved["events"][0]["future"], 1);
    assert_eq!(saved["settings"]["someNewThing"], true);
    assert_eq!(saved["topLevel"], "kept");
}

#[test]
fn window_bounds_accept_decimals() {
    // 소수로 저장된 창 위치도 읽어야 한다(읽기 실패하면 매번 기본 크기로 뜸)
    let s = calendar_core::model::Settings::from_value(Some(
        &json!({ "windowBounds": { "x": 625.0, "y": -7.6, "width": 326.4, "height": 670 } }),
    ));
    let b = s.window_bounds().unwrap();
    assert_eq!((b.x, b.y, b.width, b.height), (625, -8, 326, 670));
    let none = calendar_core::model::Settings::from_value(Some(&json!({ "windowBounds": { "x": 1, "y": 2 } })));
    assert!(none.window_bounds().is_none(), "크기가 없으면 기본 크기");
}

// ── 검색 ────────────────────────────────────────
#[test]
fn search_rules() {
    let evs = [
        ev(json!({ "id": "past", "title": "치과 정기검진", "location": "강남", "start": "2026-03-02T10:00", "end": "2026-03-02T11:00" })),
        ev(json!({ "id": "old", "title": "치과", "start": "2025-01-05", "end": "2025-01-06" })),
        ev(json!({ "id": "soon", "title": "팀 회의", "location": "3층 회의실", "start": "2026-10-25T14:00", "end": "2026-10-25T15:00" })),
        ev(
            json!({ "id": "weekly", "title": "주간 회의", "start": "2026-09-07T09:00", "end": "2026-09-07T10:00", "recurrence": { "freq": "weekly" } }),
        ),
        ev(
            json!({ "id": "ended", "title": "스터디 회의", "start": "2026-01-05T19:00", "end": "2026-01-05T20:00", "recurrence": { "freq": "weekly", "count": 3 } }),
        ),
        ev(json!({ "id": "multi", "title": "출장", "location": "부산", "start": "2026-10-20", "end": "2026-10-23" })),
    ];
    let ids = |q: &str| -> Vec<String> {
        search_events(&evs, q, "2026-10-21")
            .items
            .into_iter()
            .map(|(o, _)| format!("{}@{}", o.event.id, &o.start[..10]))
            .collect()
    };
    assert_eq!(ids("치과"), ["past@2026-03-02", "old@2025-01-05"]);
    assert_eq!(ids("회의"), ["soon@2026-10-25", "weekly@2026-10-26", "ended@2026-01-19"]);
    assert_eq!(ids("회의실"), ["soon@2026-10-25"], "장소로도 찾음");
    assert_eq!(ids("치과 강남"), ["past@2026-03-02"], "낱말이 모두 들어 있어야 함");
    assert_eq!(ids("부산"), ["multi@2026-10-20"], "진행 중인 여러 날 일정은 다가오는 쪽");
    assert!(ids("   ").is_empty());
}

#[test]
fn memo_done_and_reorder() {
    let mut data = Data::default();
    let a = save_memo(&mut data, &json!({ "text": "a" }));
    let b = save_memo(&mut data, &json!({ "text": "b" }));
    let c = save_memo(&mut data, &json!({ "text": "c" })); // 새 메모는 맨 위: c, b, a
    assert!(!a.done);
    save_memo(&mut data, &json!({ "id": b.id, "text": "b", "done": true }));
    save_memo(&mut data, &json!({ "id": b.id, "text": "b 고침" }));
    assert!(data.memos.iter().find(|m| m.id == b.id).unwrap().done, "done을 안 넘기면 그대로");
    reorder_memos(&mut data, &[a.id.clone(), c.id.clone()]);
    let texts: Vec<&str> = data.memos.iter().map(|m| m.text.as_str()).collect();
    assert_eq!(texts, ["a", "c", "b 고침"], "목록에 없는 메모는 뒤로");
}
