//! 반복 일정 전개. 예전 JS 앱이 쓰던 rrule.js와 같은 결과를 내도록 직접 계산한다.
//! 시간은 모두 floating ms(`dates` 모듈 참고)라 시간대 문제가 없다.
//!
//! rrule 규칙 중 이 앱이 쓰는 것만:
//! - 매일/매주/매월/매년, 간격(interval), 횟수(count) 또는 종료일(until)
//! - 매주: 고른 요일들. 주는 월요일에 시작한다(rrule 기본값 WKST=MO). 간격이 2 이상이면 이게 중요하다.
//! - 매월: 시작일과 같은 날짜(없는 달은 건너뜀) / n번째 요일(없는 달은 건너뜀) / 마지막 요일
//! - 매년: 시작일과 같은 월·일(2월 29일은 윤년에만)
//! - 시작일 자체도 규칙에 맞을 때만 발생으로 친다. 횟수는 시작일부터 센다.
//!
//! rrule에 없는 이 앱만의 규칙: 음력 매년 반복 (`calendar: "lunar"`)
//! - 시작일의 음력 월·일을 해마다 양력으로 바꿔서 쓴다. 첫 발생은 늘 시작일 자신.
//! - 시작일이 윤달이면 다음 해부터는 같은 숫자의 평달로 (윤달은 몇 해에 한 번만 있어서)
//! - 30일인데 그해 그 달이 29일까지면 29일(그 달 마지막 날)로
//! - 음력 표가 끝나는 해(lunar::LAST_YEAR) 뒤로는 발생이 없다

use crate::dates::{civil_from_days, day_index, days_from_civil, days_in_month, fmt_like, is_date_only, parse, weekday_of_day, DAY, HOUR};
use crate::lunar::{lunar_to_solar, solar_to_lunar, LunarDate, LAST_YEAR};
use crate::model::{Event, Freq, MonthlyMode};
use serde_json::{json, Value};

const MAX_OCCURRENCES: usize = 5000;
/// 규칙에 맞는 날이 끝없이 안 나오는 경우를 막는 안전장치(주기 수)
const MAX_PERIODS: i64 = 200_000;

/// 일정 길이(ms). 종일 일정의 end는 '다음 날(배타)' 기준
pub fn duration_of(ev: &Event) -> Result<i64, String> {
    let s = parse(&ev.start)?;
    let all_day = is_date_only(&ev.start);
    let e = match &ev.end {
        Some(end) => parse(end)?,
        None => s + if all_day { DAY } else { HOUR },
    };
    Ok((e - s).max(if all_day { DAY } else { 0 }))
}

/// 매월 n번째 요일 정보
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NthWeekday {
    pub weekday: u32,
    /// 1~5
    pub nth: u32,
    pub is_last: bool,
}

pub fn nth_weekday_of(date_str: &str) -> Result<NthWeekday, String> {
    let day = day_index(parse(date_str)?);
    let (y, m, d) = civil_from_days(day);
    Ok(NthWeekday {
        weekday: weekday_of_day(day),
        nth: d.div_ceil(7),
        is_last: d + 7 > days_in_month(y, m),
    })
}

/// 반복 규칙을 계산하기 좋은 모양으로 펼친 것
struct Rule {
    freq: Freq,
    interval: i64,
    /// 시작일(날 번호)과 하루 중 시각(ms)
    start_day: i64,
    time_of_day: i64,
    /// 매주: 월요일 기준 0~6, 오름차순
    week_offsets: Vec<i64>,
    /// 매월: 날짜 또는 (요일, n번째; -1이면 마지막)
    monthly: Monthly,
    /// 음력 매년 반복이면 시작일의 음력 날짜
    lunar: Option<LunarDate>,
    count: Option<i64>,
    until: Option<i64>,
}

#[derive(Clone, Copy)]
enum Monthly {
    Day(u32),
    Nth(u32, i32),
}

/// 양력 floating ms의 음력 날짜. 음력 표 밖이면 오류
fn lunar_date_of(ms: i64) -> Result<LunarDate, String> {
    let (y, m, d) = civil_from_days(day_index(ms));
    i32::try_from(y)
        .ok()
        .and_then(|y| solar_to_lunar(y, m, d))
        .ok_or_else(|| format!("음력으로 바꿀 수 없는 날짜예요({LAST_YEAR}년까지만 가능)."))
}

