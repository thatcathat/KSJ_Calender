//! 한국 공휴일 계산기 — 「관공서의 공휴일에 관한 규정」 기준.
//! 음력 명절은 `lunar` 모듈(1000~2050년 지원)로 양력 변환한다.

use crate::dates::{fmt_date, parse, weekday, weekday_ms, DAY};
use crate::lunar::lunar_to_solar;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// 대체공휴일 규칙
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sub {
    /// 설·추석 연휴 — 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일
    Lunar,
    /// 토·일 또는 다른 공휴일과 겹치면 다음 첫 평일
    Weekend,
}

struct Fixed {
    md: &'static str,
    name: &'static str,
    sub: Option<Sub>,
    /// 이 해부터 공휴일
    since: Option<i32>,
    /// 이 해까지도 공휴일(제헌절처럼 빠졌다가 다시 된 경우)
    until: Option<i32>,
    /// 이 해부터 대체공휴일 적용
    sub_since: i32,
}

// 법이 바뀌면 여기를 고친다.
const FIXED: &[Fixed] = &[
    Fixed {
        md: "01-01",
        name: "신정",
        sub: None,
        since: None,
        until: None,
        sub_since: 0,
    },
    Fixed {
        md: "03-01",
        name: "삼일절",
        sub: Some(Sub::Weekend),
        since: None,
        until: None,
        sub_since: 2021,
    },
    Fixed {
        md: "05-01",
        name: "노동절",
        sub: Some(Sub::Weekend),
        since: Some(2026),
        until: None,
        sub_since: 2026,
    },
    Fixed {
        md: "05-05",
        name: "어린이날",
        sub: Some(Sub::Weekend),
        since: None,
        until: None,
        sub_since: 2014,
    },
    Fixed {
        md: "06-06",
        name: "현충일",
        sub: None,
        since: None,
        until: None,
        sub_since: 0,
    },
    Fixed {
        md: "07-17",
        name: "제헌절",
        sub: Some(Sub::Weekend),
        since: Some(2026),
        until: Some(2007),
        sub_since: 2026,
    },
    Fixed {
        md: "08-15",
        name: "광복절",
        sub: Some(Sub::Weekend),
        since: None,
        until: None,
        sub_since: 2021,
    },
    Fixed {
        md: "10-03",
        name: "개천절",
        sub: Some(Sub::Weekend),
        since: None,
        until: None,
        sub_since: 2021,
    },
    Fixed {
        md: "10-09",
        name: "한글날",
        sub: Some(Sub::Weekend),
        since: Some(2013),
        until: None,
        sub_since: 2021,
    },
    Fixed {
        md: "12-25",
        name: "성탄절",
        sub: Some(Sub::Weekend),
        since: None,
        until: None,
        sub_since: 2023,
    },
];

/// 선거일·임시공휴일 (정부 지정, 법 규칙으로 계산 불가).
/// 새로 지정되면 앱 설정의 '직접 추가한 공휴일'로 넣으면 된다.
const SPECIAL: &[(&str, &str)] = &[
    ("2024-04-10", "국회의원 선거일"),
    ("2024-10-01", "국군의 날(임시공휴일)"),
    ("2025-01-27", "임시공휴일"),
    ("2025-06-03", "대통령 선거일"),
    ("2026-06-03", "전국동시지방선거일"),
];

/// 사용자가 직접 추가한 공휴일 (설정에 저장됨)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CustomHoliday {
    pub date: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Holiday,
    Substitute,
    Special,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Holiday {
    pub date: String,
    pub name: String,
    pub kind: Kind,
}

struct Base {
    date: String,
    name: &'static str,
    group: &'static str,
    sub: Option<Sub>,
}

pub fn lunar_to_solar_str(year: i32, month: u32, day: u32) -> Option<String> {
    lunar_to_solar(year, month, day, false).map(|(y, m, d)| format!("{y}-{m:02}-{d:02}"))
}

/// 대체공휴일 적용 전의 기본 공휴일 목록
fn base_holidays(year: i32) -> Vec<Base> {
    let mut list = Vec::new();
    for h in FIXED {
        let ok = h.since.is_none_or(|s| year >= s) || h.until.is_some_and(|u| year <= u);
        if !ok {
            continue;
        }
        list.push(Base {
            date: format!("{year}-{}", h.md),
            name: h.name,
            group: h.name,
            sub: h.sub.filter(|_| year >= h.sub_since),
        });
    }
    // 넣는 순서가 대체공휴일 계산에 영향을 준다: 고정 공휴일 → 설날 → 부처님 오신 날 → 추석
    let sub_2014 = (year >= 2014).then_some(Sub::Lunar);
    push_lunar_holiday(&mut list, year, 1, 1, "설날", sub_2014);
    if let Some(buddha) = lunar_to_solar_str(year, 4, 8) {
        let sub = (year >= 2023).then_some(Sub::Weekend);
        list.push(Base {
            date: buddha,
            name: "부처님 오신 날",
            group: "부처님 오신 날",
            sub,
        });
    }
    push_lunar_holiday(&mut list, year, 8, 15, "추석", sub_2014);
    list
}

