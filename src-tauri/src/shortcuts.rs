//! 바탕화면 바로가기 이름을 한글로 맞춘다.
//!
//! 설치 프로그램은 바로가기 이름을 설치가 끝날 때 '데스크 캘린더'로 바꾸지만(windows/hooks.nsh),
//! 마지막 화면에서 '바탕화면 바로가기 만들기'를 체크해 만든 바로가기는 그보다 늦게 생겨
//! 영문 'DeskCalendar.lnk'로 남는다. 설치형 앱이 시작할 때 이름을 바꿔 준다.

use std::path::Path;

const ENGLISH: &str = "DeskCalendar.lnk";
const KOREAN: &str = "데스크 캘린더.lnk";

/// 바탕화면의 DeskCalendar.lnk를 '데스크 캘린더.lnk'로 바꾼다. 한글 이름이 이미 있으면 영문 쪽만 지운다.
/// 바꾸거나 지웠으면 true
pub fn fix_desktop_name(desktop: &Path) -> std::io::Result<bool> {
    let english = desktop.join(ENGLISH);
    if !english.exists() {
        return Ok(false);
    }
    let korean = desktop.join(KOREAN);
    if korean.exists() {
        std::fs::remove_file(&english)?;
    } else {
        std::fs::rename(&english, &korean)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_desktop(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("desk-shortcut-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn renames_english_shortcut() {
        let d = temp_desktop("rename");
        fs::write(d.join(ENGLISH), "lnk").unwrap();
        assert!(fix_desktop_name(&d).unwrap());
        assert!(!d.join(ENGLISH).exists());
        assert_eq!(fs::read_to_string(d.join(KOREAN)).unwrap(), "lnk");
        assert!(!fix_desktop_name(&d).unwrap(), "두 번째에는 할 일이 없음");
    }

    #[test]
    fn keeps_existing_korean_shortcut() {
        let d = temp_desktop("both");
        fs::write(d.join(ENGLISH), "new").unwrap();
        fs::write(d.join(KOREAN), "old").unwrap();
        assert!(fix_desktop_name(&d).unwrap());
        assert!(!d.join(ENGLISH).exists());
        assert_eq!(fs::read_to_string(d.join(KOREAN)).unwrap(), "old");
    }
}
