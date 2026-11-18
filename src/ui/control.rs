//! The control center's side of the bridge. One entry point: `state_json` (everything the page
//! draws) and `handle` (every method it calls).

use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::runtime::app::{App, CONTROL_WIN};
use crate::runtime::bridge::Reply;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

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
        // The page decides light or dark from these two: the setting, plus what Windows is doing
        // right now for "auto". Both are pushed on every change, so a Windows theme flip repaints
        // the window without a restart.
        "uiTheme": cfg.ui_theme,
        "systemLight": crate::platform::system_light(),
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
        // The default folder, so the page can offer "back to default" and show where a custom
        // location came from.
        "dataDirDefault": crate::core::paths::get().bootstrap.to_string_lossy(),
        "dataDirCustom": crate::core::paths::get().custom,
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
        push_control_state(app);
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

/// Rebuild the served snapshot and push the full state to the control center. Keeping this
/// one place means "sync then publish" cannot drift out of order, and callers never have to
/// remember to sync before reading [`state_json`].
fn push_control_state(app: &mut App) {
    app.sync_serve();
    let state = state_json(app);
    app.send_to(CONTROL_WIN, &format!("{{\"ev\":\"state\",\"d\":{state}}}"));
}

fn refresh(app: &mut App, instance: Option<&str>) {
    if let Some(id) = instance {
        app.push_appearance(id);
        app.push_state(id);
    }
    push_control_state(app);
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

// ── method registry ────────────────────────────────────────────────────────

/// One control-center method. `id` is the bridge request id; only the few methods that answer
/// from a worker thread need it (the rest ignore it).
type Method = fn(&mut App, &Value, i64) -> BridgeResult<Reply>;

/// The single source of truth for the control-center bridge API. Tooling reads the `m.insert`
/// lines below to build the spec and check the front end for drift; adding or renaming a method
/// is one line here plus its handler.
fn registry() -> &'static HashMap<&'static str, Method> {
    static REGISTRY: OnceLock<HashMap<&'static str, Method>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut m: HashMap<&'static str, Method> = HashMap::new();
        // app
        m.insert("app.editMode", app_edit_mode);
        m.insert("app.guide", app_guide);
        m.insert("app.hotkey", app_hotkey);
        m.insert("app.hotkeysPause", app_hotkeys_pause);
        m.insert("app.language", app_language);
        m.insert("app.uiTheme", app_ui_theme);
        m.insert("app.lockAll", app_lock_all);
        m.insert("app.openFolder", app_open_folder);
        m.insert("app.rescan", app_rescan);
        m.insert("app.restart", app_restart);
        m.insert("app.setDataDir", app_set_data_dir);
        m.insert("app.resetDataDir", app_reset_data_dir);
        m.insert("app.reveal", app_reveal);
        m.insert("app.updateCheck", app_update_check);
        m.insert("app.updateInstall", app_update_install);
        m.insert("app.updateCancel", app_update_cancel);
        m.insert("app.updatePage", app_update_page);
        m.insert("app.updateAuto", app_update_auto);
        // Kept for pages built against the old spelling.
        m.insert("app.autoUpdate", app_update_auto);
        m.insert("app.autostart", app_autostart);
        m.insert("app.lowResource", app_low_resource);
        m.insert("app.developer", app_developer);
        m.insert("app.hideAll", app_hide_all);
        m.insert("app.pauseFullscreen", app_pause_fullscreen);
        m.insert("app.fileAssociation", app_file_association);
        m.insert("app.close", app_close);
        // fonts
        m.insert("fonts.list", fonts_list);
        // instances
        m.insert("instance.appearance", instance_appearance);
        m.insert("instance.css", instance_css);
        m.insert("instance.clickThrough", instance_click_through);
        m.insert("instance.locked", instance_locked);
        m.insert("instance.layer", instance_layer);
        m.insert("instance.theme", instance_theme);
        m.insert("instance.setting", instance_setting);
        m.insert("instance.size", instance_size);
        m.insert("instance.reload", instance_reload);
        m.insert("instance.devtools", instance_devtools);
        m.insert("instance.identify", instance_identify);
        m.insert("instance.duplicate", instance_duplicate);
        m.insert("instance.remove", instance_remove);
        m.insert("instance.clearAll", instance_clear_all);
        m.insert("instance.pickFolder", instance_pick_folder);
        // widgets
        m.insert("widget.add", widget_add);
        m.insert("widget.grant", widget_grant);
        m.insert("widget.openFolder", widget_open_folder);
        m.insert("widget.export", widget_export);
        m.insert("widget.uninstall", widget_uninstall);
        m.insert("widget.create", widget_create);
        // themes
        m.insert("theme.global", theme_global);
        m.insert("theme.override", theme_override);
        m.insert("theme.reset", theme_reset);
        // packages
        m.insert("package.import", package_import);
        m.insert("package.cancel", package_cancel);
        m.insert("package.install", package_install);
        m.insert("package.export", package_export);
        // market
        m.insert("market.list", market_list);
        m.insert("market.install", market_install);
        m.insert("market.open", market_open);
        m
    })
}