/// 설날·추석: 전날·당일·다음날 사흘
fn push_lunar_holiday(list: &mut Vec<Base>, year: i32, month: u32, day: u32, name: &'static str, sub: Option<Sub>) {
    let Some(date) = lunar_to_solar_str(year, month, day) else { return };
    let t = parse(&date).expect("양력 변환 결과는 올바른 날짜");
    let eve_name = if name == "설날" { "설날 연휴" } else { "추석 연휴" };
    list.push(Base {
        date: fmt_date(t - DAY),
        name: eve_name,
        group: name,
        sub,
    });
    list.push(Base {
        date,
        name,
        group: name,
        sub,
    });
    list.push(Base {
        date: fmt_date(t + DAY),
        name: eve_name,
        group: name,
        sub,
    });
}

/// 한 해의 공휴일 목록 (대체공휴일 포함), 날짜순.
pub fn holidays_for_year(year: i32, custom: &[CustomHoliday]) -> Vec<Holiday> {
    let base = base_holidays(year);
    let prefix = format!("{year}-");
    let mut extra: Vec<Holiday> = SPECIAL
        .iter()
        .filter(|(d, _)| d.starts_with(&prefix))
        .map(|(d, n)| Holiday {
            date: (*d).into(),
            name: (*n).into(),
            kind: Kind::Special,
        })
        .collect();
    extra.extend(custom.iter().filter(|c| c.date.starts_with(&prefix)).map(|c| Holiday {
        date: c.date.clone(),
        name: if c.name.is_empty() { "공휴일".into() } else { c.name.clone() },
        kind: Kind::Custom,
    }));

    let mut by_date: HashMap<&str, Vec<&Base>> = HashMap::new();
    for h in &base {
        by_date.entry(h.date.as_str()).or_default().push(h);
    }
    let mut subs: Vec<Holiday> = Vec::new();
    let is_holiday =
        |d: &str, subs: &[Holiday]| by_date.contains_key(d) || extra.iter().any(|e| e.date == d) || subs.iter().any(|s| s.date == d);

    // 대체공휴일을 받을 '빠진 날'을 날짜순으로 모은다: (이 날 다음부터 찾기, 이름)
    let mut claims: Vec<(String, &str)> = Vec::new();
    let mut dates: Vec<&str> = by_date.keys().copied().collect();
    dates.sort_unstable();
    for d in dates {
        let hs = &by_date[d];
        let wd = weekday(d).expect("공휴일 날짜는 올바른 형식");
        let eligible: Vec<&&Base> = hs.iter().filter(|h| h.sub.is_some()).collect();
        if eligible.is_empty() {
            continue;
        }
        let losers: Vec<&&Base> = if wd == 0 || wd == 6 {
            // 주말: 일요일은 모든 규칙, 토요일은 'weekend' 규칙만 대상(설·추석은 다른 공휴일과 겹칠 때만)
            eligible
                .into_iter()
                .filter(|h| wd == 0 || h.sub == Some(Sub::Weekend) || hs.len() > 1)
                .collect()
        } else {
            // 평일에 공휴일 여러 개가 겹치면 겹친 개수만큼(하루는 이미 쉬므로 -1)
            eligible.into_iter().take(hs.len().saturating_sub(1)).collect()
        };
        for h in losers {
            // 설·추석은 연휴 마지막 날 이후부터 찾는다
            let after = if h.sub == Some(Sub::Lunar) {
                base.iter()
                    .filter(|b| b.group == h.group)
                    .map(|b| b.date.as_str())
                    .max()
                    .unwrap_or(d)
                    .to_string()
            } else {
                d.to_string()
            };
            claims.push((after, h.group));
        }
    }

    for (after, name) in claims {
        let mut t = parse(&after).expect("공휴일 날짜는 올바른 형식") + DAY;
        for _ in 0..30 {
            let ds = fmt_date(t);
            let wd = weekday_ms(t);
            if !(wd == 0 || wd == 6 || is_holiday(&ds, &subs)) {
                subs.push(Holiday {
                    date: ds,
                    name: format!("대체공휴일({name})"),
                    kind: Kind::Substitute,
                });
                break;
            }
            t += DAY;
        }
    }

    let mut all: Vec<Holiday> = base
        .iter()
        .map(|h| Holiday {
            date: h.date.clone(),
            name: h.name.into(),
            kind: Kind::Holiday,
        })
        .collect();
    all.extend(subs);
    all.extend(extra);
    all.sort_by(|a, b| a.date.cmp(&b.date)); // 안정 정렬: 같은 날은 넣은 순서 유지
    all
}

/// 여러 해의 공휴일을 { 'YYYY-MM-DD': ['이름', ...] } 형태로
pub fn holiday_map(from_year: i32, to_year: i32, custom: &[CustomHoliday]) -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for y in from_year..=to_year {
        for h in holidays_for_year(y, custom) {
            map.entry(h.date).or_default().push(h.name);
        }
    }
    map
}
