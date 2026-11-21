//! The `file` category: reading and writing the files a page names itself.
//!
//! uTools plugins ran in a Node preload with `fs`, so a plug-in could load a source picture and
//! save its result. WinWidget pages have no Node and no `fs`, which is why picture tools such as
//! icon builders had nowhere to put their work. These methods close that gap, and they sit behind
//! two permissions so the user knows a widget may touch files outside its own folder:
//! `file.read` and `file.write`.
//!
//! `file.icon` belongs to the shell (`system::call`), so it is deliberately not listed here.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jbool, jstr, req_str, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const OWNS: &[&str] = &[
    "file.read",
    "file.readText",
    "file.exists",
    "file.info",
    "file.list",
    "file.write",
];

/// A read or a write above this is refused: a widget hands its bytes through the same pipe as
/// every other message, and 64 MB of base64 already is a 86 MB JSON document.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        "file.read" => {
            ctx.require("file.read")?;
            let path = absolute(&req_str(p, "path")?)?;
            ctx.spawn_reply(move || {
                let bytes = read_bytes(&path)?;
                Ok(json!({
                    "path": path.to_string_lossy(),
                    "name": name_of(&path),
                    "size": bytes.len(),
                    "modified": modified_ms(&path),
                    "base64": w::base64(&bytes),
                }))
            });
            Ok(Reply::Later)
        }
        "file.readText" => {
            ctx.require("file.read")?;
            let path = absolute(&req_str(p, "path")?)?;
            ctx.spawn_reply(move || {
                let bytes = read_bytes(&path)?;
                Ok(Value::String(crate::core::util::to_utf8_lossy(&bytes)))
            });
            Ok(Reply::Later)
        }
        "file.exists" => {
            ctx.require("file.read")?;
            let path = absolute(&req_str(p, "path")?)?;
            Ok(Reply::Now(Value::Bool(path.is_file())))
        }
        "file.info" => {
            ctx.require("file.read")?;
            let path = absolute(&req_str(p, "path")?)?;
            Ok(Reply::Now(info_value(&path)))
        }
        "file.list" => {
            ctx.require("file.read")?;
            let dir = absolute(&req_str(p, "dir")?)?;
            let recursive = jbool(p, "recursive").unwrap_or(false);
            // No `url` on the entries: these files live anywhere, not in a folder the card owns, so
            // a page that wants to show one reads it with `file.read` and makes its own blob.
            Ok(Reply::Now(list_value(&dir, recursive)))
        }
        "file.write" => {
            ctx.require("file.write")?;
            let path = absolute(&req_str(p, "path")?)?;
            let bytes = match payload_bytes(p)? {
                Some(bytes) => bytes,
                None => return Err(BridgeError::new("no data to write")),
            };
            if bytes.len() as u64 > MAX_BYTES {
                return Err(BridgeError::new("too much data to write (64 MB at most)"));
            }
            ctx.spawn_reply(move || {
                let existed = path.is_file();
                write_bytes(&path, &bytes)?;
                Ok(json!({
                    "path": path.to_string_lossy(),
                    "name": name_of(&path),
                    "size": bytes.len(),
                    "existed": existed,
                }))
            });
            Ok(Reply::Later)
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// The bytes to write: `text`, raw `base64`, or a `data:` URL. Nothing else is accepted, so a page
/// cannot accidentally write the literal string "undefined".
fn payload_bytes(p: &Value) -> BridgeResult<Option<Vec<u8>>> {
    if let Some(url) = jstr(p, "dataUrl") {
        return crate::core::clipboard::read_image_source(&url).map(Some);
    }
    if let Some(b64) = jstr(p, "base64") {
        let body = b64.split_once(',').map(|(_, b)| b).unwrap_or(&b64);
        return w::base64_decode(body)
            .map(Some)
            .ok_or_else(|| BridgeError::new("invalid base64 data"));
    }
    if p.get("text").is_some() {
        let text = jstr(p, "text").unwrap_or_default();
        return Ok(Some(text.into_bytes()));
    }
    Ok(None)
}

/// An absolute path with `%VAR%` already expanded. Relative paths are refused: a card has no
/// working folder, so "cat.png" would land wherever the host happens to run.
pub fn absolute(raw: &str) -> BridgeResult<PathBuf> {
    let text = crate::core::paths::expand_env(raw);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(BridgeError::new("path is empty"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(BridgeError::new(format!(
            "path must be absolute: {trimmed}"
        )));
    }
    Ok(path)
}

pub fn read_bytes(path: &Path) -> BridgeResult<Vec<u8>> {
    let meta = std::fs::metadata(path)
        .map_err(|_| BridgeError::new(format!("no such file: {}", path.to_string_lossy())))?;
    if meta.is_dir() {
        return Err(BridgeError::new("this is a folder, not a file"));
    }
    if meta.len() > MAX_BYTES {
        return Err(BridgeError::new("file too large to read (64 MB at most)"));
    }
    std::fs::read(path).map_err(|e| BridgeError::new(format!("read failed: {e}")))
}

pub fn write_bytes(path: &Path, bytes: &[u8]) -> BridgeResult<()> {
    if path.is_dir() {
        return Err(BridgeError::new("this is a folder, not a file"));
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| BridgeError::new(format!("cannot create folder: {e}")))?;
        }
    }
    std::fs::write(path, bytes).map_err(|e| BridgeError::new(format!("write failed: {e}")))
}

pub fn info_value(path: &Path) -> Value {
    let meta = std::fs::metadata(path).ok();
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    json!({
        "path": path.to_string_lossy(),
        "name": name_of(path),
        "dir": path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "ext": path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default(),
        "size": size,
        "modified": modified_ms(path),
        "exists": meta.is_some(),
        "isDir": is_dir,
        "isFile": meta.as_ref().map(|m| m.is_file()).unwrap_or(false),
    })
}

/// A folder listing, in the same `{ folder, name, files, more }` shape `files.list` answers, plus
/// `isDir` and the size on every entry. Hidden files are skipped; six levels is the limit, as in
/// the picture folder.
pub fn list_value(dir: &Path, recursive: bool) -> Value {
    let folder = dir.to_string_lossy().to_string();
    let name = name_of(dir);
    if !dir.is_dir() {
        return json!({ "folder": folder, "name": name, "files": [], "more": false, "missing": true });
    }
    let mut files: Vec<Value> = Vec::new();
    let mut more = false;
    walk(dir, recursive, &mut files, &mut more, 0);
    files.sort_by(|a, b| {
        let pa = a.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let pb = b.get("path").and_then(|v| v.as_str()).unwrap_or("");
        pa.to_lowercase().cmp(&pb.to_lowercase())
    });
    json!({ "folder": folder, "name": name, "files": files, "more": more })
}

fn walk(dir: &Path, recursive: bool, out: &mut Vec<Value>, more: &mut bool, depth: usize) {
    if depth > 6 || out.len() >= 5000 {
        *more = true;
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false);
        if hidden {
            continue;
        }
        if path.is_dir() {
            if recursive {
                walk(&path, true, out, more, depth + 1);
            }
            let mut row = crate::platform::files::file_entry(&path);
            if let Some(obj) = row.as_object_mut() {
                obj.insert("isDir".into(), Value::Bool(true));
            }
            out.push(row);
            continue;
        }
        if out.len() >= 5000 {
            *more = true;
            return;
        }
        let mut row = crate::platform::files::file_entry(&path);
        if let Some(obj) = row.as_object_mut() {
            obj.insert("isDir".into(), Value::Bool(false));
        }
        out.push(row);
    }
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn modified_ms(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
