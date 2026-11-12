//! 复制 category: text, files and pictures on the Windows clipboard.
//!
//! uTools has `copyText`, `copyFile`, `copyImage` and `getCopiedFiles`; WinWidget's own
//! `widget.clipboard.readText/writeText` are the text pair of the same thing, so both names are
//! answered here instead of being scattered.
//!
//! It also keeps a **history** (`clipboard.history`): watched while any page asks for it, stored in
//! `data/clipboard-history.json`. uTools' 剪贴板 plugin keeps its records behind a preload script,
//! which cannot run here (no Node), so the host owns the records instead and the page reads them
//! through the same method names — see `assets/sdk/services.js`.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const OWNS: &[&str] = &[
    "clipboard.readText",
    "clipboard.writeText",
    "clipboard.readImage",
    "clipboard.writeImage",
    "clipboard.readFiles",
    "clipboard.writeFiles",
    "clipboard.history",
    "clipboard.history.stats",
    "clipboard.history.pin",
    "clipboard.history.remove",
    "clipboard.history.clear",
    "clipboard.recopy",
    "clipboard.image",
    "clipboard.filesExist",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        "clipboard.readText" => {
            ctx.require("clipboard")?;
            Ok(Reply::Now(match w::clipboard_text() {
                Some(text) => Value::String(text),
                None => Value::Null,
            }))
        }
        "clipboard.writeText" => {
            ctx.require("clipboard")?;
            let text = jstr(p, "text").unwrap_or_default();
            Ok(Reply::Now(Value::Bool(w::set_clipboard_text(&text)) ))
        }
        "clipboard.readImage" => {
            ctx.require("clipboard")?;
            Ok(Reply::Now(match w::clipboard_png() {
                Some(png) => Value::String(format!("data:image/png;base64,{}", w::base64(&png))),
                None => Value::Null,
            }))
        }
        "clipboard.writeImage" => {
            ctx.require("clipboard")?;
            // Decoding a PNG can take a moment on a big picture; it goes to a worker so the card
            // does not freeze, and the answer comes back like any other.
            let image = jstr(p, "image").unwrap_or_default();
            let raw = p.get("bytes").and_then(|b| b.as_array()).map(|a| {
                a.iter()
                    .filter_map(|v| v.as_u64().map(|n| n as u8))
                    .collect::<Vec<u8>>()
            });
            ctx.spawn_reply(move || {
                let bytes = match (raw, image.is_empty()) {
                    (Some(bytes), _) => bytes,
                    (None, false) => read_image_source(&image)?,
                    _ => return Err(BridgeError::new("no image data")),
                };
                Ok(json!(w::set_clipboard_png(&bytes)))
            });
            Ok(Reply::Later)
        }
        "clipboard.readFiles" => {
            ctx.require("clipboard")?;
            let files = w::clipboard_files();
            if files.is_empty() {
                return Ok(Reply::Now(Value::Null));
            }
            let list: Vec<Value> = files
                .into_iter()
                .map(|path| {
                    let meta = std::fs::metadata(&path).ok();
                    let name = std::path::Path::new(&path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                    json!({
                        "path": path,
                        "isDirectory": is_dir,
                        "isFile": !is_dir,
                        "name": name,
                    })
                })
                .collect();
            Ok(Reply::Now(Value::Array(list)))
        }
        "clipboard.writeFiles" => {
            ctx.require("clipboard")?;
            let paths: Vec<String> = match p.get("paths") {
                Some(Value::Array(a)) => a
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect(),
                Some(Value::String(s)) => vec![s.clone()],
                _ => Vec::new(),
            };
            Ok(Reply::Now(Value::Bool(w::set_clipboard_files(&paths))))
        }
        "clipboard.history" => {
            ctx.require("clipboard")?;
            watch();
            let want = jstr(p, "type").unwrap_or_else(|| "all".into());
            let pinned_only = p.get("pinned").and_then(|v| v.as_bool());
            let limit = p.get("limit").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let list: Vec<Value> = history()
                .into_iter()
                .filter(|r| type_of(r) == want || want == "all" || want.is_empty())
                .filter(|r| match pinned_only {
                    Some(want_pinned) => is_pinned(r) == want_pinned,
                    None => true,
                })
                .take(if limit == 0 { usize::MAX } else { limit })
                .collect();
            publish_images(ctx, &list);
            Ok(Reply::Now(Value::Array(list)))
        }
        "clipboard.history.stats" => {
            ctx.require("clipboard")?;
            watch();
            let records = history();
            let mut counts = json!({ "all": records.len(), "text": 0, "image": 0, "files": 0, "pinned": 0 });
            for record in &records {
                if let Some(object) = counts.as_object_mut() {
                    let key = type_of(record);
                    let bumped = object.get(&key).and_then(|v| v.as_u64()).unwrap_or(0) + 1;
                    object.insert(key, json!(bumped));
                    if is_pinned(record) {
                        let pinned = object.get("pinned").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
                        object.insert("pinned".into(), json!(pinned));
                    }
                }
            }
            Ok(Reply::Now(counts))
        }
        "clipboard.history.pin" => {
            ctx.require("clipboard")?;
            let ids = ids_of(p);
            let pinned = p.get("pinned").and_then(|v| v.as_bool()).unwrap_or(true);
            let mut touched = 0u64;
            let kept = {
                let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
                for record in guard.iter_mut() {
                    let id = record.get("_id").and_then(|v| v.as_str()).unwrap_or_default();
                    if ids.iter().any(|x| x == id) {
                        if let Some(object) = record.as_object_mut() {
                            object.insert("pinned".into(), Value::Bool(pinned));
                            touched += 1;
                        }
                    }
                }
                guard.clone()
            };
            save(&kept);
            Ok(Reply::Now(json!({ "ok": true, "pinned": pinned, "changed": touched })))
        }
        "clipboard.history.remove" => {
            ctx.require("clipboard")?;
            let ids = ids_of(p);
            let kept = {
                let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
                guard.retain(|r| {
                    let id = r.get("_id").and_then(|v| v.as_str()).unwrap_or_default();
                    !ids.iter().any(|x| x == id)
                });
                guard.clone()
            };
            save(&kept);
            Ok(Reply::Now(json!({ "ok": true, "removed": ids.len() })))
        }
        "clipboard.history.clear" => {
            ctx.require("clipboard")?;
            let keep_pinned = p.get("keepPinned").and_then(|v| v.as_bool()).unwrap_or(false);
            let kept = {
                let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
                if keep_pinned {
                    guard.retain(|r| is_pinned(r));
                } else {
                    guard.clear();
                }
                guard.clone()
            };
            save(&kept);
            Ok(Reply::Now(json!({ "ok": true, "kept": kept.len() })))
        }
        // Put a record back on the system clipboard. That is what the list's copy button does, and
        // what "paste" does before it presses Ctrl+V.
        "clipboard.recopy" => {
            ctx.require("clipboard")?;
            let record = find_record(p).ok_or_else(|| BridgeError::new("no such record"))?;
            let kind = type_of(&record);
            let done = match kind.as_str() {
                "files" => {
                    let paths: Vec<String> = record
                        .get("value")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.get("path").and_then(|v| v.as_str()))
                                .map(|s| s.to_string())
                                .collect()
                        })
                        .unwrap_or_default();
                    w::set_clipboard_files(&paths)
                }
                "image" => image_bytes(&record)
                    .map(|bytes| w::set_clipboard_png(&bytes))
                    .unwrap_or(false),
                _ => w::set_clipboard_text(
                    record.get("value").and_then(|v| v.as_str()).unwrap_or_default(),
                ),
            };
            Ok(Reply::Now(json!({ "ok": done })))
        }
        // The picture a record stands for, as a data URL — enough for a page to show it without
        // needing an attachment store.
        "clipboard.image" => {
            ctx.require("clipboard")?;
            let record = find_record(p).ok_or_else(|| BridgeError::new("no such record"))?;
            match image_bytes(&record) {
                Some(bytes) => Ok(Reply::Now(Value::String(format!(
                    "data:image/png;base64,{}",
                    w::base64(&bytes)
                )))),
                None => Err(BridgeError::new("record has no picture")),
            }
        }
        "clipboard.filesExist" => {
            ctx.require("clipboard")?;
            let paths: Vec<String> = p
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let answer: Vec<Value> = paths
                .iter()
                .map(|path| Value::Bool(std::path::Path::new(path).exists()))
                .collect();
            Ok(Reply::Now(Value::Array(answer)))
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

// ── history ────────────────────────────────────────────────────────────────
//
// One JSON file, newest first, capped at `MAX`. Records use the shape uTools' 剪贴板 plugin reads
// from its preload: `{_id, hash, type, value, timestamp, size, pinned}`, where `type` is `text`,
// `files` or `image`. `files` values are `{name, path, isFile, isDirectory}`; pictures are stored
// as PNG next to the index (see `image_dir`) and carry the file path in `value`.

const MAX: usize = 300;
/// A picture is not a string: keep the bytes out of the index file and cap how big one may be.
const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

fn history_file() -> std::path::PathBuf {
    crate::core::paths::data_dir().join("clipboard-history.json")
}

fn image_dir() -> std::path::PathBuf {
    crate::core::paths::data_dir().join("clipboard").join("images")
}

/// `text` / `files` / `image`, in the words the plugin's tabs use.
fn type_of(record: &Value) -> String {
    record
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("text")
        .to_string()
}

fn is_pinned(record: &Value) -> bool {
    record
        .get("pinned")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// `ids`, `id` or `hash` — the three ways a caller names a record.
fn ids_of(p: &Value) -> Vec<String> {
    if let Some(Value::Array(a)) = p.get("ids") {
        return a
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    jstr(p, "id").or_else(|| jstr(p, "hash")).into_iter().collect()
}

fn find_record(p: &Value) -> Option<Value> {
    let ids = ids_of(p);
    if ids.is_empty() {
        return None;
    }
    history().into_iter().find(|r| {
        let id = r.get("_id").and_then(|v| v.as_str()).unwrap_or_default();
        let hash = r.get("hash").and_then(|v| v.as_str()).unwrap_or_default();
        ids.iter().any(|x| x == id || x == hash)
    })
}

/// The PNG behind a picture record, either from `value` (a path) or from the `hash` file name.
/// Puts the pictures of the list into the *calling widget's* attachment store, so the plugin's own
/// `utools.db.getAttachment("attachment/<hash>")` finds them. Doing it here keeps the bytes off
/// the bridge: a page that had to upload them itself moved a few hundred kilobytes through JSON on
/// every cold start, which is exactly the kind of pause that reads as "the window froze".
fn publish_images(ctx: &Ctx, list: &[Value]) {
    let store = crate::core::db::Store::for_widget(&ctx.manifest.id);
    for record in list {
        if type_of(record) != "image" {
            continue;
        }
        let hash = record.get("hash").and_then(|v| v.as_str()).unwrap_or_default();
        if hash.is_empty() {
            continue;
        }
        if let Some(bytes) = image_bytes(record) {
            store.ensure_attachment(&format!("attachment/{hash}"), "image/png", &bytes);
        }
    }
}

/// The PNG behind a picture record, either from `value` (a path) or from the `hash` file name.
fn image_bytes(record: &Value) -> Option<Vec<u8>> {
    if type_of(record) != "image" {
        return None;
    }
    let value = record.get("value").and_then(|v| v.as_str()).unwrap_or_default();
    let hash = record.get("hash").and_then(|v| v.as_str()).unwrap_or_default();
    let candidate = if value.is_empty() {
        image_dir().join(format!("{hash}.png"))
    } else {
        std::path::PathBuf::from(value)
    };
    let bytes = std::fs::read(candidate).ok()?;
    if bytes.is_empty() {
        None
    } else {
        Some(bytes)
    }
}

fn store() -> &'static Mutex<Vec<Value>> {
    static CELL: OnceLock<Mutex<Vec<Value>>> = OnceLock::new();
    CELL.get_or_init(|| {
        let text = std::fs::read_to_string(history_file()).unwrap_or_default();
        Mutex::new(serde_json::from_str::<Vec<Value>>(&text).unwrap_or_default())
    })
}

fn history() -> Vec<Value> {
    store().lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn save(records: &[Value]) {
    let file = history_file();
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(records) {
        let _ = std::fs::write(file, text);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A stable id for the same bytes: FNV-1a over the UTF-8 payload, 16 hex digits.
fn fingerprint(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Watches the clipboard while a page wants the history, so copying something anywhere on the
/// desktop shows up in the list. Started by the first `clipboard.history` call.
fn watch() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(700));
            record_now();
        });
    });
}

