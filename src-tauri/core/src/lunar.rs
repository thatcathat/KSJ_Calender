//! 한국 음력 ↔ 양력 변환. korean-lunar-calendar 0.4.0(MIT)의 계산을 그대로 옮겼다.
//! 지원 범위: 음력 1000-01-01 ~ 2050-11-18, 양력 1000-02-13 ~ 2050-12-31.
//!
//! 표(`lunar_data::DATA`)의 한 해 값 비트 구성
//!   30      : 양력 윤년
//!   17..=25 : 음력 한 해의 날 수
//!   16      : 윤달이 큰달(30일)인지
//!   12..=15 : 윤달이 몇 월인지(0이면 윤달 없음)
//!   0..=11  : 1~12월이 큰달인지 (1월이 11번 비트)

use crate::lunar_data::{BASE_YEAR, DATA};
use std::sync::OnceLock;

// YYYYMMDD 꼴 숫자라 밑줄도 년_월_일로 끊었다
#[allow(clippy::inconsistent_digit_grouping)]
const LUNAR_MIN: i64 = 1000_01_01;
#[allow(clippy::inconsistent_digit_grouping)]
const LUNAR_MAX: i64 = 2050_11_18;
#[allow(clippy::inconsistent_digit_grouping)]
const SOLAR_MIN: i64 = 1000_02_13;
#[allow(clippy::inconsistent_digit_grouping)]
const SOLAR_MAX: i64 = 2050_12_31;
const SOLAR_LUNAR_DAY_DIFF: i64 = 43;
/// 음력 표의 마지막 해
pub const LAST_YEAR: i32 = 2050;
const SOLAR_DAYS: [i64; 13] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 29];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LunarDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    /// 윤달
    pub leap: bool,
}

fn data(year: i32) -> u32 {
    // 표 밖의 해는 0 (JS의 `undefined >> n`과 같은 결과)
    usize::try_from(year - BASE_YEAR)
        .ok()
        .and_then(|i| DATA.get(i).copied())
        .unwrap_or(0)
}

fn leap_month_of(d: u32) -> u32 {
    (d >> 12) & 15
}

fn lunar_year_days(year: i32) -> i64 {
    i64::from((data(year) >> 17) & 511)
}

fn lunar_month_days(year: i32, month: u32, leap: bool) -> i64 {
    let d = data(year);
    let big = if leap && leap_month_of(d) == month {
        (d >> 16) & 1 > 0
    } else {
        (d >> (12 - month)) & 1 > 0
    };
    if big {
        30
    } else {
        29
    }
}

fn is_solar_leap(year: i32) -> bool {
    (data(year) >> 30) & 1 > 0
}

fn solar_year_days(year: i32) -> i64 {
    if is_solar_leap(year) {
        366
    } else {
        365
    }
}

fn solar_month_days(year: i32, month: u32) -> i64 {
    if month == 2 && is_solar_leap(year) {
        SOLAR_DAYS[12]
    } else {
        SOLAR_DAYS[(month - 1) as usize]
    }
}

/// BASE_YEAR부터 그 해까지(포함) 날 수의 누적합. 인덱스 = year - BASE_YEAR
fn cumulative() -> &'static (Vec<i64>, Vec<i64>) {
    static CUM: OnceLock<(Vec<i64>, Vec<i64>)> = OnceLock::new();
    CUM.get_or_init(|| {
        let (mut lunar, mut solar) = (Vec::with_capacity(DATA.len()), Vec::with_capacity(DATA.len()));
        let (mut l, mut s) = (0, 0);
        for i in 0..DATA.len() as i32 {
            l += lunar_year_days(BASE_YEAR + i);
            s += solar_year_days(BASE_YEAR + i);
            lunar.push(l);
            solar.push(s);
        }
        (lunar, solar)
    })
}

fn cum_at(table: &[i64], year: i32, per_year: fn(i32) -> i64) -> i64 {
    if year < BASE_YEAR {
        return 0;
    }
    let i = (year - BASE_YEAR) as usize;
    match table.get(i) {
        Some(v) => *v,
        // 표 밖: 마지막 누적값에 남은 해를 더한다(JS와 같은 결과)
        None => table.last().copied().unwrap_or(0) + (BASE_YEAR + table.len() as i32..=year).map(per_year).sum::<i64>(),
    }
}

fn lunar_days_before_base_year(year: i32) -> i64 {
    cum_at(&cumulative().0, year, lunar_year_days)
}

