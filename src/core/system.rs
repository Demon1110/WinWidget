//! 系统 category: the machine this runs on, the folders and shells around it, and notifications.
//!
//! uTools puts `getPath`, `showNotification`, `showOpenDialog`, `shellOpenPath`, `getFileIcon`,
//! `isWindows` and the like here; the device figures a WinWidget card subscribes to (`system.*`)
//! belong to the same domain, so they live here too.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};

/// Every method this category answers. Listing them keeps the chain honest: a module claims only
/// what it really implements, and anything else falls through to the next one.
const OWNS: &[&str] = &[
    "system.subscribe",
    "system.unsubscribe",
    "system.history",
    "system.info",
    "system.adapters",
    "system.ping",
    "system.platform",
    "paths.named",
    "notify.show",
    "notify.cancel",
    "shell.open",
    "shell.launch",
    "shell.info",
    "shell.pick",
    "shell.save",
    "shell.reveal",
    "shell.trash",
    "shell.paths",
    "file.icon",
    "text.chinese",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        // ── device figures: system.subscribe / unsubscribe / history / info / adapters / ping ──
        "system.subscribe" => {
            ctx.require("system")?;
            let topics: Vec<String> = p
                .get("topics")
                .and_then(|t| t.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let interval = jnum(p, "interval").unwrap_or(1000.0) as u64;
            if topics.is_empty() {
                ctx.app.clear_subscription(ctx.instance);
                return Ok(Reply::Now(json!({})));
            }
            let instance = ctx.instance.to_string();
            ctx.app.set_subscription(&instance, topics.clone(), interval);
            // Answering with a snapshot means the page has something to draw at once. Building a
            // sampler reads disks, adapters and CPU counters, and nine system cards doing that on
            // the UI thread is a visible freeze, so the first reading comes from a worker.
            ctx.spawn_value(move || {
                let mut sampler = crate::platform::sysinfo::Sampler::new();
                sampler.sample(&topics)
            });
            Ok(Reply::Later)
        }
        "system.unsubscribe" => {
            ctx.app.clear_subscription(ctx.instance);
            Ok(Reply::Now(Value::Null))
        }
        "system.history" => {
            ctx.require("system")?;
            let sampler = crate::platform::sysinfo::Sampler::new();
            let interval = ctx
                .app
                .sampling
                .get(ctx.instance)
                .map(|(_, ms)| *ms as i64)
                .unwrap_or(1000);
            Ok(Reply::Now(sampler.history(interval)))
        }
        "system.info" => {
            ctx.require("system")?;
            Ok(Reply::Now(crate::platform::sysinfo::info(
                &monitor_sizes().0,
            )))
        }
        "system.adapters" => {
            ctx.require("system")?;
            Ok(Reply::Now(crate::platform::sysinfo::adapters()))
        }
        "system.ping" => {
            ctx.require("system")?;
            let host = req_str(p, "host")?;
            let timeout = jnum(p, "timeout").unwrap_or(1500.0) as u64;
            ctx.spawn_value(move || crate::platform::sysinfo::ping(&host, timeout));
            Ok(Reply::Later)
        }
        // utools.isDev / isWindows / isMacOS / isLinux / isDarkColors answered by the host, so the
        // compatibility layer never has to guess from the user agent.
        "system.platform" => Ok(Reply::Now(json!({
            "os": "windows",
            "isWindows": true,
            "isMacOS": false,
            "isLinux": false,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "dev": ctx.app.cfg().developer_mode,
            "light": crate::platform::system_light(),
        }))),

        // ── system paths (utools.getPath) ─────────────────────────────────────────────────────
        "paths.named" => {
            let name = jstr(p, "name").unwrap_or_default();
            Ok(Reply::Now(match w::known_folder_path(&name) {
                Some(path) => Value::String(path),
                None => Value::Null,
            }))
        }

        // ── notifications (utools.showNotification) ───────────────────────────────────────────
        "notify.show" => {
            ctx.require("notify")?;
            let title = jstr(p, "title").unwrap_or_default();
            let body = jstr(p, "body").unwrap_or_default();
            let at = jnum(p, "at").map(|t| t as i64);
            let tag = jstr(p, "tag");
            let instance = ctx.instance.to_string();
            ctx.app.schedule_note(&instance, title, body, at, tag);
            Ok(Reply::Now(Value::Null))
        }
        "notify.cancel" => {
            ctx.require("notify")?;
            let tag = jstr(p, "tag");
            let instance = ctx.instance.to_string();
            ctx.app.cancel_notes(&instance, tag.as_deref());
            Ok(Reply::Now(Value::Null))
        }

        // ── shells, dialogs, file icons (utools.shellOpenPath and friends) ────────────────────
        // utools.shellOpenPath hands a path, shellOpenExternal a link: one entry takes both.
        "shell.open" => {
            ctx.require("shell.open")?;
            let target = req_str(p, "target")?;
            crate::platform::shell::open_any(&target).map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "shell.launch" => {
            ctx.require("shell.launch")?;
            let path = req_str(p, "path")?;
            crate::platform::shell::launch(&path).map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "shell.info" => {
            ctx.require("shell.launch")?;
            let path = req_str(p, "path")?;
            let size = jnum(p, "size").unwrap_or(64.0) as i32;
            Ok(Reply::Now(crate::platform::shell::info(&path, size)))
        }
        "shell.reveal" => {
            ctx.require("shell.launch")?;
            let path = req_str(p, "path")?;
            crate::platform::shell::reveal(&path).map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "shell.trash" => {
            ctx.require("shell.launch")?;
            let path = req_str(p, "path")?;
            Ok(Reply::Now(Value::Bool(crate::platform::shell::trash(&path))))
        }
        "shell.pick" => {
            ctx.require("shell.launch")?;
            let kind = jstr(p, "type").unwrap_or_else(|| "file".into());
            let filter = jstr(p, "filter").unwrap_or_else(|| "all".into());
            let title = jstr(p, "title").unwrap_or_default();
            Ok(Reply::Now(
                match crate::platform::shell::pick(&kind, &filter, &title) {
                    Some(path) => Value::String(path),
                    None => Value::Null,
                },
            ))
        }
        "shell.save" => {
            ctx.require("shell.launch")?;
            let title = jstr(p, "title").unwrap_or_default();
            let name = jstr(p, "name").unwrap_or_default();
            let filter = jstr(p, "filter").unwrap_or_else(|| "all".into());
            Ok(Reply::Now(
                match crate::platform::shell::save(&title, &name, &filter) {
                    Some(path) => Value::String(path),
                    None => Value::Null,
                },
            ))
        }
        // File paths need WebView2's extra-object messaging, which wry doesn't expose; dropped files
        // are still accepted by the control center.
        "shell.paths" => Ok(Reply::Now(Value::Array(Vec::new()))),
        "file.icon" => {
            ctx.require("shell.launch")?;
            let spec = req_str(p, "path")?;
            let size = jnum(p, "size").unwrap_or(32.0) as i32;
            Ok(Reply::Now(match crate::platform::shell::icon(&spec, size) {
                Some(icon) => Value::String(icon),
                None => Value::Null,
            }))
        }

        // ── text ─────────────────────────────────────────────────────────────────────────────
        "text.chinese" => {
            let text = jstr(p, "text").unwrap_or_default();
            let to = jstr(p, "to").unwrap_or_else(|| "traditional".into());
            Ok(Reply::Now(Value::String(
                crate::platform::chinese::convert(&text, &to),
            )))
        }

        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// The monitors as `(width, height, primary)` plus the primary monitor's width — what
/// `sysinfo::info` needs to describe a display.
fn monitor_sizes() -> (Vec<(i32, i32, bool)>, i32) {
    let list: Vec<(i32, i32, bool)> = w::monitors()
        .into_iter()
        .map(|(rect, primary)| (rect.width(), rect.height(), primary))
        .collect();
    let primary_width = list
        .iter()
        .find(|(_, _, primary)| *primary)
        .map(|(w, _, _)| *w)
        .unwrap_or(0);
    (list, primary_width)
}