/// 그해 음력 (평달) 월·일의 양력 날 번호. 30일이 없는 달이면 29일로.
fn lunar_day_in_year(year: i32, month: u32, day: u32) -> Option<i64> {
    lunar_to_solar(year, month, day, false)
        .or_else(|| if day == 30 { lunar_to_solar(year, month, 29, false) } else { None })
        .map(|(y, m, d)| days_from_civil(i64::from(y), i64::from(m), i64::from(d)))
}

fn build_rule(ev: &Event) -> Result<Rule, String> {
    let r = ev.recurrence.as_ref().ok_or("반복 일정이 아님")?;
    let dtstart = parse(&ev.start)?;
    let start_day = day_index(dtstart);
    let start_wd = weekday_of_day(start_day);
    let days = match &r.byweekday {
        Some(d) if !d.is_empty() => d.clone(),
        _ => vec![start_wd],
    };
    let mut week_offsets: Vec<i64> = days.iter().map(|d| i64::from((d + 6) % 7)).collect();
    week_offsets.sort_unstable();
    week_offsets.dedup();
    let (_, _, dom) = civil_from_days(start_day);
    let monthly = match r.monthly_mode {
        Some(MonthlyMode::Nth | MonthlyMode::Last) => {
            let info = nth_weekday_of(&ev.start)?;
            let nth = if r.monthly_mode == Some(MonthlyMode::Last) {
                -1
            } else {
                info.nth as i32
            };
            Monthly::Nth(info.weekday, nth)
        }
        _ => Monthly::Day(dom),
    };
    let (count, until) = match (r.count_limit(), &r.until) {
        (Some(c), _) => (Some(c.max(1)), None),
        (None, Some(u)) => (None, Some(parse(u)? + DAY - 1000)), // 종료일 포함
        (None, None) => (None, None),
    };
    let lunar = if r.is_lunar_yearly() { Some(lunar_date_of(dtstart)?) } else { None };
    Ok(Rule {
        freq: r.freq,
        interval: r.interval.max(1),
        start_day,
        time_of_day: dtstart - start_day * DAY,
        week_offsets,
        monthly,
        lunar,
        count,
        until,
    })
}

/// 그 달의 n번째(음수면 뒤에서) 요일. 없으면 None
fn nth_weekday_in_month(y: i64, m: u32, weekday: u32, nth: i32) -> Option<u32> {
    let first = days_from_civil(y, i64::from(m), 1);
    let len = days_in_month(y, m);
    if nth > 0 {
        let first_match = 1 + (7 + weekday as i64 - weekday_of_day(first) as i64) % 7;
        let d = first_match + 7 * (i64::from(nth) - 1);
        (d <= i64::from(len)).then_some(d as u32)
    } else {
        let last = first + i64::from(len) - 1;
        let last_match = i64::from(len) - (7 + weekday_of_day(last) as i64 - weekday as i64) % 7;
        let d = last_match - 7 * (i64::from(-nth) - 1);
        (d >= 1).then_some(d as u32)
    }
}

impl Rule {
    /// k번째 주기의 후보 날짜들(날 번호, 오름차순). 시작일보다 앞선 날도 들어 있을 수 있다.
    fn period_days(&self, k: i64, out: &mut Vec<i64>) {
        out.clear();
        let step = k * self.interval;
        match self.freq {
            Freq::Daily => out.push(self.start_day + step),
            Freq::Weekly => {
                let week_start = self.start_day - i64::from((weekday_of_day(self.start_day) + 6) % 7);
                out.extend(self.week_offsets.iter().map(|o| week_start + step * 7 + o));
            }
            Freq::Monthly => {
                let (y, m, _) = civil_from_days(self.start_day);
                let months = y * 12 + i64::from(m) - 1 + step;
                let (y, m) = (months.div_euclid(12), months.rem_euclid(12) as u32 + 1);
                let day = match self.monthly {
                    Monthly::Day(d) => (d <= days_in_month(y, m)).then_some(d),
                    Monthly::Nth(wd, nth) => nth_weekday_in_month(y, m, wd, nth),
                };
                out.extend(day.map(|d| days_from_civil(y, i64::from(m), i64::from(d))));
            }
            Freq::Yearly if self.lunar.is_some() => {
                let l = self.lunar.expect("위에서 확인");
                if k == 0 {
                    out.push(self.start_day); // 윤달·30일이어도 시작일 자신은 발생
                } else if let Some(day) = i32::try_from(step).ok().and_then(|s| lunar_day_in_year(l.year + s, l.month, l.day)) {
                    out.push(day);
                }
            }
            Freq::Yearly => {
                let (y, m, d) = civil_from_days(self.start_day);
                let y = y + step;
                if d <= days_in_month(y, m) {
                    out.push(days_from_civil(y, i64::from(m), i64::from(d)));
                }
            }
        }
    }