fn solar_days_before_base_year(year: i32) -> i64 {
    cum_at(&cumulative().1, year, solar_year_days)
}

fn lunar_days_before_base_month(year: i32, month: u32, leap: bool) -> i64 {
    let mut days = 0;
    if year >= BASE_YEAR && month > 0 {
        for m in 1..=month {
            days += lunar_month_days(year, m, false);
        }
        if leap {
            let lm = leap_month_of(data(year));
            if lm > 0 && lm < month + 1 {
                days += lunar_month_days(year, lm, true);
            }
        }
    }
    days
}

fn lunar_abs_days(year: i32, month: u32, day: u32, leap: bool) -> i64 {
    let mut days = lunar_days_before_base_year(year - 1) + lunar_days_before_base_month(year, month - 1, true) + i64::from(day);
    if leap && leap_month_of(data(year)) == month {
        days += lunar_month_days(year, month, false);
    }
    days
}

fn solar_days_before_base_month(year: i32, month: u32) -> i64 {
    (1..=month).map(|m| solar_month_days(year, m)).sum()
}

fn solar_abs_days(year: i32, month: u32, day: u32) -> i64 {
    solar_days_before_base_year(year - 1) + solar_days_before_base_month(year, month - 1) + i64::from(day) - SOLAR_LUNAR_DAY_DIFF
}

fn valid(is_lunar: bool, leap: bool, year: i32, month: u32, day: u32) -> bool {
    let value = i64::from(year) * 10_000 + i64::from(month) * 100 + i64::from(day);
    let (min, max) = if is_lunar { (LUNAR_MIN, LUNAR_MAX) } else { (SOLAR_MIN, SOLAR_MAX) };
    if value < min || value > max || month == 0 || month > 12 || day == 0 {
        return false;
    }
    if is_lunar && leap && leap_month_of(data(year)) != month {
        return false;
    }
    let limit = if is_lunar {
        lunar_month_days(year, month, leap)
    } else {
        solar_month_days(year, month)
    };
    if !is_lunar && year == 1582 && month == 10 && day > 4 && day < 15 {
        return false;
    }
    i64::from(day) <= limit
}

/// 양력 → 음력. 범위 밖이거나 없는 날짜면 None
pub fn solar_to_lunar(year: i32, month: u32, day: u32) -> Option<LunarDate> {
    if !valid(false, false, year, month, day) {
        return None;
    }
    let abs = solar_abs_days(year, month, day);
    let ly = if abs >= lunar_abs_days(year, 1, 1, false) { year } else { year - 1 };
    for m in (1..=12).rev() {
        if abs >= lunar_abs_days(ly, m, 1, false) {
            let leap = leap_month_of(data(ly)) == m && abs >= lunar_abs_days(ly, m, 1, true);
            let d = abs - lunar_abs_days(ly, m, 1, leap) + 1;
            return Some(LunarDate {
                year: ly,
                month: m,
                day: d as u32,
                leap,
            });
        }
    }
    Some(LunarDate {
        year: ly,
        month: 0,
        day: 0,
        leap: false,
    })
}

/// 음력 → 양력 (년, 월, 일). 범위 밖이거나 없는 날짜면 None
pub fn lunar_to_solar(year: i32, month: u32, day: u32, leap: bool) -> Option<(i32, u32, u32)> {
    if !valid(true, leap, year, month, day) {
        return None;
    }
    let abs = lunar_abs_days(year, month, day, leap);
    let sy = if abs < solar_abs_days(year + 1, 1, 1) { year } else { year + 1 };
    for m in (1..=12).rev() {
        let by_month = solar_abs_days(sy, m, 1);
        if abs >= by_month {
            return Some((sy, m, (abs - by_month + 1) as u32));
        }
    }
    Some((sy, 0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_dates() {
        // 2026 설날 = 양력 2026-02-17, 2027 추석 = 2027-09-15
        assert_eq!(lunar_to_solar(2026, 1, 1, false), Some((2026, 2, 17)));
        assert_eq!(lunar_to_solar(2027, 8, 15, false), Some((2027, 9, 15)));
        assert_eq!(
            solar_to_lunar(2026, 2, 17),
            Some(LunarDate {
                year: 2026,
                month: 1,
                day: 1,
                leap: false
            })
        );
        assert_eq!(solar_to_lunar(2051, 1, 1), None);
        assert_eq!(lunar_to_solar(2026, 2, 30, false).is_some(), lunar_month_days(2026, 2, false) == 30);
    }
}