/// Windows bumps this counter on every clipboard change. Reading the clipboard means opening it
/// (which fails whenever another app holds it), and a picture has to be decoded and re-encoded to
/// PNG — doing that three times a second pegs a core for no reason. So nothing is read until the
/// counter actually moves.
static LAST_SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(u32::MAX);

fn record_now() {
    let seq = w::clipboard_sequence();
    if seq != 0
        && LAST_SEQ.swap(seq, std::sync::atomic::Ordering::Relaxed) == seq
    {
        return;
    }
    let text = w::clipboard_text().unwrap_or_default();
    let files = w::clipboard_files();
    if text.trim().is_empty() && files.is_empty() {
        // Nothing textual: a screenshot on the clipboard is the third kind of record.
        if let Some(png) = w::clipboard_png() {
            if png.len() <= MAX_IMAGE_BYTES {
                push_image(&png);
            }
        }
        return;
    }
    let record = if !files.is_empty() {
        let list: Vec<Value> = files
            .iter()
            .map(|path| {
                let p = std::path::Path::new(path);
                json!({
                    "path": path,
                    "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    "isFile": p.is_file(),
                    "isDirectory": p.is_dir(),
                })
            })
            .collect();
        json!({
            "hash": fingerprint(&files.join("\u{1}")),
            "type": "files",
            "value": list,
            "size": files.len(),
        })
    } else {
        json!({
            "hash": fingerprint(&text),
            "type": "text",
            "value": text,
            "size": text.chars().count(),
        })
    };
    push_record(record);
}