fn handler_for(method: &str) -> BridgeResult<Method> {
    registry()
        .get(method)
        .copied()
        .ok_or_else(|| BridgeError::new(format!("unknown method '{method}'")))
}

fn call(app: &mut App, method: &str, p: &Value, id: i64) -> BridgeResult<Reply> {
    handler_for(method)?(app, p, id)
}

// ── app ────────────────────────────────────────────────────────────────────

fn app_edit_mode(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    app.edit_mode = jbool(p, "on").unwrap_or(false);
    app.publish_states();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_guide(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    // The guide is one self-contained HTML file, so it needs no server when it exists on
    // disk: opening it straight from the folder keeps the page free of the port and works
    // even with the app closed afterwards. A single exe has no such file — the copy is
    // inside the binary — so that one is served by the local HTTP server instead, and the
    // `file://` form never appears in a shipped build.
    let paths = crate::core::paths::get();
    let local = paths.docs_dir().join("developer-guide.html");
    if !paths.embedded() && local.is_file() {
        crate::platform::shell::open_path(&local.to_string_lossy()).map_err(BridgeError::new)?;
    } else {
        // `127.0.0.1`, not the card host: this URL is handed to the user's browser, and
        // Windows itself does not resolve `widgets.localhost` (only Chromium invents it).
        let url = format!("http://127.0.0.1:{}/__docs/index.html", app.port);
        crate::platform::shell::open(&url).map_err(BridgeError::new)?;
    }
    Ok(Reply::Now(Value::Null))
}

fn app_hotkey(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let action = req_str(p, "action")?;
    let keys = jstr(p, "keys").unwrap_or_default();
    app.cfg_mut().hotkeys.insert(action, keys);
    app.save();
    reapply_hotkeys(app);
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_hotkeys_pause(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    app.hotkeys_paused = jbool(p, "on").unwrap_or(false);
    Ok(Reply::Now(Value::Null))
}

fn app_language(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let lang = req_str(p, "lang")?;
    app.cfg_mut().language = lang.clone();
    app.save();
    crate::core::text::set_locale(&lang);
    let ids: Vec<String> = app.windows.keys().cloned().collect();
    for id in ids {
        app.reload_instance(&id);
    }
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_ui_theme(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let mode = req_str(p, "theme")?;
    let mode = match mode.as_str() {
        "light" | "dark" => mode,
        _ => "auto".to_string(),
    };
    app.cfg_mut().ui_theme = mode;
    app.save();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_lock_all(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    for inst in app.cfg_mut().instances.iter_mut() {
        inst.locked = on;
    }
    app.save();
    app.publish_states();
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_open_folder(_app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let which = jstr(p, "which").unwrap_or_else(|| "data".into());
    let paths = crate::core::paths::get();
    let path = match which.as_str() {
        "widgets" => paths.user_widgets_dir(),
        // 内置组件与主题现在编在 exe 里，没有文件夹可开：内置组件的用法是复制到
        // 用户目录再改，所以这个按钮落到用户组件目录。
        "builtin" | "themes" if paths.embedded() => paths.user_widgets_dir(),
        "builtin" => paths.builtin_widgets_dir(),
        "db" => paths.db_dir(),
        "logs" => paths
            .log_file()
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| paths.data_dir.clone()),
        "themes" => paths.themes_dir(),
        "instances" => paths.instances_dir(),
        "exports" => paths.exports_dir(),
        _ => paths.data_dir.clone(),
    };
    std::fs::create_dir_all(&path).ok();
    // These are folders on this machine, not links: `open` only takes http/https/mailto.
    crate::platform::shell::open_path(&path.to_string_lossy()).map_err(BridgeError::new)?;
    Ok(Reply::Now(Value::Null))
}

fn app_rescan(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    app.rescan();
    app.refresh_tray_menu();
    Ok(Reply::Now(Value::Null))
}

fn app_restart(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    let exe = std::env::current_exe().map_err(|e| BridgeError::new(e.to_string()))?;
    crate::platform::shell::launch(&exe.to_string_lossy()).map_err(BridgeError::new)?;
    // Let the event loop run the normal exit path: kill exit(0) here would skip the
    // unload grace period, the final save, and removing the tray icon.
    app.quit();
    Ok(Reply::Now(Value::Null))
}

// Move every database to a folder of the user's choosing. The copy happens now; the switch
// itself needs a restart, because the folders are resolved once while the app starts.
fn app_set_data_dir(_app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    let picked = crate::platform::shell::pick("folder", "", "Choose a data folder");
    match picked {
        Some(dir) => {
            let result = crate::core::paths::set_data_dir(&dir).map_err(BridgeError::new)?;
            Ok(Reply::Now(json!({ "dir": result["dir"], "restart": true })))
        }
        None => Ok(Reply::Now(Value::Null)),
    }
}

fn app_reset_data_dir(_app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    let result = crate::core::paths::reset_data_dir().map_err(BridgeError::new)?;
    Ok(Reply::Now(json!({ "dir": result["dir"], "restart": true })))
}

fn app_reveal(_app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let path = req_str(p, "path")?;
    crate::platform::shell::reveal(&path).map_err(BridgeError::new)?;
    Ok(Reply::Now(Value::Null))
}

fn app_update_check(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    crate::market::updater::check_async(app);
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_update_install(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    crate::market::updater::install_async(app);
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_update_cancel(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    crate::market::updater::cancel(app);
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_update_page(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    crate::market::updater::page(app).map_err(BridgeError::new)?;
    Ok(Reply::Now(Value::Null))
}

fn app_update_auto(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    app.cfg_mut().auto_update_check = on;
    app.save();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_autostart(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    crate::platform::set_autostart(on).map_err(BridgeError::new)?;
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_low_resource(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    app.cfg_mut().low_resource_mode = on;
    app.save();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_developer(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    app.cfg_mut().developer_mode = on;
    app.save();
    let ids: Vec<String> = app.windows.keys().cloned().collect();
    for id in ids {
        app.reload_instance(&id);
    }
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_hide_all(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    app.cfg_mut().hide_all = on;
    app.set_all_visible(!on, "control");
    app.save();
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_pause_fullscreen(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    app.cfg_mut().pause_on_fullscreen = on;
    app.save();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_file_association(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let on = jbool(p, "on").unwrap_or(false);
    set_file_association(on).map_err(BridgeError::new)?;
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn app_close(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    if let Some(control) = &app.control {
        control.window.set_visible(false);
    }
    Ok(Reply::Now(Value::Null))
}

// ── fonts ──────────────────────────────────────────────────────────────────

fn fonts_list(_app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    Ok(Reply::Now(Value::Array(
        crate::platform::fonts()
            .into_iter()
            .map(Value::String)
            .collect(),
    )))
}

// ── instances ──────────────────────────────────────────────────────────────

fn instance_appearance(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
    Ok(Reply::Now(Value::Null))
}

fn instance_css(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
    Ok(Reply::Now(Value::Null))
}

fn instance_click_through(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let on = jbool(p, "on").unwrap_or(false);
    app.set_click_through(&inst.id, on);
    app.refresh_tray_menu();
    Ok(Reply::Now(Value::Null))
}

fn instance_locked(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let on = jbool(p, "on").unwrap_or(false);
    if let Some(target) = app.instance_mut(&inst.id) {
        target.locked = on;
    }
    app.save();
    app.publish_states();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn instance_layer(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let layer = req_str(p, "layer")?;
    app.set_layer(&inst.id, &layer);
    Ok(Reply::Now(Value::Null))
}

fn instance_theme(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let theme = p.get("theme").cloned().unwrap_or(Value::Null);
    if let Some(target) = app.instance_mut(&inst.id) {
        target.theme_id = theme.as_str().map(|s| s.to_string());
    }
    app.save();
    refresh(app, Some(&inst.id));
    Ok(Reply::Now(Value::Null))
}

fn instance_setting(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
    app.push_settings(&inst.id);
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn instance_size(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
    Ok(Reply::Now(Value::Null))
}

fn instance_reload(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    app.reload_instance(&inst.id);
    Ok(Reply::Now(Value::Null))
}

fn instance_devtools(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    if let Some(win) = app.windows.get(&inst.id) {
        win.webview.open_devtools();
    } else {
        app.want_devtools = Some(inst.id.clone());
        app.pending_windows.push(inst.id.clone());
    }
    Ok(Reply::Now(Value::Null))
}

fn instance_identify(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    app.set_visible(&inst.id, true, "control");
    if let Some(win) = app.windows.get(&inst.id) {
        win.window.set_focus();
    }
    app.event_to(&inst.id, "identify", json!({ "ms": 1600 }));
    Ok(Reply::Now(Value::Null))
}

fn instance_duplicate(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let new_id = app
        .duplicate_instance(&inst.id)
        .ok_or_else(|| BridgeError::new("that widget is no longer on the desktop"))?;
    refresh(app, None);
    Ok(Reply::Now(json!({ "id": new_id })))
}

fn instance_remove(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    app.remove_instance(&inst.id);
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(Value::Null))
}

fn instance_clear_all(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    let count = app.cfg().instances.len();
    app.clear_instances();
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(json!({ "removed": count })))
}

fn instance_pick_folder(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let inst = instance_of(app, p)?;
    let key = req_str(p, "key")?;
    let picked = crate::platform::shell::pick("folder", "all", "");
    if let Some(folder) = picked {
        if let Some(target) = app.instance_mut(&inst.id) {
            target.settings.insert(key, Value::String(folder));
        }
        app.save();
        app.push_settings(&inst.id);
        refresh(app, None);
    }
    Ok(Reply::Now(Value::Null))
}

// ── widgets ────────────────────────────────────────────────────────────────

fn widget_add(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
            let consent = json!({ "widget": manifest.id, "then": "load", "permissions": pending });
            app.send_to(
                CONTROL_WIN,
                &format!("{{\"ev\":\"consent\",\"d\":{consent}}}"),
            );
        }
    }
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(json!({ "id": id })))
}

fn widget_grant(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
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
    Ok(Reply::Now(Value::Null))
}

fn widget_open_folder(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let widget = req_str(p, "widget")?;
    let dir: PathBuf = app
        .catalog
        .find(&widget)
        .map(|m| m.dir.clone())
        .ok_or_else(|| BridgeError::new(format!("no widget called {widget}")))?;
    if crate::core::assets::is_virtual(&dir) {
        // 内置组件编在 exe 里，没有文件夹可开：先导出成 .fwz 才有可编辑的副本。
        return Err(BridgeError::new(
            "built-in widgets live inside the exe — export it to a .fwz first, then install that copy",
        ));
    }
    crate::platform::shell::open_path(&dir.to_string_lossy()).map_err(BridgeError::new)?;
    Ok(Reply::Now(Value::Null))
}

fn widget_export(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let widget = req_str(p, "widget")?;
    let out = crate::market::packages::export(app, &widget).map_err(BridgeError::new)?;
    Ok(Reply::Now(out))
}

fn widget_uninstall(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let widget = req_str(p, "widget")?;
    crate::market::packages::uninstall(app, &widget).map_err(BridgeError::new)?;
    app.refresh_tray_menu();
    Ok(Reply::Now(Value::Null))
}

fn widget_create(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let name = req_str(p, "name")?;
    let created = crate::market::packages::create(app, &name).map_err(BridgeError::new)?;
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(created))
}

// ── themes ─────────────────────────────────────────────────────────────────

fn theme_global(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let theme = req_str(p, "id")?;
    if app.themes.get(Some(&theme)).id != theme {
        return Err(BridgeError::new(format!("no theme called {theme}")));
    }
    app.cfg_mut().theme_id = theme;
    app.save();
    refresh_themes(app);
    Ok(Reply::Now(Value::Null))
}

fn theme_override(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let key = req_str(p, "key")?;
    let value = p.get("value").cloned().unwrap_or(Value::Null);
    if value.is_null() {
        app.cfg_mut().theme.remove(&key);
    } else {
        app.cfg_mut().theme.insert(key, value);
    }
    app.save();
    refresh_themes(app);
    Ok(Reply::Now(Value::Null))
}

fn theme_reset(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    app.cfg_mut().theme = Map::new();
    app.cfg_mut().theme_id = crate::model::themes::DEFAULT_ID.to_string();
    app.save();
    refresh_themes(app);
    Ok(Reply::Now(Value::Null))
}

// ── packages ───────────────────────────────────────────────────────────────

fn package_import(app: &mut App, _p: &Value, _id: i64) -> BridgeResult<Reply> {
    if let Some(path) = crate::platform::shell::pick("file", "packages", "") {
        stage_and_show(app, std::path::Path::new(&path));
    }
    Ok(Reply::Now(Value::Null))
}

fn package_cancel(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let token = req_str(p, "token")?;
    if let Some(staged) = app.staged.remove(&token) {
        let _ = std::fs::remove_dir_all(&staged.dir);
    }
    Ok(Reply::Now(Value::Null))
}

fn package_install(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let token = req_str(p, "token")?;
    let result = crate::market::packages::install(app, &token).map_err(BridgeError::new)?;
    app.refresh_tray_menu();
    refresh(app, None);
    Ok(Reply::Now(result))
}

fn package_export(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let widget = req_str(p, "widget")?;
    Ok(Reply::Now(
        crate::market::packages::export(app, &widget).map_err(BridgeError::new)?,
    ))
}

// ── market ─────────────────────────────────────────────────────────────────

fn market_list(app: &mut App, p: &Value, id: i64) -> BridgeResult<Reply> {
    let want_refresh = jbool(p, "refresh").unwrap_or(false);
    let url = crate::market::client::list_url_of(app);
    let site = crate::market::client::site_of(app);
    let cache = crate::market::client::cache_path();
    Ok(spawn(app, id, move || {
        Ok(crate::market::client::fetch_list(
            &url,
            &site,
            &cache,
            want_refresh,
        ))
    }))
}

/// Widget ids with a download in flight. A page that keeps sending `market.install` (slow network,
/// impatient clicking) must not start several downloads of the same package.
fn downloads() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static IN_FLIGHT: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    IN_FLIGHT.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

fn market_install(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let widget = req_str(p, "id")?;
    let list = crate::market::client::cached_list(&crate::market::client::site_of(app));
    let url = crate::market::client::download_url(&list, &widget).map_err(BridgeError::new)?;
    {
        let mut in_flight = downloads().lock().unwrap_or_else(|e| e.into_inner());
        if !in_flight.insert(widget.clone()) {
            return Ok(Reply::Now(
                json!({ "status": "downloading", "id": widget, "already": true }),
            ));
        }
    }
    let proxy = app.proxy.clone();
    let target = widget.clone();
    std::thread::spawn(move || {
        let payload = match crate::market::client::download(&url, &target) {
            Ok(path) => json!({ "ok": true, "id": target, "path": path.to_string_lossy() }),
            Err(e) => json!({ "ok": false, "id": target, "message": e }),
        };
        if let Ok(mut in_flight) = downloads().lock() {
            in_flight.remove(&target);
        }
        crate::runtime::app::post(
            &proxy,
            crate::runtime::app::Ev::Command(format!("market.downloaded:{}", payload)),
        );
    });
    Ok(Reply::Now(json!({ "status": "downloading" })))
}

fn market_open(app: &mut App, p: &Value, _id: i64) -> BridgeResult<Reply> {
    let url = jstr(p, "url");
    crate::market::client::open(app, url).map_err(BridgeError::new)?;
    Ok(Reply::Now(Value::Null))
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
    for id in ids {
        app.push_appearance(&id);
    }
    push_control_state(app);
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
                // A uTools plugin with `preload.js` wants Node.js, which this host does not have.
                "needsNode": staged.node,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_covers_every_method() {
        let r = registry();
        // 57 methods + 1 legacy alias.
        assert_eq!(r.len(), 58);
        // The old and new spellings of the auto-update toggle share one handler.
        assert_eq!(r["app.updateAuto"] as usize, r["app.autoUpdate"] as usize);
        for name in [
            "app.editMode",
            "app.guide",
            "app.hotkey",
            "app.hotkeysPause",
            "app.language",
            "app.uiTheme",
            "app.lockAll",
            "app.openFolder",
            "app.rescan",
            "app.restart",
            "app.setDataDir",
            "app.resetDataDir",
            "app.reveal",
            "app.updateCheck",
            "app.updateInstall",
            "app.updateCancel",
            "app.updatePage",
            "app.updateAuto",
            "app.autoUpdate",
            "app.autostart",
            "app.lowResource",
            "app.developer",
            "app.hideAll",
            "app.pauseFullscreen",
            "app.fileAssociation",
            "app.close",
            "fonts.list",
            "instance.appearance",
            "instance.css",
            "instance.clickThrough",
            "instance.locked",
            "instance.layer",
            "instance.theme",
            "instance.setting",
            "instance.size",
            "instance.reload",
            "instance.devtools",
            "instance.identify",
            "instance.duplicate",
            "instance.remove",
            "instance.clearAll",
            "instance.pickFolder",
            "widget.add",
            "widget.grant",
            "widget.openFolder",
            "widget.export",
            "widget.uninstall",
            "widget.create",
            "theme.global",
            "theme.override",
            "theme.reset",
            "package.import",
            "package.cancel",
            "package.install",
            "package.export",
            "market.list",
            "market.install",
            "market.open",
        ] {
            assert!(r.contains_key(name), "missing method {name}");
        }
    }

    #[test]
    fn unknown_method_is_rejected() {
        assert!(handler_for("app.noSuchMethod").is_err());
        assert!(handler_for("").is_err());
    }
}
