//! The widget-side bridge: every `{id, m, p}` request from a page is parsed here and handed to the
//! category that owns the method (`core::api::dispatch`).
//!
//! This file used to hold a match with dozens of arms; it now only does the four things that belong
//! to a transport: parse, find the widget, build the context, send the answer.

use crate::core::api::Ctx;
use crate::core::util::BridgeError;
use crate::runtime::app::App;
use serde_json::{json, Value};

// Kept at this path because the control center and older call sites still spell it
// `runtime::bridge::Reply`.
pub use crate::core::api::Reply;

pub fn handle(app: &mut App, instance: &str, msg: &str) {
    route(app, instance, instance, None, msg);
}

/// A message from the page inside a custom window (`utools.createBrowserWindow`). It speaks the
/// same protocol; only the window it acts on differs, and its replies go back to that window.
pub fn handle_window(app: &mut App, instance: &str, win: u32, msg: &str) {
    let key = format!("win:{win}");
    route(app, instance, &key, Some(win), msg);
}

fn route(app: &mut App, instance: &str, target: &str, win: Option<u32>, msg: &str) {
    let value: Value = match serde_json::from_str(msg) {
        Ok(v) => v,
        Err(_) => return,
    };
    let method = value
        .get("m")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let params = value.get("p").cloned().unwrap_or(Value::Null);
    match value.get("id").and_then(|i| i.as_i64()) {
        Some(id) => match call_at(app, instance, win, &method, &params, id) {
            Ok(Reply::Now(result)) => {
                let body = json!({ "id": id, "r": result }).to_string();
                app.send_to(target, &body);
            }
            Ok(Reply::Later) => {}
            Err(e) => {
                crate::core::logging::warn(&format!("{instance} → {method}: {}", e.0));
                let body = json!({ "id": id, "e": e.0 }).to_string();
                app.send_to(target, &body);
            }
        },
        None => notify_at(app, instance, win, &method, &params),
    }
}

/// A card's request, or a custom window's: `win` is the custom window when there is one.
fn call_at(
    app: &mut App,
    instance: &str,
    win: Option<u32>,
    method: &str,
    p: &Value,
    id: i64,
) -> Result<Reply, BridgeError> {
    let manifest = app
        .manifest_for(instance)
        .ok_or_else(|| BridgeError::new("this widget is no longer installed"))?;
    let allowed = crate::model::permissions::allowed(&app.store.data, &manifest);
    let target = match win {
        Some(id) => format!("win:{id}"),
        None => instance.to_string(),
    };
    let mut ctx = Ctx::new(app, instance, &target, win, manifest, allowed, id);
    crate::core::api::dispatch(&mut ctx, method, p)
}

/// Messages without an `id`: life-cycle notices and log lines. A custom window's `ready` is what
/// fires `createBrowserWindow`'s callback, so it stays with the window category.
fn notify_at(app: &mut App, instance: &str, win: Option<u32>, method: &str, p: &Value) {
    if let Some(win) = win {
        if crate::core::window::custom_notify(app, win, method, p) {
            return;
        }
        if method.starts_with("window.") {
            return;
        }
        crate::core::logging::warn(&format!("win {win}: unknown notification '{method}'"));
        return;
    }
    if method.starts_with("window.") && crate::core::window::card_notify(app, instance, method, p) {
        return;
    }
    if method == "log" || method == "ready" {
        crate::core::events::notify(app, instance, method, p);
        return;
    }
    crate::core::logging::warn(&format!("{instance}: unknown notification '{method}'"));
}