    /// `lo_ms` 근처에서 시작해도 되는 주기 번호. 횟수 제한이 있으면 처음부터 세야 해서 0.
    fn first_period_near(&self, lo_ms: i64) -> i64 {
        if self.count.is_some() {
            return 0;
        }
        let lo_day = lo_ms.div_euclid(DAY) - 1;
        let gap = lo_day - self.start_day;
        if gap <= 0 {
            return 0;
        }
        let k = match self.freq {
            Freq::Daily => gap / self.interval,
            Freq::Weekly => gap / (7 * self.interval) - 1,
            Freq::Monthly => gap / 31 / self.interval - 1,
            Freq::Yearly => gap / 366 / self.interval - 1,
        };
        k.max(0)
    }

    /// [lo, hi] 안의 발생 시각(floating ms)을 오름차순으로. 횟수·종료일을 지킨다.
    fn between(&self, lo: i64, hi: i64, mut visit: impl FnMut(i64) -> bool) {
        let mut seen = 0;
        let mut days = Vec::with_capacity(7);
        let first = self.first_period_near(lo);
        for k in first..first + MAX_PERIODS {
            // 음력 표가 끝나면 더 셀 수 없다
            if self
                .lunar
                .is_some_and(|l| i64::from(l.year) + k * self.interval > i64::from(LAST_YEAR))
            {
                return;
            }
            self.period_days(k, &mut days);
            for &day in &days {
                if day < self.start_day {
                    continue;
                }
                let t = day * DAY + self.time_of_day;
                if self.until.is_some_and(|u| t > u) || t > hi {
                    return;
                }
                seen += 1;
                if self.count.is_some_and(|c| seen > c) {
                    return;
                }
                if t >= lo && !visit(t) {
                    return;
                }
            }
        }
    }
}

/// 일정 하나가 펼쳐진 발생 하나
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub event: Event,
    pub start_ms: i64,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub repeat_text: String,
}

impl Occurrence {
    /// `${eventId}::${start}`
    pub fn id(&self) -> String {
        format!("{}::{}", self.event.id, self.start)
    }

    /// 화면에 보내는 모양: 일정 필드 + 이 발생의 id·시작·끝 등
    pub fn to_value(&self) -> Value {
        let mut v = self.event.to_value();
        let o = v.as_object_mut().expect("Event는 객체");
        o.insert("id".into(), json!(self.id()));
        o.insert("eventId".into(), json!(self.event.id));
        o.insert("seriesStart".into(), json!(self.event.start));
        o.insert("start".into(), json!(self.start));
        o.insert("end".into(), json!(self.end));
        o.insert("allDay".into(), json!(self.all_day));
        o.insert("recurring".into(), json!(self.event.recurrence.is_some()));
        o.insert("repeatText".into(), json!(self.repeat_text));
        v
    }
}

/// 일정 하나를 [range_start, range_end) 구간과 겹치는 발생들로 펼친다.
pub fn expand_event(ev: &Event, range_start: i64, range_end: i64) -> Result<Vec<Occurrence>, String> {
    let (rs, re) = (range_start, range_end);
    let dur = duration_of(ev)?;
    let repeat_text = if ev.recurrence.is_some() { describe(ev)? } else { String::new() };
    let all_day = is_date_only(&ev.start);
    let make = |start_ms: i64| Occurrence {
        event: ev.clone(),
        start_ms,
        start: fmt_like(start_ms, &ev.start),
        end: fmt_like(start_ms + dur, &ev.start),
        all_day,
        repeat_text: repeat_text.clone(),
    };

    if ev.recurrence.is_none() {
        let s = parse(&ev.start)?;
        return Ok(if s < re && s + dur.max(1) > rs { vec![make(s)] } else { vec![] });
    }

    let rule = build_rule(ev)?;
    let mut out = Vec::new();
    // 시작이 range_start보다 앞이어도 길이 때문에 걸치는 발생까지 포함
    rule.between(rs - dur, re, |t| {
        if t >= re || t + dur.max(1) <= rs {
            return true;
        }
        let occ = make(t);
        if !ev.exdates.contains(&occ.start) {
            out.push(occ);
        }
        out.len() < MAX_OCCURRENCES
    });
    Ok(out)
}

