//! Opening links, launching programs, and asking the user for a path.

use serde_json::{json, Value};
use std::path::Path;

pub fn open(url: &str) -> Result<(), String> {
    let lower = url.trim().to_lowercase();
    let scheme_ok = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("www.");
    if !scheme_ok {
        return Err("only http, https and mailto links can be opened".into());
    }
    shell_execute(url)
}

pub fn launch(path: &str) -> Result<(), String> {
    let path = crate::core::paths::expand_env(path);
    if path.trim().is_empty() {
        return Err("missing path".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }
    shell_execute(&path)
}

fn shell_execute(target: &str) -> Result<(), String> {
    use crate::platform::win32 as w;
    let op = w::wide("open");
    let file = w::wide(target);
    let result = unsafe {
        w::ShellExecuteW(
            0,
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as usize > 32 {
        Ok(())
    } else {
        Err(format!("Windows could not open \"{target}\""))
    }
}

/// Opens a shell folder such as `shell:RecycleBinFolder`.
pub fn open_shell_folder(spec: &str) -> Result<(), String> {
    shell_execute(spec)
}

/// Shows a file in Explorer with it selected; falls back to opening the folder.
pub fn reveal(path: &str) -> Result<(), String> {
    let path = crate::core::paths::expand_env(path);
    if !Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }
    use crate::platform::win32 as w;
    let verb = w::wide("open");
    let file = w::wide("explorer.exe");
    let params = w::wide(&format!("/select,\"{path}\""));
    let result = unsafe {
        w::ShellExecuteW(
            0,
            verb.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            1,
        )
    };
    if result as usize > 32 {
        Ok(())
    } else {
        match Path::new(&path).parent() {
            Some(dir) => shell_execute(&dir.to_string_lossy()),
            None => Err(format!("Windows could not show \"{path}\"")),
        }
    }
}

/// Runs a command line (used for the lock workstation verb).
pub fn launch_shell(command: &str) -> Result<(), String> {
    shell_execute(command)
}

/// Native open dialog; `kind` is "file" or "folder", `filter` narrows program/image picking.
pub fn pick(kind: &str, filter: &str, title: &str) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if !title.is_empty() {
        dialog = dialog.set_title(title);
    }
    match filter {
        "programs" => {
            dialog = dialog.add_filter("Programs", &["exe", "lnk", "bat", "cmd", "com"]);
            dialog = dialog.add_filter("All files", &["*"]);
        }
        "images" => {
            dialog = dialog.add_filter(
                "Images",
                &[
                    "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "tif", "tiff",
                ],
            );
        }
        _ => {}
    }
    let picked = if kind == "folder" {
        dialog.pick_folder()
    } else {
        dialog.pick_file()
    };
    picked.map(|p| p.to_string_lossy().to_string())
}

/// `{ path, exists, name, kind, icon }` — kind is "app", "folder", "file" or "missing".
pub fn info(path: &str, icon_size: i32) -> Value {
    let path = crate::core::paths::expand_env(path);
    let p = Path::new(&path);
    if path.trim().is_empty() || !p.exists() {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
        return json!({ "path": path, "exists": false, "name": name, "kind": "missing", "icon": Value::Null });
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let kind = if p.is_dir() {
        "folder"
    } else if p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_lowercase();
            ["exe", "lnk", "bat", "cmd", "com", "msi", "appref-ms"].contains(&e.as_str())
        })
        .unwrap_or(false)
    {
        "app"
    } else {
        "file"
    };
    let icon = crate::platform::win32::file_icon_data_url(&path, icon_size.max(16))
        .map(Value::String)
        .unwrap_or(Value::Null);
    json!({ "path": path, "exists": true, "name": name, "kind": kind, "icon": icon })
}

/// The user's shell folders, for the launcher widget's defaults.
pub fn paths() -> Value {
    let mut vars = serde_json::Map::new();
    for (key, var) in [
        ("home", "USERPROFILE"),
        ("desktop", "USERPROFILE"),
        ("documents", "USERPROFILE"),
        ("downloads", "USERPROFILE"),
        ("music", "USERPROFILE"),
        ("pictures", "USERPROFILE"),
    ] {
        let base = std::env::var(var).unwrap_or_default();
        let sub = match key {
            "home" => "".to_string(),
            other => format!("\\{other}"),
        };
        let guess = format!("{base}{sub}");
        let resolved = match key {
            "documents" => {
                let f = format!("{base}\\Documents");
                if Path::new(&f).is_dir() {
                    f
                } else {
                    format!("{base}\\OneDrive\\Documents")
                }
            }
            "downloads" => format!("{base}\\Downloads"),
            "music" => format!("{base}\\Music"),
            "pictures" => format!("{base}\\Pictures"),
            "desktop" => format!("{base}\\Desktop"),
            _ => guess,
        };
        vars.insert(key.to_string(), Value::String(resolved));
    }
    Value::Object(vars)
}
