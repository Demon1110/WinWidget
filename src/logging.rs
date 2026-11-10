//! Logging to `%LocalAppData%\WinWidget\logs\app.log`, plus stderr when a console is attached.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

static LOG_FILE: OnceLock<Mutex<Option<std::fs::File>>> = OnceLock::new();

fn file() -> &'static Mutex<Option<std::fs::File>> {
    LOG_FILE.get_or_init(|| Mutex::new(None))
}

pub fn init(path: PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let handle = OpenOptions::new().create(true).append(true).open(&path).ok();
    *file().lock().unwrap() = handle;
    info(&format!("WinWidget {} starting", crate::APP_VERSION));
    info(&format!("log file: {}", path.display()));
}

fn write_line(level: &str, msg: &str) {
    let line = format!("[{}] {level}: {msg}\n", timestamp());
    if let Ok(mut guard) = file().lock() {
        if let Some(f) = guard.as_mut() {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
    }
    eprintln!("{}", line.trim_end());
}

fn timestamp() -> String {
    // Local time without pulling in a date crate: Windows' own formatting through chrono-less maths.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let local = now + crate::platform::utc_offset_seconds();
    let secs = local.rem_euclid(86_400);
    let days = local.div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}",
        secs / 3600,
        (secs / 60) % 60,
        secs % 60
    )
}

// Howard Hinnant's days→civil algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

pub fn info(msg: &str) {
    write_line("info", msg);
}

pub fn warn(msg: &str) {
    write_line("warn", msg);
}

pub fn error(msg: &str) {
    write_line("error", msg);
}
