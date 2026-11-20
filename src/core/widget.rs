//! WinWidget's own protocol: the card API that is not a uTools category.
//!
//! Settings, per-instance storage, volume, the media player, folders a card owns, the recycle bin,
//! power actions and `net.fetch` are WinWidget's own inventions. They keep the same dispatcher shape
//! as the uTools categories so the bridge has exactly one way of asking.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use serde_json::{json, Value};

const OWNS: &[&str] = &[
    "settings.set",
    "app.uiTheme",
    "storage.get",
    "storage.set",
    "storage.remove",
    "storage.keys",
    "audio.get",
    "audio.set",
    "audio.subscribe",
    "audio.unsubscribe",
    "media.get",
    "media.control",
    "media.lyrics",
    "media.subscribe",
    "media.unsubscribe",
    "files.list",
    "files.info",
    "files.pick",
    "recycle.query",
    "recycle.empty",
    "recycle.open",
    "power.do",
    "bluetooth.list",
    "net.fetch",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    let instance = ctx.instance.to_string();
    match method {
        "settings.set" => {
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            if let Some(inst) = ctx.app.instance_mut(&instance) {
                if value.is_null() {
                    inst.settings.remove(&key);
                } else {
                    inst.settings.insert(key, value);
                }
            }
            ctx.app.save();
            ctx.app.push_settings(&instance);
            // push_state_to_control rebuilds the served snapshot itself (App::sync_serve is
            // its first step), so a separate sync here would just rebuild it twice.
            ctx.app.push_state_to_control(None);
            Ok(Reply::Now(Value::Null))
        }

        "storage.get" => {
            let key = req_str(p, "key")?;
            Ok(Reply::Now(ctx.app.storage.get(&instance, &key)))
        }
        "storage.set" => {
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            ctx.app
                .storage
                .set(&instance, &key, value)
                .map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "storage.remove" => {
            let key = req_str(p, "key")?;
            ctx.app.storage.remove(&instance, &key);
            Ok(Reply::Now(Value::Null))
        }
        "app.uiTheme" => {
            // The power card carries a light/dark toggle. No "theme" argument answers the
            // current mode; "toggle" flips light↔dark (auto falls into dark first); an
            // explicit light/dark/auto sets it exactly like the control center does. The
            // control center is pushed so its own switch and page follow immediately.
            let current = ctx.app.cfg().ui_theme.clone();
            let requested = p.get("theme").and_then(|v| v.as_str()).map(String::from);
            let next = match requested.as_deref() {
                Some("toggle") => {
                    if current.eq_ignore_ascii_case("light") {
                        "dark".to_string()
                    } else {
                        "light".to_string()
                    }
                }
                Some(m @ ("light" | "dark" | "auto")) => (*m).to_string(),
                _ => current.clone(),
            };
            if next != current {
                ctx.app.cfg_mut().ui_theme = next.clone();
                ctx.app.save();
                ctx.app.push_state_to_control(None);
            }
            Ok(Reply::Now(json!(next)))
        }

        "storage.keys" => Ok(Reply::Now(Value::Array(
            ctx.app
                .storage
                .keys(&instance)
                .into_iter()
                .map(Value::String)
                .collect(),
        ))),

        // ── volume ───────────────────────────────────────────────────────────────────────────
        "audio.get" => {
            ctx.require("audio")?;
            Ok(Reply::Now(crate::platform::audio::state()))
        }
        "audio.set" => {
            ctx.require("audio")?;
            Ok(Reply::Now(crate::platform::audio::apply(p)))
        }
        "audio.subscribe" => {
            ctx.require("audio")?;
            ctx.app.audio_subs.insert(instance);
            ctx.app.rebuild_sampling();
            Ok(Reply::Now(crate::platform::audio::state()))
        }
        "audio.unsubscribe" => {
            ctx.app.audio_subs.remove(&instance);
            ctx.app.rebuild_sampling();
            Ok(Reply::Now(Value::Null))
        }

        // ── media ────────────────────────────────────────────────────────────────────────────
        "media.get" => {
            ctx.require("media")?;
            Ok(Reply::Now(crate::platform::media::state()))
        }
        "media.control" => {
            ctx.require("media")?;
            let action = req_str(p, "action")?;
            let position = jnum(p, "position").unwrap_or(0.0) as i64;
            Ok(Reply::Now(crate::platform::media::control(
                &action, position,
            )))
        }
        "media.lyrics" => {
            ctx.require("media")?;
            ctx.spawn_value(crate::platform::media::lyrics);
            Ok(Reply::Later)
        }
        "media.subscribe" => {
            ctx.require("media")?;
            ctx.app.media_subs.insert(instance);
            ctx.app.rebuild_sampling();
            Ok(Reply::Now(crate::platform::media::state()))
        }
        "media.unsubscribe" => {
            ctx.app.media_subs.remove(&instance);
            ctx.app.rebuild_sampling();
            Ok(Reply::Now(Value::Null))
        }

        // ── folders a card owns ───────────────────────────────────────────────────────────────
        "files.list" => {
            let key = req_str(p, "key")?;
            let recursive = jbool(p, "recursive").unwrap_or(false);
            let folder = folder_for(ctx, &key);
            let mut listing = crate::platform::files::list(&folder, recursive);
            crate::platform::files::with_urls(&mut listing, &instance, &key, &folder);
            Ok(Reply::Now(listing))
        }
        "files.info" => {
            let key = req_str(p, "key")?;
            let path = req_str(p, "path")?;
            let folder = folder_for(ctx, &key);
            let file = crate::core::paths::resolve_inside(&folder, &path)
                .unwrap_or_else(|| std::path::PathBuf::from(&path));
            Ok(Reply::Now(crate::platform::files::info(&file)))
        }
        "files.pick" => {
            let key = req_str(p, "key")?;
            let picked = crate::platform::shell::pick("folder", "all", "");
            match picked {
                Some(folder) => {
                    if let Some(inst) = ctx.app.instance_mut(&instance) {
                        inst.settings
                            .insert(key.clone(), Value::String(folder.clone()));
                    }
                    ctx.app.save();
                    ctx.app.push_settings(&instance);
                    ctx.app.push_state_to_control(None);
                    Ok(Reply::Now(json!(folder)))
                }
                None => Ok(Reply::Now(Value::Null)),
            }
        }

        // ── recycle bin / power (built-in widgets only) ───────────────────────────────────────
        "recycle.query" => {
            ctx.builtin_only()?;
            // Answers from the last measurement straight away: walking a bin with 59 GB in it takes
            // minutes, and the old code walked it once every ten seconds on this very thread.
            Ok(Reply::Now(crate::platform::power::recycle_state()))
        }
        "recycle.empty" => {
            ctx.builtin_only()?;
            // Deletion of a big bin runs for minutes, so it gets a thread of its own and the card
            // follows it through `recycle.query` instead of holding one request open.
            crate::platform::power::start_empty()
                .map(|_| Reply::Now(json!(true)))
                .map_err(BridgeError::new)
        }
        "recycle.open" => {
            ctx.builtin_only()?;
            ctx.spawn_reply(|| {
                crate::platform::power::recycle_open()
                    .map(|_| json!(true))
                    .map_err(BridgeError::new)
            });
            Ok(Reply::Later)
        }
        "power.do" => {
            ctx.builtin_only()?;
            let action = req_str(p, "action")?;
            crate::platform::power::do_power(&action)
                .map(Reply::Now)
                .map_err(BridgeError::new)
        }

        // ── bluetooth devices ────────────────────────────────────────────────────────────────
        // Enumeration and the GATT battery reads both block, so they run on a worker. The port is
        // a `'static` reference, so it moves into the worker freely — core never names platform.
        "bluetooth.list" => {
            ctx.require("bluetooth")?;
            let battery = jbool(p, "battery").unwrap_or(true);
            let refresh = jbool(p, "refresh").unwrap_or(false);
            let bt = ctx.ports.bluetooth;
            ctx.spawn_value(move || bt.list(battery, refresh));
            Ok(Reply::Later)
        }

        // ── network, restricted to the hosts the widget declared ──────────────────────────────
        "net.fetch" => {
            let request = crate::core::net::FetchRequest {
                url: req_str(p, "url")?,
                method: jstr(p, "method").unwrap_or_else(|| "GET".into()),
                headers: p
                    .get("headers")
                    .and_then(|h| h.as_object())
                    .map(|o| {
                        o.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default(),
                body: jstr(p, "body"),
                base64: jstr(p, "as").map(|a| a == "base64").unwrap_or(false),
            };
            let allowed = ctx.allowed.clone();
            ctx.spawn_reply(move || {
                crate::core::net::fetch(&allowed, request).map_err(BridgeError::new)
            });
            Ok(Reply::Later)
        }

        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// Where `files.*` reads from: a folder the card chose, or its own theme folder.
fn folder_for(ctx: &Ctx, key: &str) -> std::path::PathBuf {
    let value = ctx
        .app
        .instance(ctx.instance)
        .and_then(|i| i.settings.get(key))
        .cloned();
    crate::platform::files::folder_from_setting(value.as_ref())
}
