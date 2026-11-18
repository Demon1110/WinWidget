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
            hide_for_input(ctx, &instance);
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
    hide_for_input(ctx, &instance);
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

/// Hides this card and gives the keyboard back to the window below it — the step every uTools
/// `hideMainWindowPaste*` and `hideMainWindowTypeString` starts with. This lives here rather than
/// in the window category so the input category does not depend on a runtime-level module.
fn hide_for_input(ctx: &mut Ctx, instance: &str) {
    let app = &mut *ctx.app;
    let hwnd = app.windows.get(instance).map(|win| win.hwnd());
    let remembered = app.last_foreign_focus as w::HWND;
    app.set_visible(instance, false, "api");
    // The remembered window is where the user actually was; z-order behind the card is only a
    // fallback, and it happily lands on the terminal that launched us.
    if w::can_take_focus(remembered) {
        w::force_foreground(remembered);
    } else if let Some(hwnd) = hwnd {
        w::activate_behind(hwnd);
    }
    app.refresh_tray_menu();
}
