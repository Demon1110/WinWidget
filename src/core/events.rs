//! 事件 category, host side: what the runtime pushes when a widget's life changes.
//!
//! uTools gives a plugin `onPluginReady`, `onPluginEnter`, `onPluginOut`, `onPluginDetach`,
//! `onScheduleTrigger` and `onMainPush`. Their page-side listeners are in `assets/sdk/utools.js`; what
//! belongs here is the other end — the messages this runtime sends, and the two notifications a page
//! sends back without an id (`ready` and `log`).

use crate::core::ports::EventsHost;
use crate::core::util::jstr;
use serde_json::Value;

/// `ready` and `log` come from a card without an `id`, so they are handled outside the request
/// dispatcher.
pub fn notify(host: &mut dyn EventsHost, instance: &str, method: &str, params: &Value) {
    match method {
        "ready" => {
            crate::core::logging::info(&format!("{instance} ready"));
            // A third-party widget's permissions only exist after the user allows them, so a widget
            // that just started with something still pending should bring the control center up to
            // date rather than leave the list stale. The host decides what "pending" means; this
            // module only knows the domain rule "pending -> refresh".
            if host.has_pending_permissions(instance) {
                host.refresh_control_state();
            }
        }
        "log" => {
            let level = jstr(params, "level").unwrap_or_else(|| "info".into());
            let text = jstr(params, "msg").unwrap_or_default();
            match level.as_str() {
                "error" => crate::core::logging::error(&format!("[{instance}] {text}")),
                "warn" => crate::core::logging::warn(&format!("[{instance}] {text}")),
                _ => crate::core::logging::info(&format!("[{instance}] {text}")),
            }
        }
        _ => crate::core::logging::warn(&format!("{instance}: unknown notification '{method}'")),
    }
}

/// The payload of `onPluginEnter`: what the launcher matched, so a page can tell a typed command
/// from a file drop. Kept here because it is the shape of an event, not of any one API.
pub fn enter_payload(kind: &str, code: Option<&str>, payload: Option<&Value>) -> Value {
    serde_json::json!({
        "code": code,
        "type": kind,
        "payload": payload.cloned().unwrap_or(Value::Null),
    })
}
