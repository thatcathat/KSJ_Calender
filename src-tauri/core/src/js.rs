//! 화면에서 넘어온 JSON 값을 예전 JS 코드(`String(x)`, `Number(x)`, `parseInt`, 참/거짓 판정)와
//! 같은 방식으로 읽는 도우미. 저장 파일도 JS 앱이 쓴 것이라 같은 규칙으로 읽는다.

use serde_json::{Map, Value};

/// JS의 참/거짓 판정 (`if (x)`)
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS `String(x ?? '')`. 배열·객체는 빈 문자열로 본다.
pub fn to_string(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => i.to_string(),
            (None, Some(f)) => f.to_string(),
            _ => n.to_string(),
        },
        Some(_) => String::new(),
    }
}

/// 문자열일 때만
pub fn as_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
}

/// JS `Number(x)`
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse().unwrap_or(f64::NAN)
            }
        }
        Some(_) => f64::NAN,
    }
}

/// JS `parseInt(x, 10)`: 숫자는 소수점 아래를 버리고, 문자열은 앞쪽 숫자만 읽는다. 못 읽으면 None(NaN)
pub fn parse_int(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => {
            let t = s.trim_start();
            let (sign, rest) = match t.as_bytes().first() {
                Some(b'-') => (-1, &t[1..]),
                Some(b'+') => (1, &t[1..]),
                _ => (1, t),
            };
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<i64>().ok().map(|n| sign * n)
        }
        _ => None,
    }
}

/// 정수로 읽을 수 있는 숫자 (`10`, `10.0`, `"10"`)
pub fn to_int(v: Option<&Value>) -> Option<i64> {
    let f = to_number(v);
    (f.is_finite() && f.fract() == 0.0 && v.is_some_and(|x| !x.is_null())).then_some(f as i64)
}

/// JS `str.slice(0, n)`처럼 UTF-16 단위로 자르되, 글자 중간에서 끊지는 않는다
pub fn truncate_utf16(s: &str, n: usize) -> String {
    let mut units = 0;
    let mut end = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            break;
        }
        end = i + c.len_utf8();
    }
    s[..end].to_string()
}

/// `^[\w-]{8,64}$` (되살리기·메모 id 검사)
pub fn is_valid_id(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 객체의 필드, 객체가 아니면 None
pub fn field<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(key))
}

/// 알고 있는 키를 뺀 나머지 (모르는 필드를 저장 파일에 그대로 남기기 위해)
pub fn rest(v: &Value, known: &[&str]) -> Map<String, Value> {
    v.as_object()
        .map(|o| {
            o.iter()
                .filter(|(k, _)| !known.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn coercions() {
        assert_eq!(parse_int(Some(&json!("12abc"))), Some(12));
        assert_eq!(parse_int(Some(&json!(2.7))), Some(2));
        assert_eq!(parse_int(Some(&json!(""))), None);
        assert_eq!(to_string(Some(&json!(10.0))), "10");
        assert_eq!(to_string(Some(&json!(1.5))), "1.5");
        assert!(!truthy(Some(&json!(0))));
        assert!(truthy(Some(&json!("0"))));
        assert_eq!(truncate_utf16("가나다", 2), "가나");
        assert_eq!(truncate_utf16("a😀b", 2), "a", "이모지를 반으로 자르지 않음");
        assert!(is_valid_id("3f2c1a9e-aaaa"));
        assert!(!is_valid_id("short"));
    }
}