/// 여러 일정을 펼쳐 정렬: 종일 일정 먼저, 그다음 시작 시각, 같으면 제목
pub fn expand_all(events: &[Event], range_start: i64, range_end: i64) -> Vec<Occurrence> {
    let mut out = Vec::new();
    for ev in events {
        match expand_event(ev, range_start, range_end) {
            Ok(occs) => out.extend(occs),
            Err(err) => eprintln!("일정 전개 실패 {}: {err}", ev.id),
        }
    }
    out.sort_by(|a, b| {
        b.all_day
            .cmp(&a.all_day)
            .then_with(|| a.start.cmp(&b.start))
            .then_with(|| a.event.title.to_lowercase().cmp(&b.event.title.to_lowercase()))
            .then_with(|| a.event.title.cmp(&b.event.title))
    });
    out
}

/// occurrence_start 이전까지 발생한 횟수 (반복 '이후 모두' 분할에 사용)
pub fn count_before(ev: &Event, occurrence_start: &str) -> Result<i64, String> {
    let rule = build_rule(ev)?;
    let until = parse(occurrence_start)?;
    let mut n = 0;
    rule.between(parse(&ev.start)?, until, |t| {
        if t < until {
            n += 1;
        }
        true
    });
    Ok(n)
}

const WEEKDAY_NAMES: [&str; 7] = ["일", "월", "화", "수", "목", "금", "토"];

/// 반복을 사람이 읽을 수 있는 한국어로
pub fn describe(ev: &Event) -> Result<String, String> {
    let Some(r) = &ev.recurrence else { return Ok(String::new()) };
    let n = r.interval.max(1);
    let start = parse(&ev.start)?;
    let (_, month, dom) = civil_from_days(day_index(start));
    let mut s = match r.freq {
        Freq::Daily => {
            if n == 1 {
                "매일".into()
            } else {
                format!("{n}일마다")
            }
        }
        Freq::Weekly => {
            let mut days = match &r.byweekday {
                Some(d) if !d.is_empty() => d.clone(),
                _ => vec![weekday_of_day(day_index(start))],
            };
            days.sort_unstable();
            let names: Vec<&str> = days.iter().map(|d| WEEKDAY_NAMES[*d as usize]).collect();
            format!(
                "{} {}요일",
                if n == 1 { "매주".into() } else { format!("{n}주마다") },
                names.join("·")
            )
        }
        Freq::Monthly => {
            let base = if n == 1 { "매월".into() } else { format!("{n}개월마다") };
            match r.monthly_mode {
                Some(mode @ (MonthlyMode::Nth | MonthlyMode::Last)) => {
                    let info = nth_weekday_of(&ev.start)?;
                    let which = if mode == MonthlyMode::Last {
                        "마지막".into()
                    } else {
                        format!("{}번째", info.nth)
                    };
                    format!("{base} {which} {}요일", WEEKDAY_NAMES[info.weekday as usize])
                }
                _ => format!("{base} {dom}일"),
            }
        }
        Freq::Yearly if r.is_lunar_yearly() => {
            // 윤달에 시작했어도 해마다 평달이라 '윤'은 붙이지 않는다
            let l = lunar_date_of(start)?;
            let base = if n == 1 { "매년".into() } else { format!("{n}년마다") };
            format!("{base} 음력 {}월 {}일", l.month, l.day)
        }
        Freq::Yearly => format!("{} {month}월 {dom}일", if n == 1 { "매년".into() } else { format!("{n}년마다") }),
    };
    if let Some(c) = r.count_limit() {
        s += &format!(", {c}회");
    } else if let Some(u) = &r.until {
        s += &format!(", {}까지", u.replace('-', "."));
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::fmt_date;

    #[test]
    fn nth_weekday() {
        // 2026년 10월: 1일이 목요일
        assert_eq!(nth_weekday_in_month(2026, 10, 3, 3), Some(21)); // 셋째 수요일
        assert_eq!(nth_weekday_in_month(2026, 10, 5, -1), Some(30)); // 마지막 금요일
        assert_eq!(nth_weekday_in_month(2026, 10, 4, 5), Some(29)); // 다섯째 목요일
        assert_eq!(nth_weekday_in_month(2026, 11, 4, 5), None);
        assert_eq!(fmt_date(days_from_civil(2026, 10, 21) * DAY), "2026-10-21");
    }
}
