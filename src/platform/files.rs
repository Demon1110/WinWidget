//! The folder a widget may show pictures from (`files.list` / `files.url` / `files.info`), and the
//! thumbnail service behind `/__files/…?w=…` and `/__media/cover/…`.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const IMAGE_TYPES: [&str; 12] = [
    "jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "avif", "heic", "heif", "tif", "tiff",
];
const MAX_LIST: usize = 5000;

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_TYPES.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// The folder a setting points at (empty when the widget has no folder set).
pub fn folder_from_setting(value: Option<&Value>) -> PathBuf {
    let raw = value
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Object(o) => o.get("path").and_then(|p| p.as_str()).map(|s| s.to_string()),
            _ => None,
        })
        .unwrap_or_default();
    PathBuf::from(raw)
}

pub fn list(folder: &Path, recursive: bool) -> Value {
    let folder_display = folder.to_string_lossy().to_string();
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_display.clone());
    if !folder.is_dir() {
        return json!({ "folder": folder_display, "name": name, "files": [], "more": false, "missing": true });
    }
    let mut files: Vec<Value> = Vec::new();
    let mut more = false;
    collect(folder, recursive, &mut files, &mut more, 0);
    files.sort_by(|a, b| {
        let ka = a.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let kb = b.get("path").and_then(|v| v.as_str()).unwrap_or("");
        ka.to_lowercase().cmp(&kb.to_lowercase())
    });
    json!({ "folder": folder_display, "name": name, "files": files, "more": more })
}

fn collect(dir: &Path, recursive: bool, out: &mut Vec<Value>, more: &mut bool, depth: usize) {
    if depth > 6 || out.len() >= MAX_LIST {
        *more = true;
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if recursive && !is_hidden(&path) {
                collect(&path, true, out, more, depth + 1);
            }
            continue;
        }
        if !is_image(&path) {
            continue;
        }
        if out.len() >= MAX_LIST {
            *more = true;
            return;
        }
        out.push(file_entry(&path));
    }
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

pub fn file_entry(path: &Path) -> Value {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    json!({
        "path": path.to_string_lossy().to_string(),
        "name": name,
        "size": size,
        "modified": modified,
        "url": Value::Null,
    })
}

/// `{taken, width, height}` for a photo, including the capture time when the file carries one.
pub fn info(path: &Path) -> Value {
    let dims = crate::img::dimensions(path);
    let taken = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    json!({
        "taken": taken,
        "width": dims.map(|d| d.0).unwrap_or(0),
        "height": dims.map(|d| d.1).unwrap_or(0),
    })
}

/// Reads a thumbnail for the HTTP layer; `width` = 0 keeps the original size.
pub fn thumbnail(path: &Path, width: u32) -> Option<Vec<u8>> {
    if width == 0 {
        crate::img::thumbnail(path, u32::MAX).ok()
    } else {
        crate::img::thumbnail(path, width).ok()
    }
}
