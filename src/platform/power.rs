//! The recycle bin and the power menu. Both are promised only to the built-in widgets, matching
//! how FullWidget keeps machine-wide actions out of third-party widgets.

use crate::platform::win32 as w;
use serde_json::{json, Value};
use std::path::Path;

pub fn recycle_query() -> Value {
    let mut info = w::SHQUERYRBINFO {
        cbSize: std::mem::size_of::<w::SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    let ok = unsafe { w::SHQueryRecycleBinW(std::ptr::null(), &mut info) } == 0;
    json!({
        "available": true,
        "items": if ok { info.i64NumItems } else { 0 },
        "size": if ok { info.i64Size } else { 0 },
    })
}

pub fn recycle_empty() -> Result<Value, String> {
    let flags = 0x0000_0001 | 0x0000_0002; // NOCONFIRMATION | NOPROGRESSUI
    let code = unsafe { w::SHEmptyRecycleBinW(0, std::ptr::null(), flags) };
    if code == 0 || code as u32 == 0x8000_FFFF {
        Ok(json!({ "ok": true }))
    } else {
        Err("the recycle bin could not be emptied".into())
    }
}

pub fn recycle_open() -> Result<(), String> {
    crate::platform::shell::open_shell_folder("shell:RecycleBinFolder")
}

/// `shutdown` | `restart` | `sleep` | `hibernate` | `lock` | `signout`.
pub fn do_power(action: &str) -> Result<Value, String> {
    const EWX_SHUTDOWN: u32 = 0x0000_0001;
    const EWX_REBOOT: u32 = 0x0000_0002;
    const EWX_LOGOFF: u32 = 0x0000_0000;
    const EWX_FORCE: u32 = 0x0000_0004;
    match action {
        "shutdown" => {
            unsafe { w::ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "restart" => {
            unsafe { w::ExitWindowsEx(EWX_REBOOT | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "signout" => {
            unsafe { w::ExitWindowsEx(EWX_LOGOFF | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "sleep" => {
            unsafe { w::SetSuspendState(0, 1, 0) };
            Ok(json!({ "ok": true }))
        }
        "hibernate" => {
            unsafe { w::SetSuspendState(1, 1, 0) };
            Ok(json!({ "ok": true }))
        }
        "lock" => {
            crate::platform::shell::launch_shell("rundll32.exe user32.dll,LockWorkStation")?;
            Ok(json!({ "ok": true }))
        }
        other => Err(format!("unknown power action '{other}'")),
    }
}

/// Kept here so the shell module doesn't need to know about power-menu verbs.
pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}
