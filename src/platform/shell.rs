//! Opening links, launching programs, and asking the user for a path.

use serde_json::{json, Value};
use std::path::Path;

pub fn open(url: &str) -> Result<(), String> {
    if !is_link(url) {
        return Err("only http, https and mailto links can be opened".into());
    }
    shell_execute(url)
}

/// True for a web or mail link. A folder path is not one, which is why every "open this folder"
/// button has to go through `open_path`/`open_any` instead of `open`.
fn is_link(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("www.")
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

/// Opens a folder (or a file) that is on this machine: a folder comes up in Explorer, a file in the
/// app Windows associates with it. `open()` above takes links only, which is why the settings buttons
/// for "widgets folder" and "data" reported a failure.
pub fn open_path(path: &str) -> Result<(), String> {
    let path = crate::core::paths::expand_env(path);
    if path.trim().is_empty() {
        return Err("missing path".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }
    shell_execute(&path)
}

/// `utools.shellOpenPath` and "open this widget's folder": a link goes to the browser, anything else
/// is a path on this machine. Widgets call this with `D:\...\widgets\clipboard`, which `open()`
/// refused as "not a link".
pub fn open_any(target: &str) -> Result<(), String> {
    if is_link(target) {
        return shell_execute(target.trim());
    }
    open_path(target)
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

/// Native save dialog. `filter` is "images", "text", "json" or "all"; `name` may carry a folder.
pub fn save(title: &str, name: &str, filter: &str) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if !title.is_empty() {
        dialog = dialog.set_title(title);
    }
    if !name.is_empty() {
        let p = Path::new(name);
        if let (Some(dir), Some(file)) = (p.parent(), p.file_name()) {
            if !dir.as_os_str().is_empty() && dir.is_dir() {
                dialog = dialog.set_directory(dir);
            }
            dialog = dialog.set_file_name(file.to_string_lossy().to_string());
        } else {
            dialog = dialog.set_file_name(name);
        }
    }
    match filter {
        "images" => {
            dialog = dialog.add_filter(
                "Images",
                &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"],
            );
        }
        "text" => {
            dialog = dialog.add_filter("Text", &["txt", "md", "log"]);
            dialog = dialog.add_filter("All files", &["*"]);
        }
        "json" => {
            dialog = dialog.add_filter("JSON", &["json"]);
            dialog = dialog.add_filter("All files", &["*"]);
        }
        _ => {}
    }
    dialog
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// Moves a file or folder to the recycle bin, so a mistake is still recoverable.
pub fn trash(path: &str) -> bool {
    let path = crate::core::paths::expand_env(path);
    let p = Path::new(&path);
    if path.trim().is_empty() || !p.exists() {
        return false;
    }
    crate::platform::win32::recycle_path(p)
}

/// A file icon as a data URL. Accepts a real path, an extension such as ".pdf", or "folder".
pub fn icon(spec: &str, size: i32) -> Option<String> {
    let size = size.clamp(16, 256);
    if spec.eq_ignore_ascii_case("folder") {
        // Any always-present directory gives the shell's folder icon.
        return crate::platform::win32::file_icon_data_url(
            &std::env::temp_dir().to_string_lossy(),
            size,
        );
    }
    if let Some(ext) = spec.strip_prefix('.') {
        // Windows only draws a file-type icon over a real file of that type: borrow an empty one.
        let ext = ext.trim();
        if ext.is_empty() || ext.contains(['\\', '/', ':']) {
            return None;
        }
        let dir = std::env::temp_dir().join("winwidget-icon");
        std::fs::create_dir_all(&dir).ok()?;
        let probe = dir.join(format!("probe.{ext}"));
        if !probe.exists() {
            std::fs::write(&probe, b"").ok()?;
        }
        let icon = crate::platform::win32::file_icon_data_url(&probe.to_string_lossy(), size);
        let _ = std::fs::remove_file(&probe);
        return icon;
    }
    crate::platform::win32::file_icon_data_url(spec, size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_rejects_names_that_are_not_paths_or_extensions() {
        // A path that does not exist has no icon; neither has an extension with separators in it.
        assert!(icon("C:\\definitely\\not\\here\\nope.xyz", 32).is_none());
        assert!(icon(".p/n", 32).is_none());
        assert!(icon(".", 32).is_none());
    }

    #[test]
    fn known_folders_resolve_to_absolute_paths() {
        for name in ["home", "desktop", "documents", "downloads", "temp"] {
            let path = crate::platform::win32::known_folder_path(name);
            assert!(path.is_some(), "{name} should resolve");
            let path = path.unwrap();
            assert!(Path::new(&path).is_absolute(), "{name} → {path}");
        }
        assert!(crate::platform::win32::known_folder_path("nope").is_none());
    }

    #[test]
    fn a_widget_folder_is_not_a_link_but_is_openable() {
        // The "folder" button used to run a folder path through `open`, which only accepts links.
        let folder = "C:\\Users\\admin\\AppData\\Roaming\\WinWidget\\widgets\\clipboard";
        assert!(!is_link(folder), "a folder must not look like a link");
        // `open_path` is the door a folder takes; for something that is not there it fails on the
        // missing folder rather than on the scheme, without launching Explorer.
        let missing = "C:\\definitely\\not\\here\\folder";
        assert!(!is_link(missing));
        match open_path(missing) {
            Err(e) => assert!(e.contains("does not exist"), "{e}"),
            Ok(()) => panic!("a missing folder should not open"),
        }
        for link in ["https://example.com", "HTTPS://example.com", " mailto:a@b.c", "www.example.com"] {
            assert!(is_link(link), "{link} should be a link");
        }
        for text in [r"D:\java\git", "/home/user", "C:a.txt", ""] {
            assert!(!is_link(text), "{text} should not be a link");
        }
    }
}

