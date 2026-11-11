//! 复制 category: text, files and pictures on the Windows clipboard.
//!
//! uTools has `copyText`, `copyFile`, `copyImage` and `getCopiedFiles`; WinWidget's own
//! `widget.clipboard.readText/writeText` are the text pair of the same thing, so both names are
//! answered here instead of being scattered.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};

const OWNS: &[&str] = &[
    "clipboard.readText",
    "clipboard.writeText",
    "clipboard.readImage",
    "clipboard.writeImage",
    "clipboard.readFiles",
    "clipboard.writeFiles",
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
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
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
