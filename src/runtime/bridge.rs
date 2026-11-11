//! The widget-side API: every `{id, m, p}` request from a card page is answered here.

use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::model::manifest::Manifest;
use crate::platform::win32 as w;
use crate::runtime::app::App;
use serde_json::{json, Value};

pub enum Reply {
    Now(Value),
    Later,
}

pub fn handle(app: &mut App, instance: &str, msg: &str) {
    route(app, instance, instance, None, msg);
}

/// A message from the page inside a custom window (`utools.createBrowserWindow`). It speaks the
/// same protocol; only the window it acts on differs, and its replies go back to that window.
pub fn handle_window(app: &mut App, instance: &str, win: u32, msg: &str) {
    let key = format!("win:{win}");
    route(app, instance, &key, Some(win), msg);
}

fn route(app: &mut App, instance: &str, target: &str, ctx: Option<u32>, msg: &str) {
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
        Some(id) => match call_at(app, instance, ctx, &method, &params, id) {
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
        None => notify_at(app, instance, ctx, &method, &params),
    }
}

/// A card's message, or a custom window's: `ctx` is the custom window when there is one.
fn call_at(
    app: &mut App,
    instance: &str,
    ctx: Option<u32>,
    method: &str,
    p: &Value,
    id: i64,
) -> BridgeResult<Reply> {
    // The window category lives in `core::window`, the way uTools splits its own API.
    if method.starts_with("win.") {
        return crate::core::window::custom_call(app, ctx, instance, method, p);
    }
    if let Some(rest) = method.strip_prefix("window.") {
        if ctx.is_some() {
            // A custom window's page talking about "window" means its own window.
            return crate::core::window::custom_call(
                app,
                ctx,
                instance,
                &format!("win.{rest}"),
                p,
            );
        }
        if let Some(reply) = crate::core::window::card_call(app, instance, method, p)? {
            return Ok(reply);
        }
    }
    call(app, instance, method, p, id)
}

/// Notifications (no `id`): `ready` from a custom window is what fires `createBrowserWindow`'s
/// callback, so it is handled here rather than in the card's own dispatcher.
fn notify_at(app: &mut App, instance: &str, ctx: Option<u32>, method: &str, p: &Value) {
    if let Some(win) = ctx {
        match method {
            "ready" => {
                app.mark_custom_loaded(win);
                return;
            }
            "log" => {
                let level = jstr(p, "level").unwrap_or_else(|| "info".into());
                let text = jstr(p, "msg").unwrap_or_default();
                let line = format!("[win {win}] {text}");
                match level.as_str() {
                    "error" => crate::core::logging::error(&line),
                    "warn" => crate::core::logging::warn(&line),
                    _ => crate::core::logging::info(&line),
                }
                return;
            }
            other => {
                // A custom window has no card behind it: `window.*` notifications (press, drag,
                // resize) are meaningless there, not a mistake worth a warning.
                if !other.starts_with("window.") {
                    crate::core::logging::warn(&format!(
                        "win {win}: unknown notification '{other}'"
                    ));
                }
                return;
            }
        }
    }
    notify(app, instance, method, p);
}

