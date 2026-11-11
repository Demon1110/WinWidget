//! The control center's side of the bridge. One entry point: `state_json` (everything the page
//! draws) and `handle` (every method it calls).

use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::runtime::app::{App, CONTROL_WIN};
use crate::runtime::bridge::Reply;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

/// Everything the control center renders in one go.
pub fn state_json(app: &App) -> Value {
    let cfg = app.cfg();
    let locale = crate::core::text::locale();
    let mut hotkeys = Map::new();
    for (action, keys) in &cfg.hotkeys {
        let ok = !keys.trim().is_empty() && crate::platform::tray::hotkey_ok(keys);
        hotkeys.insert(
            action.clone(),
            json!({ "keys": keys, "ok": ok, "on": !keys.trim().is_empty() }),
        );
    }

    let theme_ids: Vec<String> = app.themes.all.iter().map(|t| t.id.clone()).collect();
    let themes: Vec<Value> = app
        .themes
        .all
        .iter()
        .map(|t| {
            json!({
                "id": t.id,
                "name": t.display_name(),
                "description": t.description(),
            })
        })
        .collect();

    let mut catalog = Vec::new();
    for manifest in app.catalog.sorted() {
        let icon = crate::model::icons::icon_data_url(manifest, 96);
        let preview = crate::model::icons::preview_url(manifest, &cfg.theme_id, &locale);
        let previews = crate::model::icons::preview_variants(manifest, &theme_ids);
        let count = cfg
            .instances
            .iter()
            .filter(|i| i.widget.eq_ignore_ascii_case(&manifest.id))
            .count();
        let allowed = crate::model::permissions::allowed(cfg, manifest);
        let pending = crate::model::permissions::pending(cfg, manifest);
        let folder = manifest
            .dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        catalog.push(json!({
            "id": manifest.id,
            "name": manifest.display_name(),
            "description": manifest.description(),
            "version": manifest.version,
            "author": manifest.author.clone().unwrap_or_default(),
            "builtin": manifest.builtin,
            "own": cfg.own_widgets.iter().any(|w| w.eq_ignore_ascii_case(&manifest.id)),
            "category": crate::model::categories::of(manifest),
            "search": format!("{} {} {}", manifest.id, manifest.display_name(), manifest.description()).to_lowercase(),
            "icon": icon,
            "preview": preview,
            "previews": previews,
            "permissions": manifest.permissions,
            "allowed": allowed,
            "pending": pending,
            "count": count,
            "folder": folder,
        }));
    }

    let problems: Vec<Value> = app
        .catalog
        .problems()
        .iter()
        .map(|p| json!({ "folder": p.folder, "dir": p.dir, "message": p.message }))
        .collect();

    let mut instances = Vec::new();
    for inst in &cfg.instances {
        let manifest = app.catalog.find(&inst.widget);
        let missing = manifest.is_none();
        let name = manifest
            .map(|m| m.display_name())
            .unwrap_or_else(|| inst.widget.clone());
        let icon = manifest.and_then(|m| crate::model::icons::icon_data_url(m, 96));
        let schema = manifest
            .map(schema_json)
            .unwrap_or(Value::Array(Vec::new()));
        // The page draws its controls from the merged values, so a card whose settings were never
        // touched still shows the values the widget actually runs with.
        let settings = match manifest {
            Some(m) => {
                let mut merged = Map::new();
                for spec in &m.settings {
                    if let Some(value) = &spec.default {
                        // A default written per language ({ "zh-CN": …, "en": … }) has to be folded
                        // here as well: the page would show "[object Object]" for a value the card
                        // itself never sees in that shape.
                        merged.insert(spec.key.clone(), crate::core::text::pick_value(value));
                    }
                }
                for (k, v) in &inst.settings {
                    merged.insert(k.clone(), crate::core::text::pick_value(v));
                }
                Value::Object(merged)
            }
            None => Value::Object(inst.settings.clone()),
        };
        let size = manifest.map(|m| {
            json!({
                "minWidth": m.size.min_width, "maxWidth": m.size.max_width,
                "minHeight": m.size.min_height, "maxHeight": m.size.max_height,
                "resizable": m.size.resizable, "grow": m.size.grow,
            })
        });
        let look = app.look(inst);
        instances.push(json!({
            "id": inst.id,
            "widget": inst.widget,
            "name": name,
            "missing": missing,
            "builtin": manifest.map(|m| m.builtin).unwrap_or(false),
            "icon": icon,
            "x": inst.x,
            "y": inst.y,
            "width": inst.width,
            "height": inst.height,
            "size": size,
            "layer": inst.layer,
            "locked": inst.locked,
            "clickThrough": inst.click_through,
            "themeId": inst.theme_id,
            "settings": settings,
            "schema": schema,
            "look": look,
            "overrides": inst.appearance,
            "customCss": inst.custom_css,
            "pending": manifest
                .map(|m| crate::model::permissions::pending(cfg, m))
                .unwrap_or_default(),
        }));
    }

    json!({
        "version": crate::APP_VERSION,
        "lang": locale,
        "language": cfg.language,
        "autostart": crate::platform::autostart_enabled(),
        "lowResource": cfg.low_resource_mode,
        "lowResourceActive": cfg.low_resource_mode,
        "developer": cfg.developer_mode,
        "fileAssociation": fwz_associated(),
        "hideAll": cfg.hide_all,
        "pauseFullscreen": cfg.pause_on_fullscreen,
        "editMode": app.edit_mode,
        "hotkeys": hotkeys,
        // Goes through `current` so the "auto", "current" and "feed" fields are always there:
        // a background check only reports the release it found.
        "update": crate::market::updater::current(app),
        "portable": crate::core::paths::get().portable,
        "dataDir": crate::core::paths::get().data_dir.to_string_lossy(),
        "widgetsDir": crate::core::paths::get().user_widgets_dir().to_string_lossy(),
        "themeId": cfg.theme_id,
        "themeOverrides": cfg.theme,
        "globalLook": crate::model::appearance::effective(&app.themes, cfg, None),
        "themes": themes,
        "catalog": catalog,
        "problems": problems,
        "instances": instances,
    })
}

