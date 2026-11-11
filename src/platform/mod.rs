//! Everything that talks to Windows: locale, time zone, autostart, fonts, the tray and hotkeys,
//! plus the providers behind the widget API (system, audio, media, shell).

pub mod audio;
pub mod chinese;
pub mod files;
pub mod guides;
pub mod media;
pub mod power;
pub mod shell;
pub mod sysinfo;
pub mod tray;
pub mod update;
pub mod win32;

impl From<win32::SYSTEMTIME> for (u16, u16, u16) {
    fn from(t: win32::SYSTEMTIME) -> Self {
        (t.wYear, t.wMonth, t.wDay)
    }
}

/// Local time as `YYYYMMDD-HHMMSS`, for backup file names.
pub fn now_stamp() -> String {
    let mut t = win32::SYSTEMTIME::default();
    unsafe {
        win32::GetLocalTime(&mut t);
    }
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

/// Offset from UTC in seconds (including daylight saving), for log timestamps.
pub fn utc_offset_seconds() -> i64 {
    let mut info = win32::TIME_ZONE_INFORMATION::default();
    let result = unsafe { win32::GetTimeZoneInformation(&mut info) };
    let bias = info.Bias as i64;
    if result == 2 {
        // TIME_ZONE_ID_DAYLIGHT
        bias + info.DaylightBias as i64
    } else {
        bias + info.StandardBias as i64
    }
    .wrapping_neg()
        * 60
}

/// Windows' UI language mapped onto the three the widgets speak.
pub fn locale() -> String {
    let mut buf = [0u16; 85];
    let n = unsafe { win32::GetUserDefaultLocaleName(buf.as_mut_ptr(), 85) };
    let tag = if n > 1 {
        String::from_utf16_lossy(&buf[..(n - 1) as usize])
    } else {
        "en-US".to_string()
    };
    let lower = tag.to_lowercase();
    if lower.starts_with("zh") {
        if lower.contains("hans") || lower.ends_with("-cn") || lower.ends_with("-sg") {
            "zh-CN".to_string()
        } else if lower.contains("hant")
            || lower.ends_with("-tw")
            || lower.ends_with("-hk")
            || lower.ends_with("-mo")
        {
            "zh-TW".to_string()
        } else {
            "zh-CN".to_string()
        }
    } else if lower.starts_with("en") {
        "en".to_string()
    } else {
        // Widgets ship English text as well; other languages fall back to it.
        "en".to_string()
    }
}

// ── autostart ───────────────────────────────────────────────────────────────

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "WinWidget";

pub fn autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(RUN_KEY)
        .ok()
        .and_then(|k| k.get_value::<String, _>(RUN_NAME).ok())
        .is_some()
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .map_err(|e| e.to_string())?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\" --startup", exe.display());
        key.set_value(RUN_NAME, &value).map_err(|e| e.to_string())
    } else {
        match key.delete_value(RUN_NAME) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ── fonts ───────────────────────────────────────────────────────────────────

/// Font families installed for this user, sorted — feeds the control center's font list.
pub fn fonts() -> Vec<String> {
    use std::collections::BTreeSet;
    use std::path::Path;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut names: BTreeSet<String> = BTreeSet::new();
    let sources = [
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        ),
        (
            RegKey::predef(HKEY_CURRENT_USER),
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        ),
    ];
    for (root, path) in sources {
        if let Ok(key) = root.open_subkey(path) {
            for item in key.enum_values().flatten() {
                let (raw, _) = item;
                // "Segoe UI (TrueType)" / "Segoe UI Bold (TrueType)" — take the family part.
                let family = raw
                    .split(" (")
                    .next()
                    .unwrap_or(&raw)
                    .replace(" Bold", "")
                    .replace(" Italic", "")
                    .replace(" Light", "")
                    .replace(" Semibold", "")
                    .replace(" Semilight", "")
                    .trim()
                    .to_string();
                if !family.is_empty() {
                    names.insert(family);
                }
            }
        }
    }
    // A few fonts that Windows may register under a file name only.
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
    for folder in [Path::new(&windir).join("Fonts")] {
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    if stem.len() > 3
                        && stem
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_alphabetic())
                            .unwrap_or(false)
                    {
                        let pretty = stem.replace(['-', '_'], " ");
                        if pretty.chars().any(|c| c.is_ascii_uppercase()) {
                            names.insert(pretty);
                        }
                    }
                }
            }
        }
    }
    names.into_iter().collect()
}

/// Blocks a second copy of WinWidget from starting; the handle lives for the whole process.
///
/// `Err(())` is the only failure and it means "another copy is already running", so there is
/// nothing to carry in an error value.
#[allow(clippy::result_unit_err)]
pub fn single_instance() -> Result<(), ()> {
    let name = win32::wide("WinWidget.SingleInstance");
    let handle = unsafe { win32::CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if handle == 0 {
        return Ok(()); // could not create one: run anyway rather than fail closed
    }
    if unsafe { win32::GetLastError() } == 183 {
        // ERROR_ALREADY_EXISTS: another WinWidget owns the handle.
        return Err(());
    }
    Ok(())
}

/// Brings the running copy's control center forward without starting a second process.
pub fn open_control_center() {
    use std::thread::sleep;
    use std::time::Duration;
    let class = tray::TRAY_CLASS;
    for _ in 0..12 {
        let hwnd = win32::find_window_by_class(class);
        if hwnd != 0 {
            unsafe {
                win32::PostMessageW(hwnd, tray::ASK_CONTROL, 0, 0);
            }
            return;
        }
        sleep(Duration::from_millis(250));
    }
    // No tray window means the other copy is still starting; nothing else to do.
}

pub fn message_box(title: &str, body: &str) {
    let text = win32::wide(body);
    let caption = win32::wide(title);
    unsafe {
        win32::MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x10);
    }
}
