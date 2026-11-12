//! JSON 파일 저장소. 쓰기는 임시 파일 → rename 으로 원자적으로 하고,
//! 직전 정상본을 .bak 으로 남겨 파일이 깨져도 복구할 수 있게 한다.
//! .bak은 저장할 때마다 덮어써지므로, 실수로 지운 걸 며칠 뒤 되살릴 수 있게 날짜별 백업도 남긴다.

use crate::dates::today_str;
use crate::model::Data;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DAILY_KEEP: usize = 7; // 날짜별 백업을 며칠치 남길지
pub const FILE_NAME: &str = "calendar-data.json";

/// `calendar-data-YYYY-MM-DD.json`
fn is_daily_name(name: &str) -> bool {
    let Some(date) = name.strip_prefix("calendar-data-").and_then(|r| r.strip_suffix(".json")) else {
        return false;
    };
    let b = date.as_bytes();
    b.len() == 10
        && b.iter()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

pub struct Store {
    pub dir: PathBuf,
    pub file: PathBuf,
    pub backup: PathBuf,
    pub daily_dir: PathBuf,
    pub data: Data,
}

impl Store {
    pub fn open(dir: impl Into<PathBuf>) -> std::io::Result<Self> {
        let dir = dir.into();
        let file = dir.join(FILE_NAME);
        fs::create_dir_all(&dir)?;
        let mut store = Self {
            backup: dir.join(format!("{FILE_NAME}.bak")),
            daily_dir: dir.join("backups"),
            file,
            dir,
            data: Data::default(),
        };
        store.data = store.load();
        Ok(store)
    }

    fn read_file(file: &Path) -> Result<Data, String> {
        let raw = fs::read_to_string(file).map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Data::from_value(&v)
    }

    fn load(&self) -> Data {
        if !self.file.exists() {
            return Data::default();
        }
        match Self::read_file(&self.file) {
            Ok(data) => data,
            Err(err) => {
                // 깨진 파일은 보관해 두고 백업본으로 복구 시도
                let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
                let broken = self.dir.join(format!("{FILE_NAME}.broken-{millis}"));
                let _ = fs::rename(&self.file, broken);
                eprintln!("데이터 파일을 읽지 못해 백업에서 복구합니다: {err}");
                // .bak → 최근 날짜별 백업 순으로, 처음 읽히는 것을 쓴다
                let mut candidates = vec![self.backup.clone()];
                candidates.extend(self.daily_backups().into_iter().rev());
                candidates.iter().find_map(|f| Self::read_file(f).ok()).unwrap_or_default()
            }
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        self.save_on(&today_str())
    }

    /// `today`: 날짜별 백업 파일 이름에 쓸 오늘 날짜(테스트용으로 따로 받음)
    pub fn save_on(&self, today: &str) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(&self.data).map_err(std::io::Error::other)?;
        let tmp = self.dir.join(format!("{FILE_NAME}.tmp"));
        fs::write(&tmp, json)?;
        if self.file.exists() {
            let _ = fs::copy(&self.file, &self.backup);
            self.save_daily_backup(today);
        }
        // Windows에서 백신 등이 파일을 잠깐 잡고 있으면 rename이 실패할 수 있어 몇 번 재시도
        let mut attempt = 0;
        loop {
            match fs::rename(&tmp, &self.file) {
                Ok(()) => return Ok(()),
                Err(err) if attempt >= 4 => return Err(err),
                Err(_) => {
                    attempt += 1;
                    std::thread::sleep(Duration::from_millis(50 * attempt));
                }
            }
        }
    }

    /// 날짜별 백업 파일 경로, 오래된 것부터
    pub fn daily_backups(&self) -> Vec<PathBuf> {
        let Ok(rd) = fs::read_dir(&self.daily_dir) else { return vec![] };
        let mut names: Vec<String> = rd
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| is_daily_name(n))
            .collect();
        names.sort();
        names.into_iter().map(|n| self.daily_dir.join(n)).collect()
    }

    /// 그날 처음 저장할 때, 저장 직전 상태(= 전날까지의 내용)를 하루 한 장 남기고 오래된 것은 지운다
    fn save_daily_backup(&self, today: &str) {
        let result = (|| -> std::io::Result<()> {
            let target = self.daily_dir.join(format!("calendar-data-{today}.json"));
            if target.exists() {
                return Ok(());
            }
            fs::create_dir_all(&self.daily_dir)?;
            fs::copy(&self.file, &target)?;
            let all = self.daily_backups();
            for old in &all[..all.len().saturating_sub(DAILY_KEEP)] {
                fs::remove_file(old)?;
            }
            Ok(())
        })();
        if let Err(err) = result {
            eprintln!("날짜별 백업 실패: {err}");
        }
    }

    /// 데이터를 바꾸는 작업을 실행하고 저장
    pub fn mutate<T>(&mut self, f: impl FnOnce(&mut Data) -> T) -> std::io::Result<T> {
        let result = f(&mut self.data);
        self.save()?;
        Ok(result)
    }
}