/// A picture record: the PNG goes to `data/clipboard/images/<hash>.png`, the index keeps the path,
/// its size in bytes and the `hash` the plugin uses as an attachment name.
fn push_image(png: &[u8]) {
    let hash = fingerprint(&w::base64(png));
    let path = image_dir().join(format!("{hash}.png"));
    if !path.exists() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, png);
    }
    let record = json!({
        "hash": hash,
        "type": "image",
        "value": path.to_string_lossy().to_string(),
        "size": png.len(),
    });
    push_record(record);
}

/// Newest first, deduplicated against the top entry, persisted.
fn push_record(record: Value) {
    let hash = record.get("hash").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
    let newest_same = guard
        .first()
        .map(|r| r.get("hash").and_then(|v| v.as_str()) == Some(hash.as_str()))
        .unwrap_or(false);
    if newest_same {
        return;
    }
    let stamp = now_ms();
    let mut full = record;
    if let Some(obj) = full.as_object_mut() {
        obj.insert("_id".into(), Value::String(format!("clip-{stamp}-{hash}")));
        obj.insert("timestamp".into(), json!(stamp));
        obj.insert("pinned".into(), Value::Bool(false));
    }
    guard.insert(0, full);
    guard.truncate(MAX);
    let snapshot = guard.clone();
    drop(guard);
    save(&snapshot);
}

/// A data URL, a bare base64 string or a path — the three things uTools accepts as an image.
pub fn read_image_source(source: &str) -> BridgeResult<Vec<u8>> {
    let trimmed = source.trim();
    if trimmed.starts_with("data:") {
        let b64 = trimmed
            .split_once(',')
            .map(|(_, body)| body)
            .unwrap_or_default();
        return w::base64_decode(b64).ok_or_else(|| BridgeError::new("invalid image data URL"));
    }
    let path = std::path::Path::new(trimmed);
    if path.is_file() {
        return std::fs::read(path).map_err(|e| BridgeError::new(e.to_string()));
    }
    w::base64_decode(trimmed).ok_or_else(|| BridgeError::new("not an image path or base64 data"))
}
