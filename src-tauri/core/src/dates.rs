//! 날짜는 모두 "떠 있는(floating) 현지 시각" 문자열로 다룬다.
//!   종일:   `YYYY-MM-DD`
//!   시간:   `YYYY-MM-DDTHH:mm`
//! 계산할 때는 같은 벽시계 값을 UTC 밀리초로 바꿔서 쓴다(시간대·서머타임 영향 없음).
//! 이 밀리초 값을 이 크레이트에서는 "floating ms"라고 부른다.

pub const DAY: i64 = 86_400_000;
pub const HOUR: i64 = 3_600_000;
pub const MIN: i64 = 60_000;

/// 1970-01-01부터 센 날 수. 범위를 벗어난 달·일은 JS `Date.UTC`처럼 앞뒤로 넘긴다.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y + (m - 1).div_euclid(12);
    let m = (m - 1).rem_euclid(12) + 1;
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `days_from_civil`의 반대: (년, 월, 일)
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

pub fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        2 if is_leap_year(y) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// floating ms가 속한 날(1970-01-01부터 센 날 수)
pub fn day_index(ms: i64) -> i64 {
    ms.div_euclid(DAY)
}

/// 요일, 0=일요일
pub fn weekday_of_day(day: i64) -> u32 {
    (day + 4).rem_euclid(7) as u32
}

pub fn weekday_ms(ms: i64) -> u32 {
    weekday_of_day(day_index(ms))
}

/// 날짜 문자열의 요일, 0=일요일
pub fn weekday(date_str: &str) -> Result<u32, String> {
    Ok(weekday_ms(parse(date_str)?))
}

/// (년, 월, 일, 시, 분, 초)
pub fn parts(ms: i64) -> (i64, u32, u32, u32, u32, u32) {
    let (y, m, d) = civil_from_days(day_index(ms));
    let secs = ms.rem_euclid(DAY) / 1000;
    (y, m, d, (secs / 3600) as u32, ((secs / 60) % 60) as u32, (secs % 60) as u32)
}

fn digits(b: &[u8], at: usize, n: usize) -> Option<i64> {
    let s = b.get(at..at + n)?;
    if !s.iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(s.iter().fold(0, |acc, c| acc * 10 + i64::from(c - b'0')))
}

/// `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm[:ss]`을 floating ms로.
/// 예전 JS와 같이 앞부분만 맞으면 뒤에 붙은 글자는 무시한다.
pub fn parse(s: &str) -> Result<i64, String> {
    let b = s.as_bytes();
    let bad = || format!("잘못된 날짜 형식: {s}");
    let y = digits(b, 0, 4).ok_or_else(bad)?;
    let mo = (b.get(4) == Some(&b'-')).then(|| digits(b, 5, 2)).flatten().ok_or_else(bad)?;
    let d = (b.get(7) == Some(&b'-')).then(|| digits(b, 8, 2)).flatten().ok_or_else(bad)?;
    let mut secs = 0;
    if matches!(b.get(10), Some(b'T' | b' ')) && b.get(13) == Some(&b':') {
        if let (Some(h), Some(mi)) = (digits(b, 11, 2), digits(b, 14, 2)) {
            secs = h * 3600 + mi * 60;
            if b.get(16) == Some(&b':') {
                secs += digits(b, 17, 2).unwrap_or(0);
            }
        }
    }
    Ok((days_from_civil(y, mo, d) * 86_400 + secs) * 1000)
}

pub fn fmt_date(ms: i64) -> String {
    let (y, m, d) = civil_from_days(day_index(ms));
    format!("{y}-{m:02}-{d:02}")
}

pub fn fmt_date_time(ms: i64) -> String {
    let (_, _, _, h, mi, _) = parts(ms);
    format!("{}T{h:02}:{mi:02}", fmt_date(ms))
}

/// 종일 일정이면 `YYYY-MM-DD`(길이 10)
pub fn is_date_only(s: &str) -> bool {
    s.len() == 10
}

/// 원래 문자열의 형식(종일/시간)을 유지하며 포맷
pub fn fmt_like(ms: i64, like: &str) -> String {
    if is_date_only(like) {
        fmt_date(ms)
    } else {
        fmt_date_time(ms)
    }
}

pub fn add_days(date_str: &str, n: i64) -> Result<String, String> {
    Ok(fmt_date(parse(date_str)? + n * DAY))
}

/// 현지 벽시계 시각 → floating ms
pub fn to_floating(t: chrono::NaiveDateTime) -> i64 {
    t.and_utc().timestamp_millis()
}

/// 지금(현지 시각)의 floating ms
pub fn now_floating() -> i64 {
    to_floating(chrono::Local::now().naive_local())
}

/// 오늘(현지 날짜) `YYYY-MM-DD`
pub fn today_str() -> String {
    fmt_date(now_floating())
}

/// 지금을 `2026-10-21T01:23:45.678Z` 꼴로 (JS `toISOString`과 같은 모양)
pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trip() {
        for day in -800_000..800_000 {
            let (y, m, d) = civil_from_days(day);
            assert_eq!(days_from_civil(y, i64::from(m), i64::from(d)), day);
        }
    }

    #[test]
    fn parse_and_format() {
        assert_eq!(fmt_date(parse("2026-10-21").unwrap()), "2026-10-21");
        assert_eq!(fmt_date_time(parse("2026-10-21T09:05").unwrap()), "2026-10-21T09:05");
        assert_eq!(parse("2026-10-21 09:05:30").unwrap() % MIN, 30_000);
        assert_eq!(parse("2026-10-21T9").unwrap(), parse("2026-10-21").unwrap());
        assert_eq!(fmt_date(parse("2026-13-01").unwrap()), "2027-01-01", "JS Date.UTC처럼 넘김");
        assert!(parse("2026/10/21").is_err());
        assert_eq!(weekday("2026-10-21").unwrap(), 3);
        assert_eq!(add_days("2026-12-31", 1).unwrap(), "2027-01-01");
    }
}
