//! 系统 category: the machine this runs on, the folders and shells around it, and notifications.
//!
//! uTools puts `getPath`, `showNotification`, `showOpenDialog`, `shellOpenPath`, `getFileIcon`,
//! `isWindows` and the like here; the device figures a WinWidget card subscribes to (`system.*`)
//! belong to the same domain, so they live here too.

use crate::core::api::{Ctx, Reply};
use crate::core::ports::SystemPort;
use crate::core::util::{jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};

/// Map a known-folder lookup to what the page sees. Separate from `Ctx` so it can be
/// unit-tested with a fake system port.
pub fn named_path_value(system: &dyn SystemPort, name: &str) -> Value {
    match system.known_folder_path(name) {
        Some(path) => Value::String(path),
        None => Value::Null,
    }
}

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
    "system.theme",
    "system.processes",
    "system.ports",
    "system.displays",
    "system.screensaver",
    "wifi.profiles",
    "paths.named",
    "notify.show",
    "notify.cancel",
    "shell.open",
    "shell.launch",
    "shell.openWith",
    "shell.rename",
    "shell.info",
    "shell.pick",
    "shell.save",
    "shell.reveal",
    "shell.trash",
    "shell.paths",
    "shell.desktopIcons",
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
            ctx.app
                .set_subscription(&instance, topics.clone(), interval);
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
        // The power card's light/dark switch: it flips Windows itself (both the app-mode and the
        // system-mode switches in the Personalise key), not WinWidget's ui_theme — cards running
        // in "auto" follow on their own. No argument answers the current mode; "toggle" flips,
        // "light"/"dark" set it.
        "system.theme" => {
            ctx.require("system")?;
            let current_light = ctx.ports.system.light_mode();
            let requested = p.get("theme").and_then(|v| v.as_str()).map(String::from);
            let next_light = match requested.as_deref() {
                Some("toggle") => Some(!current_light),
                Some("light") => Some(true),
                Some("dark") => Some(false),
                _ => None,
            };
            if let Some(next) = next_light {
                if next != current_light {
                    ctx.ports.system.set_light_mode(next)?;
                }
            }
            let answer = next_light.unwrap_or(current_light);
            Ok(Reply::Now(json!(if answer { "light" } else { "dark" })))
        }
        // ── narrow system reads and the one controlled write (C-class widgets) ────────────────
        // Reading the process table is `system.read`; the executable path on each row needs
        // `shell.info` too, so a widget cannot map every pid to a program on disk for free.
        "system.processes" => {
            ctx.require("system.read")?;
            let sort = jstr(p, "sort").unwrap_or_else(|| "cpu".into());
            let limit = jnum(p, "limit").unwrap_or(20.0).clamp(1.0, 100.0) as usize;
            let expose_path = ctx.allowed("shell.launch");
            ctx.spawn_value(move || {
                crate::platform::sysprobe::processes(&sort, limit, expose_path)
            });
            Ok(Reply::Later)
        }
        "system.ports" => {
            ctx.require("system.read")?;
            let protocol = jstr(p, "protocol").unwrap_or_else(|| "all".into());
            let listening = p.get("listening").and_then(|v| v.as_bool()).unwrap_or(true);
            let remote = p.get("remote").and_then(|v| v.as_bool()).unwrap_or(false);
            ctx.spawn_value(move || crate::platform::sysprobe::ports(&protocol, listening, remote));
            Ok(Reply::Later)
        }
        // Display inventory is read-only on purpose: HDR on/off changes how everything on screen
        // looks, so that switch stays in Windows' settings app, where the user owns it.
        "system.displays" => {
            ctx.require("system.read")?;
            ctx.spawn_value(crate::platform::displays::displays);
            Ok(Reply::Later)
        }
        // Plaintext profiles need `system.write` on top of `system.read`; the answer says
        // `revealed` so the control center can keep showing that a key is on screen. A
        // parameter cannot widen this: the permission alone decides.
        "wifi.profiles" => {
            ctx.require("system.read")?;
            let reveal = ctx.allowed("system.write");
            ctx.spawn_value(move || crate::platform::sysprobe::wifi_profiles(reveal));
            Ok(Reply::Later)
        }
        "system.screensaver" => {
            ctx.require("system.write")?;
            let action = jstr(p, "action").unwrap_or_else(|| "start".into());
            Ok(Reply::Now(
                crate::platform::sysprobe::screensaver(&action).map_err(BridgeError::new)?,
            ))
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
            "light": ctx.ports.system.light_mode(),
        }))),

        // ── system paths (utools.getPath) ─────────────────────────────────────────────────────
        "paths.named" => {
            let name = jstr(p, "name").unwrap_or_default();
            Ok(Reply::Now(named_path_value(ctx.ports.system, &name)))
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
        "shell.openWith" => {
            ctx.require("shell.launch")?;
            let target = req_str(p, "target")?;
            let app = req_str(p, "app")?;
            crate::platform::shell::open_with(&target, &app).map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "shell.rename" => {
            ctx.require("shell.launch")?;
            let items = p
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Ok(Reply::Now(crate::platform::shell::rename(&items)))
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
            Ok(Reply::Now(Value::Bool(crate::platform::shell::trash(
                &path,
            ))))
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
        // Show or hide Explorer's desktop icons. This is a reversible shell setting, so it stays
        // under the shell.launch permission rather than adding a new consent prompt.
        "shell.desktopIcons" => {
            ctx.require("shell.launch")?;
            let action = jstr(p, "action").unwrap_or_else(|| "query".into());
            let current = w::desktop_icons_visible();
            match action.as_str() {
                "query" => Ok(Reply::Now(json!({
                    "supported": current.is_some(),
                    "visible": current,
                }))),
                "show" | "hide" | "toggle" => {
                    let target = match action.as_str() {
                        "show" => true,
                        "hide" => false,
                        _ => current.ok_or_else(|| {
                            BridgeError::new("未找到桌面图标窗口，请回到桌面后重试。")
                        })?,
                    };
                    if action == "toggle" {
                        w::set_desktop_icons_visible(!target).map_err(BridgeError::new)?;
                    } else {
                        w::set_desktop_icons_visible(target).map_err(BridgeError::new)?;
                    }
                    Ok(Reply::Now(json!({
                        "supported": true,
                        "visible": w::desktop_icons_visible().unwrap_or(!target),
                    })))
                }
                other => Err(BridgeError::new(format!(
                    "unknown desktopIcons action '{other}'"
                ))),
            }
        }
        "file.icon" => {
            ctx.require("shell.launch")?;
            let spec = req_str(p, "path")?;
            let size = jnum(p, "size").unwrap_or(32.0) as i32;
            Ok(Reply::Now(
                match crate::platform::shell::icon(&spec, size) {
                    Some(icon) => Value::String(icon),
                    None => Value::Null,
                },
            ))
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
