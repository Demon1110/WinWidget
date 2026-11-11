//! 快捷入口 category: send a command label to the widget that answers it.
//!
//! uTools `redirect(label)` finds the plugin that owns a command and opens it; `label` as
//! `[pluginName, label]` names both. WinWidget has no plugin market, so a redirect resolves inside
//! what is installed: a widget whose display name (or id) matches is shown, and a widget that has
//! that command in its runtime features is shown too. When nothing matches, the answer is `false`
//! rather than an invented success.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use serde_json::{json, Value};

const OWNS: &[&str] = &[
    "redirect.to",
    "redirect.hotkey",
    "redirect.hotkeyGet",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        "redirect.to" => {
            // `[pluginName, label]` names the widget; a bare string is the command, which is
            // searched across the installed widgets' runtime features.
            let (plugin, label) = match p.get("label") {
                Some(Value::Array(a)) => (
                    a.first().and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    a.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                ),
                Some(Value::String(s)) => (String::new(), s.clone()),
                _ => return Err(BridgeError::new("label is required")),
            };
            let target = find_widget(ctx, &plugin, &label);
            match target {
                Some(widget_id) => Ok(Reply::Now(json!(open(ctx, &widget_id)))), 
                None => Ok(Reply::Now(Value::Bool(false))),
            }
        }
        // uTools sends the user to the global-shortcut settings page for one command. The control
        // center's settings page is where WinWidget keeps hotkeys, so that is where this goes.
        "redirect.hotkey" => {
            ctx.app.show_control(Some("settings"));
            Ok(Reply::Now(Value::Null))
        }
        "redirect.hotkeyGet" => {
            let label = jstr(p, "cmdLabel").unwrap_or_default();
            let keys = ctx
                .app
                .cfg()
                .hotkeys
                .iter()
                .find(|(action, _)| action.eq_ignore_ascii_case(&label))
                .map(|(_, keys)| keys.clone())
                .filter(|keys| !keys.trim().is_empty());
            Ok(Reply::Now(match keys {
                Some(keys) => Value::String(keys),
                None => Value::Null,
            }))
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// Which widget owns this command: an explicit plugin name wins, otherwise the command label is
/// searched in every installed widget's runtime features and in its display name.
fn find_widget(ctx: &Ctx, plugin: &str, label: &str) -> Option<String> {
    if !plugin.is_empty() {
        let found = ctx
            .app
            .catalog
            .all()
            .find(|m| {
                m.display_name().eq_ignore_ascii_case(plugin) || m.id.eq_ignore_ascii_case(plugin)
            })
            .map(|m| m.id.clone());
        if found.is_some() {
            return found;
        }
    }
    if label.is_empty() {
        return None;
    }
    for manifest in ctx.app.catalog.all() {
        if manifest.display_name().eq_ignore_ascii_case(label)
            || manifest.id.eq_ignore_ascii_case(label)
        {
            return Some(manifest.id.clone());
        }
        if crate::core::features::features_of(&manifest.id)
            .iter()
            .any(|f| command_matches(f, label))
        {
            return Some(manifest.id.clone());
        }
    }
    None
}

fn command_matches(feature: &Value, label: &str) -> bool {
    feature
        .get("cmds")
        .and_then(|c| c.as_array())
        .map(|cmds| {
            cmds.iter().any(|cmd| match cmd {
                Value::String(s) => s == label,
                Value::Object(o) => o
                    .get("label")
                    .and_then(|l| l.as_str())
                    .map(|l| l == label)
                    .unwrap_or(false),
                _ => false,
            })
        })
        .unwrap_or(false)
}

/// Shows the widget's first card, or adds one when the widget is installed but not on screen.
fn open(ctx: &mut Ctx, widget_id: &str) -> bool {
    if let Some(instance) = ctx
        .app
        .cfg()
        .instances
        .iter()
        .find(|i| i.widget.eq_ignore_ascii_case(widget_id))
        .map(|i| i.id.clone())
    {
        ctx.app.set_visible(&instance, true, "api");
        ctx.app.refresh_tray_menu();
        return true;
    }
    match ctx.app.add_widget(widget_id, None) {
        Ok(_) => true,
        Err(e) => {
            crate::core::logging::warn(&format!("redirect: {e}"));
            false
        }
    }
}