fn schema_json(manifest: &crate::model::manifest::Manifest) -> Value {
    let mut out = Vec::new();
    for spec in &manifest.settings {
        let options: Vec<Value> = spec
            .options
            .as_ref()
            .map(|list| {
                list.iter()
                    .map(|o| {
                        json!({
                            "value": o.value,
                            "label": crate::core::text::pick(o.label.as_ref(), ""),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.push(json!({
            "key": spec.key,
            "type": spec.r#type,
            "label": crate::core::text::pick(spec.label.as_ref(), &spec.key),
            "description": crate::core::text::pick(spec.description.as_ref(), ""),
            "default": spec.default,
            "min": spec.min,
            "max": spec.max,
            "step": spec.step,
            "placeholder": crate::core::text::pick(spec.placeholder.as_ref(), ""),
            "options": options,
        }));
    }
    Value::Array(out)
}

fn fwz_associated() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Classes\.fwz")
        .and_then(|k| k.get_value::<String, _>(""))
        .map(|v| v.eq_ignore_ascii_case("WinWidget.Archive"))
        .unwrap_or(false)
}

// ── message handling ───────────────────────────────────────────────────────

pub fn handle(app: &mut App, msg: &str) {
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
    if method == "ready" {
        if let Some(control) = &mut app.control {
            control.ready = true;
        }
        app.sync_serve();
        let state = state_json(app);
        app.send_to(CONTROL_WIN, &format!("{{\"ev\":\"state\",\"d\":{state}}}"));
        return;
    }
    let Some(id) = value.get("id").and_then(|i| i.as_i64()) else {
        return;
    };
    match call(app, &method, &params, id) {
        Ok(Reply::Now(result)) => {
            let body = json!({ "id": id, "r": result }).to_string();
            app.send_to(CONTROL_WIN, &body);
        }
        Ok(Reply::Later) => {}
        Err(e) => {
            crate::core::logging::warn(&format!("control → {method}: {}", e.0));
            let body = json!({ "id": id, "e": e.0 }).to_string();
            app.send_to(CONTROL_WIN, &body);
        }
    }
}

fn refresh(app: &mut App, instance: Option<&str>) {
    if let Some(id) = instance {
        app.sync_serve();
        app.push_appearance(id);
        app.push_state(id);
    }
    app.sync_serve();
    let state = state_json(app);
    app.send_to(CONTROL_WIN, &format!("{{\"ev\":\"state\",\"d\":{state}}}"));
}

fn instance_of(app: &App, p: &Value) -> BridgeResult<crate::core::config::InstanceConfig> {
    let id = req_str(p, "id")?;
    app.instance(&id)
        .cloned()
        .ok_or_else(|| BridgeError::new("that widget is no longer on the desktop"))
}

fn spawn<F>(app: &App, id: i64, work: F) -> Reply
where
    F: FnOnce() -> Result<Value, String> + Send + 'static,
{
    let proxy = app.proxy.clone();
    std::thread::spawn(move || {
        let body = match work() {
            Ok(v) => json!({ "id": id, "r": v }),
            Err(e) => json!({ "id": id, "e": e }),
        };
        crate::runtime::app::post(
            &proxy,
            crate::runtime::app::Ev::Reply {
                win: CONTROL_WIN.to_string(),
                body: body.to_string(),
            },
        );
    });
    Reply::Later
}

fn call(app: &mut App, method: &str, p: &Value, id: i64) -> BridgeResult<Reply> {
    let result = match method {
        // ── app ────────────────────────────────────────────────────────────
        "app.editMode" => {
            app.edit_mode = jbool(p, "on").unwrap_or(false);
            app.publish_states();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.guide" => {
            // Open the built guide straight off disk: it is a single self-contained
            // HTML file, so it works with no server, no network and no browser
            // session. Falling back to the served copy keeps a stripped install
            // (where the generated file is missing) usable.
            let local = crate::core::paths::get()
                .docs_dir()
                .join("developer-guide.html");
            if local.is_file() {
                crate::platform::shell::open_path(&local.to_string_lossy())
                    .map_err(BridgeError::new)?;
            } else {
                let url = format!(
                    "http://{}:{}/__docs/index.html",
                    crate::ui::server::CONTROL_HOST,
                    app.port
                );
                crate::platform::shell::open(&url).map_err(BridgeError::new)?;
            }
            Ok(Value::Null)
        }
        "app.hotkey" => {
            let action = req_str(p, "action")?;
            let keys = jstr(p, "keys").unwrap_or_default();
            app.cfg_mut().hotkeys.insert(action, keys);
            app.save();
            reapply_hotkeys(app);
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.hotkeysPause" => {
            app.hotkeys_paused = jbool(p, "on").unwrap_or(false);
            Ok(Value::Null)
        }
        "app.language" => {
            let lang = req_str(p, "lang")?;
            app.cfg_mut().language = lang.clone();
            app.save();
            crate::core::text::set_locale(&lang);
            let ids: Vec<String> = app.windows.keys().cloned().collect();
            for id in ids {
                app.reload_instance(&id);
            }
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.lockAll" => {
            let on = jbool(p, "on").unwrap_or(false);
            for inst in app.cfg_mut().instances.iter_mut() {
                inst.locked = on;
            }
            app.save();
            app.publish_states();
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.openFolder" => {
            let which = jstr(p, "which").unwrap_or_else(|| "data".into());
            let path = match which.as_str() {
                "widgets" => crate::core::paths::get().user_widgets_dir(),
                "builtin" => crate::core::paths::get().builtin_widgets_dir(),
                "local" => crate::core::paths::get().local_dir.clone(),
                "logs" => crate::core::paths::get()
                    .log_file()
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| crate::core::paths::get().data_dir.clone()),
                "themes" => crate::core::paths::get().themes_dir(),
                "storage" => crate::core::paths::get().storage_dir(),
                "exports" => crate::core::paths::get().exports_dir(),
                _ => crate::core::paths::get().data_dir.clone(),
            };
            std::fs::create_dir_all(&path).ok();
            // These are folders on this machine, not links: `open` only takes http/https/mailto.
            crate::platform::shell::open_path(&path.to_string_lossy()).map_err(BridgeError::new)?;
            Ok(Value::Null)
        }
        "app.rescan" => {
            app.rescan();
            app.refresh_tray_menu();
            Ok(Value::Null)
        }
        "app.restart" => {
            let exe = std::env::current_exe().map_err(|e| BridgeError::new(e.to_string()))?;
            crate::platform::shell::launch(&exe.to_string_lossy()).map_err(BridgeError::new)?;
            app.quit();
            std::process::exit(0);
        }
        "app.reveal" => {
            let path = req_str(p, "path")?;
            crate::platform::shell::reveal(&path).map_err(BridgeError::new)?;
            Ok(Value::Null)
        }
        "app.updateCheck" => {
            crate::market::updater::check_async(app);
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.updateInstall" => {
            crate::market::updater::install_async(app);
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.updateCancel" => {
            crate::market::updater::cancel(app);
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.updatePage" => {
            crate::market::updater::page(app).map_err(BridgeError::new)?;
            Ok(Value::Null)
        }
        "app.updateAuto" | "app.autoUpdate" => {
            let on = jbool(p, "on").unwrap_or(false);
            app.cfg_mut().auto_update_check = on;
            app.save();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.autostart" => {
            let on = jbool(p, "on").unwrap_or(false);
            crate::platform::set_autostart(on).map_err(BridgeError::new)?;
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.lowResource" => {
            let on = jbool(p, "on").unwrap_or(false);
            app.cfg_mut().low_resource_mode = on;
            app.save();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.developer" => {
            let on = jbool(p, "on").unwrap_or(false);
            app.cfg_mut().developer_mode = on;
            app.save();
            let ids: Vec<String> = app.windows.keys().cloned().collect();
            for id in ids {
                app.reload_instance(&id);
            }
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.hideAll" => {
            let on = jbool(p, "on").unwrap_or(false);
            app.cfg_mut().hide_all = on;
            for win in app.windows.values_mut() {
                if on {
                    win.hide();
                } else {
                    win.show();
                }
            }
            app.save();
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.pauseFullscreen" => {
            let on = jbool(p, "on").unwrap_or(false);
            app.cfg_mut().pause_on_fullscreen = on;
            app.save();
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.fileAssociation" => {
            let on = jbool(p, "on").unwrap_or(false);
            set_file_association(on).map_err(BridgeError::new)?;
            refresh(app, None);
            Ok(Value::Null)
        }
        "app.close" => {
            if let Some(control) = &app.control {
                control.window.set_visible(false);
            }
            Ok(Value::Null)
        }

        // ── fonts ─────────────────────────────────────────────────────────
        "fonts.list" => Ok(Value::Array(
            crate::platform::fonts()
                .into_iter()
                .map(Value::String)
                .collect(),
        )),

        // ── instances ─────────────────────────────────────────────────────
        "instance.appearance" => {
            let inst = instance_of(app, p)?;
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            if let Some(target) = app.instance_mut(&inst.id) {
                if value.is_null() {
                    target.appearance.remove(&key);
                } else {
                    target.appearance.insert(key, value);
                }
            }
            app.save();
            refresh(app, Some(&inst.id));
            Ok(Value::Null)
        }
        "instance.css" => {
            let inst = instance_of(app, p)?;
            let css = jstr(p, "css").unwrap_or_default();
            if let Some(target) = app.instance_mut(&inst.id) {
                target.custom_css = if css.trim().is_empty() {
                    None
                } else {
                    Some(css)
                };
            }
            app.save();
            refresh(app, Some(&inst.id));
            Ok(Value::Null)
        }
        "instance.clickThrough" => {
            let inst = instance_of(app, p)?;
            let on = jbool(p, "on").unwrap_or(false);
            app.set_click_through(&inst.id, on);
            app.refresh_tray_menu();
            Ok(Value::Null)
        }
        "instance.locked" => {
            let inst = instance_of(app, p)?;
            let on = jbool(p, "on").unwrap_or(false);
            if let Some(target) = app.instance_mut(&inst.id) {
                target.locked = on;
            }
            app.save();
            app.publish_states();
            refresh(app, None);
            Ok(Value::Null)
        }
        "instance.layer" => {
            let inst = instance_of(app, p)?;
            let layer = req_str(p, "layer")?;
            app.set_layer(&inst.id, &layer);
            Ok(Value::Null)
        }
        "instance.theme" => {
            let inst = instance_of(app, p)?;
            let theme = p.get("theme").cloned().unwrap_or(Value::Null);
            if let Some(target) = app.instance_mut(&inst.id) {
                target.theme_id = theme.as_str().map(|s| s.to_string());
            }
            app.save();
            refresh(app, Some(&inst.id));
            Ok(Value::Null)
        }
        "instance.setting" => {
            let inst = instance_of(app, p)?;
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            if let Some(target) = app.instance_mut(&inst.id) {
                if value.is_null() {
                    target.settings.remove(&key);
                } else {
                    target.settings.insert(key, value);
                }
            }
            app.save();
            app.sync_serve();
            app.push_settings(&inst.id);
            refresh(app, None);
            Ok(Value::Null)
        }
        "instance.size" => {
            let inst = instance_of(app, p)?;
            let manifest = app
                .manifest_for(&inst.id)
                .ok_or_else(|| BridgeError::new("this widget is no longer installed"))?;
            let s = &manifest.size;
            let width = jnum(p, "width")
                .unwrap_or(inst.width)
                .clamp(s.min_width, s.max_width);
            let height = jnum(p, "height")
                .unwrap_or(inst.height)
                .clamp(s.min_height, s.max_height);
            if let Some(target) = app.instance_mut(&inst.id) {
                target.width = width;
                target.height = height;
            }
            app.save();
            app.place_window(&inst.id);
            app.push_state(&inst.id);
            refresh(app, None);
            Ok(Value::Null)
        }
        "instance.reload" => {
            let inst = instance_of(app, p)?;
            app.reload_instance(&inst.id);
            Ok(Value::Null)
        }
        "instance.devtools" => {
            let inst = instance_of(app, p)?;
            if let Some(win) = app.windows.get(&inst.id) {
                win.webview.open_devtools();
            } else {
                app.want_devtools = Some(inst.id.clone());
                app.pending_windows.push(inst.id.clone());
            }
            Ok(Value::Null)
        }
        "instance.identify" => {
            let inst = instance_of(app, p)?;
            if let Some(win) = app.windows.get_mut(&inst.id) {
                win.show();
                win.window.set_focus();
            }
            app.event_to(&inst.id, "identify", json!({ "ms": 1600 }));
            Ok(Value::Null)
        }
        "instance.duplicate" => {
            let inst = instance_of(app, p)?;
            let new_id = app
                .duplicate_instance(&inst.id)
                .ok_or_else(|| BridgeError::new("that widget is no longer on the desktop"))?;
            refresh(app, None);
            Ok(json!({ "id": new_id }))
        }
        "instance.remove" => {
            let inst = instance_of(app, p)?;
            app.remove_instance(&inst.id);
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(Value::Null)
        }
        "instance.clearAll" => {
            let count = app.cfg().instances.len();
            app.clear_instances();
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(json!({ "removed": count }))
        }
        "instance.pickFolder" => {
            let inst = instance_of(app, p)?;
            let key = req_str(p, "key")?;
            let picked = crate::platform::shell::pick("folder", "all", "");
            if let Some(folder) = picked {
                if let Some(target) = app.instance_mut(&inst.id) {
                    target.settings.insert(key, Value::String(folder));
                }
                app.save();
                app.sync_serve();
                app.push_settings(&inst.id);
                refresh(app, None);
            }
            Ok(Value::Null)
        }

        // ── widgets ───────────────────────────────────────────────────────
        "widget.add" => {
            let widget = req_str(p, "widget")?;
            let grant = jbool(p, "grant").unwrap_or(false);
            if grant {
                if let Some(manifest) = app.catalog.find(&widget).cloned() {
                    crate::model::permissions::grant(app.cfg_mut(), &manifest);
                    app.save();
                }
            }
            let id = app.add_widget(&widget, None).map_err(BridgeError::new)?;
            if let Some(manifest) = app.catalog.find(&widget).cloned() {
                let pending = crate::model::permissions::pending(app.cfg(), &manifest);
                if !pending.is_empty() {
                    let consent =
                        json!({ "widget": manifest.id, "then": "load", "permissions": pending });
                    app.send_to(
                        CONTROL_WIN,
                        &format!("{{\"ev\":\"consent\",\"d\":{consent}}}"),
                    );
                }
            }
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(json!({ "id": id }))
        }
        "widget.grant" => {
            let widget = req_str(p, "widget")?;
            if let Some(manifest) = app.catalog.find(&widget).cloned() {
                crate::model::permissions::grant(app.cfg_mut(), &manifest);
                app.save();
            }
            app.rescan();
            for (iid, inst) in app
                .cfg()
                .instances
                .iter()
                .filter(|i| i.widget.eq_ignore_ascii_case(&widget))
                .map(|i| (i.id.clone(), i.widget.clone()))
                .collect::<Vec<_>>()
            {
                let _ = inst;
                app.reload_instance(&iid);
            }
            refresh(app, None);
            Ok(Value::Null)
        }
        "widget.openFolder" => {
            let widget = req_str(p, "widget")?;
            let dir: PathBuf = app
                .catalog
                .find(&widget)
                .map(|m| m.dir.clone())
                .ok_or_else(|| BridgeError::new(format!("no widget called {widget}")))?;
            crate::platform::shell::open(&dir.to_string_lossy()).map_err(BridgeError::new)?;
            Ok(Value::Null)
        }
        "widget.export" => {
            let widget = req_str(p, "widget")?;
            let out = crate::market::packages::export(app, &widget).map_err(BridgeError::new)?;
            Ok(out)
        }
        "widget.uninstall" => {
            let widget = req_str(p, "widget")?;
            crate::market::packages::uninstall(app, &widget).map_err(BridgeError::new)?;
            app.refresh_tray_menu();
            Ok(Value::Null)
        }
        "widget.create" => {
            let name = req_str(p, "name")?;
            let created = crate::market::packages::create(app, &name).map_err(BridgeError::new)?;
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(created)
        }

        // ── themes ────────────────────────────────────────────────────────
        "theme.global" => {
            let theme = req_str(p, "id")?;
            if app.themes.get(Some(&theme)).id != theme {
                return Err(BridgeError::new(format!("no theme called {theme}")));
            }
            app.cfg_mut().theme_id = theme;
            app.save();
            refresh_themes(app);
            Ok(Value::Null)
        }
        "theme.override" => {
            let key = req_str(p, "key")?;
            let value = p.get("value").cloned().unwrap_or(Value::Null);
            if value.is_null() {
                app.cfg_mut().theme.remove(&key);
            } else {
                app.cfg_mut().theme.insert(key, value);
            }
            app.save();
            refresh_themes(app);
            Ok(Value::Null)
        }
        "theme.reset" => {
            app.cfg_mut().theme = Map::new();
            app.cfg_mut().theme_id = crate::model::themes::DEFAULT_ID.to_string();
            app.save();
            refresh_themes(app);
            Ok(Value::Null)
        }

        // ── packages ──────────────────────────────────────────────────────
        "package.import" => {
            if let Some(path) = crate::platform::shell::pick("file", "fwz", "") {
                stage_and_show(app, std::path::Path::new(&path));
            }
            Ok(Value::Null)
        }
        "package.cancel" => {
            let token = req_str(p, "token")?;
            if let Some(staged) = app.staged.remove(&token) {
                let _ = std::fs::remove_dir_all(&staged.dir);
            }
            Ok(Value::Null)
        }
        "package.install" => {
            let token = req_str(p, "token")?;
            let result = crate::market::packages::install(app, &token).map_err(BridgeError::new)?;
            app.refresh_tray_menu();
            refresh(app, None);
            Ok(result)
        }
        "package.export" => {
            let widget = req_str(p, "widget")?;
            Ok(crate::market::packages::export(app, &widget).map_err(BridgeError::new)?)
        }

        // ── market ────────────────────────────────────────────────────────
        "market.list" => {
            let want_refresh = jbool(p, "refresh").unwrap_or(false);
            let url = crate::market::client::list_url_of(app);
            let site = crate::market::client::site_of(app);
            let cache = crate::market::client::cache_path();
            return Ok(spawn(app, id, move || {
                Ok(crate::market::client::fetch_list(
                    &url,
                    &site,
                    &cache,
                    want_refresh,
                ))
            }));
        }
        "market.install" => {
            let widget = req_str(p, "id")?;
            let list = crate::market::client::cached_list(&crate::market::client::site_of(app));
            let url =
                crate::market::client::download_url(&list, &widget).map_err(BridgeError::new)?;
            let proxy = app.proxy.clone();
            let target = widget.clone();
            std::thread::spawn(move || {
                let payload = match crate::market::client::download(&url, &target) {
                    Ok(path) => json!({ "ok": true, "id": target, "path": path.to_string_lossy() }),
                    Err(e) => json!({ "ok": false, "id": target, "message": e }),
                };
                crate::runtime::app::post(
                    &proxy,
                    crate::runtime::app::Ev::Command(format!("market.downloaded:{}", payload)),
                );
            });
            Ok(json!({ "status": "downloading" }))
        }
        "market.open" => {
            let url = jstr(p, "url");
            crate::market::client::open(app, url).map_err(BridgeError::new)?;
            Ok(Value::Null)
        }

        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    };
    result.map(Reply::Now)
}

fn reapply_hotkeys(app: &mut App) {
    let list: Vec<(String, String)> = app
        .cfg()
        .hotkeys
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if let Some(tray) = &app.tray {
        tray.set_hotkeys(list);
    }
}

fn refresh_themes(app: &mut App) {
    let ids: Vec<String> = app.cfg().instances.iter().map(|i| i.id.clone()).collect();
    app.sync_serve();
    for id in ids {
        app.push_appearance(&id);
    }
    let state = state_json(app);
    app.send_to(CONTROL_WIN, &format!("{{\"ev\":\"state\",\"d\":{state}}}"));
}

/// Reads a dropped or picked `.fwz` and asks the page to confirm it.
pub fn stage_and_show(app: &mut App, path: &std::path::Path) {
    match crate::market::packages::stage(app, path) {
        Ok(staged) => {
            let event = json!({
                "token": staged.token,
                "name": staged.name,
                "version": staged.version,
                "author": staged.author,
                "description": staged.description,
                "permissions": staged.permissions,
                "newPermissions": staged.new_permissions,
                "unknown": staged.unknown,
                "update": staged.update,
                "file": staged.source
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            });
            app.staged.insert(staged.token.clone(), staged);
            app.send_to(
                CONTROL_WIN,
                &format!("{{\"ev\":\"install\",\"d\":{event}}}"),
            );
        }
        Err(message) => {
            let event = json!({
                "file": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                "message": message,
            });
            app.send_to(
                CONTROL_WIN,
                &format!("{{\"ev\":\"installError\",\"d\":{event}}}"),
            );
        }
    }
}

fn set_file_association(on: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if on {
        let (classes, _) = hkcu
            .create_subkey(r"Software\Classes\.fwz")
            .map_err(|e| e.to_string())?;
        classes
            .set_value("", &"WinWidget.Archive")
            .map_err(|e| e.to_string())?;
        let (prog, _) = hkcu
            .create_subkey(r"Software\Classes\WinWidget.Archive\shell\open\command")
            .map_err(|e| e.to_string())?;
        prog.set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| e.to_string())?;
    } else {
        let _ = hkcu.delete_subkey_all(r"Software\Classes\.fwz");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\WinWidget.Archive");
    }
    Ok(())
}
