//! 输入 category: put something where the user's cursor already is.
//!
//! uTools' `hideMainWindowPasteText` / `...PasteFile` / `...PasteImage` / `...TypeString` all hide
//! the plugin window, give the keyboard back to the window the user came from, and then paste or
//! type into it. The same three steps happen here, in that order.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};

const OWNS: &[&str] = &[
    "input.pasteText",
    "input.pasteFile",
    "input.pasteImage",
    "input.typeString",
    "input.startDrag",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        "input.pasteText" => {
            ctx.require("clipboard")?;
            let text = jstr(p, "text").unwrap_or_default();
            if text.is_empty() {
                return Err(BridgeError::new("text is required"));
            }
            let ok = w::set_clipboard_text(&text);
            if !ok {
                return Ok(Reply::Now(Value::Bool(false)));
            }
            paste_after_hiding(ctx);
            Ok(Reply::Later)
        }
        "input.pasteFile" => {
            ctx.require("clipboard")?;
            let paths = paths_of(p, &["path", "paths"])?;
            if paths.is_empty() {
                return Err(BridgeError::new("path is required"));
            }
            if !w::set_clipboard_files(&paths) {
                return Ok(Reply::Now(Value::Bool(false)));
            }
            paste_after_hiding(ctx);
            Ok(Reply::Later)
        }
        "input.pasteImage" => {
            ctx.require("clipboard")?;
            let image = jstr(p, "image").unwrap_or_default();
            let bytes = crate::core::clipboard::read_image_source(&image)?;
            if !w::set_clipboard_png(&bytes) {
                return Ok(Reply::Now(Value::Bool(false)));
            }
            paste_after_hiding(ctx);
            Ok(Reply::Later)
        }
        "input.typeString" => {
            ctx.require("input")?;
            let text = jstr(p, "text").unwrap_or_default();
            if text.is_empty() {
                return Err(BridgeError::new("text is required"));
            }
            let instance = ctx.instance.to_string();
            crate::core::window::hide_for_input(ctx.app, &instance);
            ctx.spawn_reply(move || {
                std::thread::sleep(std::time::Duration::from_millis(120));
                crate::core::logging::info(&format!(
                    "input.typeString: foreground is {} ({} chars)",
                    w::foreground_label(),
                    text.chars().count()
                ));
                w::type_unicode(&text);
                Ok(json!(true))
            });
            Ok(Reply::Later)
        }
        // OLE drag-and-drop needs a live drag source owned by a window; a widget page cannot start
        // one, so this says so instead of pretending.
        "input.startDrag" => Err(BridgeError::new(
            "startDrag is not available: dragging a file out needs an OLE drag source window",
        )),
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// Hides this card, hands the keyboard back to the window below it, waits for the switch to settle,
/// then presses Ctrl+V — the whole of what a uTools paste API does, run off the UI thread.
fn paste_after_hiding(ctx: &mut Ctx) {
    let instance = ctx.instance.to_string();
    crate::core::window::hide_for_input(ctx.app, &instance);
    ctx.spawn_reply(|| {
        std::thread::sleep(std::time::Duration::from_millis(140));
        // Where the keystroke actually lands decides whether the paste worked, so say it.
        crate::core::logging::info(&format!(
            "input.paste: foreground is {}",
            w::foreground_label()
        ));
        w::key_combo(0x56, true, false, false);
        Ok(json!(true))
    });
}

/// `path` or `paths`, both accepted the way uTools accepts a string or an array.
fn paths_of(p: &Value, keys: &[&str]) -> BridgeResult<Vec<String>> {
    for key in keys {
        match p.get(*key) {
            Some(Value::Array(a)) => {
                let list: Vec<String> = a
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                if !list.is_empty() {
                    return Ok(list);
                }
            }
            Some(Value::String(s)) if !s.is_empty() => return Ok(vec![s.clone()]),
            _ => {}
        }
    }
    Ok(Vec::new())
}