fn notify(app: &mut App, instance: &str, method: &str, params: &Value) {
    if method.starts_with("window.") && crate::core::window::card_notify(app, instance, method, params)
    {
        return;
    }
    match method {
        "ready" => {
            crate::core::logging::info(&format!("{instance} ready"));
            if let Some(manifest) = app.manifest_for(instance) {
                let pending = crate::model::permissions::pending(app.cfg(), &manifest);
                if !pending.is_empty() {
                    app.push_state_to_control(None);
                }
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

fn require(app: &App, manifest: &Manifest, permission: &str) -> BridgeResult<()> {
    let allowed = crate::model::permissions::allowed(&app.store.data, manifest);
    if !manifest.declares(permission) {
        return Err(BridgeError::new(format!(
            "permission denied: add \"{permission}\" to permissions in widget.json"
        )));
    }
    if !crate::model::permissions::has(&allowed, permission) {
        return Err(BridgeError::new(format!(
            "permission denied: \"{permission}\" is not allowed yet — open the control center, choose \"{}\" and allow it",
            manifest.display_name()
        )));
    }
    Ok(())
}

fn builtin_only(_app: &App, manifest: &Manifest) -> BridgeResult<()> {
    if manifest.builtin {
        Ok(())
    } else {
        Err(BridgeError::new(
            "only WinWidget's built-in widgets can do this",
        ))
    }
}

fn call(app: &mut App, instance: &str, method: &str, p: &Value, id: i64) -> BridgeResult<Reply> {
    let manifest = app
        .manifest_for(instance)
        .ok_or_else(|| BridgeError::new("this widget is no longer installed"))?;
    let allowed = crate::model::permissions::allowed(&app.store.data, &manifest);

    match method {
        "settings.set" => {
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            if let Some(inst) = app.instance_mut(instance) {
                if value.is_null() {
                    inst.settings.remove(&key);
                } else {
                    inst.settings.insert(key, value);
                }
            }
            app.save();
            app.push_settings(instance);
            app.sync_serve();
            app.push_state_to_control(None);
            Ok(Reply::Now(Value::Null))
        }

        "storage.get" => {
            let key = req_str(p, "key")?;
            Ok(Reply::Now(app.storage.get(instance, &key)))
        }
        "storage.set" => {
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            app.storage
                .set(instance, &key, value)
                .map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "storage.remove" => {
            let key = req_str(p, "key")?;
            app.storage.remove(instance, &key);
            Ok(Reply::Now(Value::Null))
        }
        "storage.keys" => Ok(Reply::Now(Value::Array(
            app.storage
                .keys(instance)
                .into_iter()
                .map(Value::String)
                .collect(),
        ))),

        "system.subscribe" => {
            require(app, &manifest, "system")?;
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
                app.clear_subscription(instance);
                return Ok(Reply::Now(json!({})));
            }
            app.set_subscription(instance, topics.clone(), interval);
            // Answering with a snapshot means the page has something to draw at once. Building a
            // sampler reads disks, adapters and CPU counters, and nine system cards doing that on the
            // UI thread is a visible freeze, so the first reading comes from a worker.
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            std::thread::spawn(move || {
                let mut sampler = crate::platform::sysinfo::Sampler::new();
                let snapshot = sampler.sample(&topics);
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: json!({ "id": id, "r": snapshot }).to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }
        "system.unsubscribe" => {
            app.clear_subscription(instance);
            Ok(Reply::Now(Value::Null))
        }
        "system.history" => {
            require(app, &manifest, "system")?;
            let sampler = crate::platform::sysinfo::Sampler::new();
            let interval = app
                .sampling
                .get(instance)
                .map(|(_, ms)| *ms as i64)
                .unwrap_or(1000);
            Ok(Reply::Now(sampler.history(interval)))
        }
        "system.info" => {
            require(app, &manifest, "system")?;
            Ok(Reply::Now(crate::platform::sysinfo::info(&monitors(app).0)))
        }
        "system.adapters" => {
            require(app, &manifest, "system")?;
            Ok(Reply::Now(crate::platform::sysinfo::adapters()))
        }
        "system.ping" => {
            require(app, &manifest, "system")?;
            let host = req_str(p, "host")?;
            let timeout = jnum(p, "timeout").unwrap_or(1500.0) as u64;
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            std::thread::spawn(move || {
                let result = crate::platform::sysinfo::ping(&host, timeout);
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: json!({ "id": id, "r": result }).to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }

        "audio.get" => {
            require(app, &manifest, "audio")?;
            Ok(Reply::Now(crate::platform::audio::state()))
        }
        "audio.set" => {
            require(app, &manifest, "audio")?;
            Ok(Reply::Now(crate::platform::audio::apply(p)))
        }
        "audio.subscribe" => {
            require(app, &manifest, "audio")?;
            app.audio_subs.insert(instance.to_string());
            app.rebuild_sampling();
            Ok(Reply::Now(crate::platform::audio::state()))
        }
        "audio.unsubscribe" => {
            app.audio_subs.remove(instance);
            app.rebuild_sampling();
            Ok(Reply::Now(Value::Null))
        }

        "media.get" => {
            require(app, &manifest, "media")?;
            Ok(Reply::Now(crate::platform::media::state()))
        }
        "media.control" => {
            require(app, &manifest, "media")?;
            let action = req_str(p, "action")?;
            let position = jnum(p, "position").unwrap_or(0.0) as i64;
            Ok(Reply::Now(crate::platform::media::control(
                &action, position,
            )))
        }
        "media.lyrics" => {
            require(app, &manifest, "media")?;
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            std::thread::spawn(move || {
                let result = crate::platform::media::lyrics();
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: json!({ "id": id, "r": result }).to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }
        "media.subscribe" => {
            require(app, &manifest, "media")?;
            app.media_subs.insert(instance.to_string());
            app.rebuild_sampling();
            Ok(Reply::Now(crate::platform::media::state()))
        }
        "media.unsubscribe" => {
            app.media_subs.remove(instance);
            app.rebuild_sampling();
            Ok(Reply::Now(Value::Null))
        }

        "files.list" => {
            let key = req_str(p, "key")?;
            let recursive = jbool(p, "recursive").unwrap_or(false);
            let folder = folder_for(app, instance, &key);
            let mut listing = crate::platform::files::list(&folder, recursive);
            crate::platform::files::with_urls(&mut listing, instance, &key, &folder);
            Ok(Reply::Now(listing))
        }
        "files.info" => {
            let key = req_str(p, "key")?;
            let path = req_str(p, "path")?;
            let folder = folder_for(app, instance, &key);
            let file = crate::core::paths::resolve_inside(&folder, &path)
                .unwrap_or_else(|| std::path::PathBuf::from(&path));
            Ok(Reply::Now(crate::platform::files::info(&file)))
        }
        "files.pick" => {
            let key = req_str(p, "key")?;
            let picked = crate::platform::shell::pick("folder", "all", "");
            match picked {
                Some(folder) => {
                    if let Some(inst) = app.instance_mut(instance) {
                        inst.settings
                            .insert(key.clone(), Value::String(folder.clone()));
                    }
                    app.save();
                    app.push_settings(instance);
                    app.sync_serve();
                    app.push_state_to_control(None);
                    Ok(Reply::Now(json!(folder)))
                }
                None => Ok(Reply::Now(Value::Null)),
            }
        }

        "recycle.query" => {
            builtin_only(app, &manifest)?;
            Ok(Reply::Now(crate::platform::power::recycle_query()))
        }
        "recycle.empty" => {
            builtin_only(app, &manifest)?;
            // Deleting a full bin takes as long as Explorer takes; on the UI thread that is a frozen
            // card and a frozen control center, so it runs on its own thread.
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            std::thread::spawn(move || {
                let result = match crate::platform::power::recycle_empty() {
                    Ok(state) => json!({ "id": id, "r": state }),
                    Err(e) => json!({ "id": id, "e": e }),
                };
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: result.to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }
        "recycle.open" => {
            builtin_only(app, &manifest)?;
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            std::thread::spawn(move || {
                let result = match crate::platform::power::recycle_open() {
                    Ok(_) => json!({ "id": id, "r": true }),
                    Err(e) => json!({ "id": id, "e": e }),
                };
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: result.to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }
        "power.do" => {
            builtin_only(app, &manifest)?;
            let action = req_str(p, "action")?;
            crate::platform::power::do_power(&action)
                .map(Reply::Now)
                .map_err(BridgeError::new)
        }

        "net.fetch" => {
            let url = req_str(p, "url")?;
            let method = jstr(p, "method").unwrap_or_else(|| "GET".into());
            let headers: Vec<(String, String)> = p
                .get("headers")
                .and_then(|h| h.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let body = jstr(p, "body");
            let base64 = jstr(p, "as").map(|a| a == "base64").unwrap_or(false);
            let proxy = app.proxy.clone();
            let target = instance.to_string();
            let request = crate::core::net::FetchRequest {
                url,
                method,
                headers,
                body,
                base64,
            };
            let allowed = allowed.clone();
            std::thread::spawn(move || {
                let result = crate::core::net::fetch(&allowed, request);
                let body = match result {
                    Ok(v) => json!({ "id": id, "r": v }),
                    Err(e) => json!({ "id": id, "e": e }),
                };
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Reply {
                        win: target,
                        body: body.to_string(),
                    },
                );
            });
            Ok(Reply::Later)
        }

        "notify.show" => {
            require(app, &manifest, "notify")?;
            let title = jstr(p, "title").unwrap_or_default();
            let body = jstr(p, "body").unwrap_or_default();
            let at = jnum(p, "at").map(|t| t as i64);
            let tag = jstr(p, "tag");
            app.schedule_note(instance, title, body, at, tag);
            Ok(Reply::Now(Value::Null))
        }
        "notify.cancel" => {
            require(app, &manifest, "notify")?;
            let tag = jstr(p, "tag");
            app.cancel_notes(instance, tag.as_deref());
            Ok(Reply::Now(Value::Null))
        }

        "shell.open" => {
            require(app, &manifest, "shell.open")?;
            let target = req_str(p, "target")?;
            crate::platform::shell::open(&target)
                .map(|_| Reply::Now(Value::Null))
                .map_err(BridgeError::new)
        }
        "shell.launch" => {
            require(app, &manifest, "shell.launch")?;
            let path = req_str(p, "path")?;
            crate::platform::shell::launch(&path)
                .map(|_| Reply::Now(Value::Null))
                .map_err(BridgeError::new)
        }
        "shell.info" => {
            require(app, &manifest, "shell.launch")?;
            let path = req_str(p, "path")?;
            let size = jnum(p, "size").unwrap_or(64.0) as i32;
            Ok(Reply::Now(crate::platform::shell::info(&path, size)))
        }
        "shell.reveal" => {
            require(app, &manifest, "shell.launch")?;
            let path = req_str(p, "path")?;
            crate::platform::shell::reveal(&path)
                .map(|_| Reply::Now(Value::Null))
                .map_err(BridgeError::new)
        }
        "shell.pick" => {
            require(app, &manifest, "shell.launch")?;
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
        // File paths need WebView2's extra-object messaging, which wry doesn't expose; dropped
        // files are still accepted by the control center.
        "shell.paths" => Ok(Reply::Now(Value::Array(Vec::new()))),

        "text.chinese" => {
            let text = jstr(p, "text").unwrap_or_default();
            let to = jstr(p, "to").unwrap_or_else(|| "traditional".into());
            Ok(Reply::Now(Value::String(
                crate::platform::chinese::convert(&text, &to),
            )))
        }

        // ── clipboard ─────────────────────────────────────────────────────
        "clipboard.readText" => {
            require(app, &manifest, "clipboard")?;
            Ok(Reply::Now(match w::clipboard_text() {
                Some(text) => Value::String(text),
                None => Value::Null,
            }))
        }
        "clipboard.writeText" => {
            require(app, &manifest, "clipboard")?;
            let text = jstr(p, "text").unwrap_or_default();
            Ok(Reply::Now(Value::Bool(w::set_clipboard_text(&text))))
        }

        // ── known folders ─────────────────────────────────────────────────
        "paths.named" => {
            let name = jstr(p, "name").unwrap_or_default();
            Ok(Reply::Now(match w::known_folder_path(&name) {
                Some(path) => Value::String(path),
                None => Value::Null,
            }))
        }

        // ── save dialog, file icon, recycle bin ──────────────────────────
        "shell.save" => {
            require(app, &manifest, "shell.launch")?;
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
        "shell.trash" => {
            require(app, &manifest, "shell.launch")?;
            let path = req_str(p, "path")?;
            Ok(Reply::Now(Value::Bool(crate::platform::shell::trash(&path))))
        }
        "file.icon" => {
            require(app, &manifest, "shell.launch")?;
            let spec = req_str(p, "path")?;
            let size = jnum(p, "size").unwrap_or(32.0) as i32;
            Ok(Reply::Now(
                match crate::platform::shell::icon(&spec, size) {
                    Some(icon) => Value::String(icon),
                    None => Value::Null,
                },
            ))
        }

        // ── screen ────────────────────────────────────────────────────────
        "screen.capture" => {
            require(app, &manifest, "screen")?;
            Ok(Reply::Now(match w::capture_screen_png() {
                Some(png) => Value::String(format!("data:image/png;base64,{}", w::base64(&png))),
                None => Value::Null,
            }))
        }

        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

fn folder_for(app: &App, instance: &str, key: &str) -> std::path::PathBuf {
    let value = app
        .instance(instance)
        .and_then(|i| i.settings.get(key))
        .cloned();
    crate::platform::files::folder_from_setting(value.as_ref())
}

fn monitors(_app: &App) -> (Vec<(i32, i32, bool)>, i32) {
    let list: Vec<(i32, i32, bool)> = crate::platform::win32::monitors()
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


