//! The shared look every widget gets:
//!   built-in defaults ← theme defaults (theme.json) ← the user's global tweaks ← the instance's own.
//! Each layer becomes CSS variables, so widgets only need to use `var(--w-*)`.

use serde_json::{Map, Value};
use std::collections::HashMap;

pub const SHADOW_MARGIN_DIP: f64 = 20.0;

pub fn defaults() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("style".into(), Value::String("transparent".into()));
    m.insert("background".into(), Value::String("#161822".into()));
    m.insert("backgroundOpacity".into(), Value::from(0.62));
    m.insert("textColor".into(), Value::String("#ffffff".into()));
    m.insert("accentColor".into(), Value::String("#4cc9f0".into()));
    m.insert("fontFamily".into(), Value::String(String::new()));
    m.insert("fontScale".into(), Value::from(1.0));
    m.insert("radius".into(), Value::from(16));
    m.insert("shadow".into(), Value::Bool(true));
    m.insert("padding".into(), Value::from(16));
    m.insert("opacity".into(), Value::from(1.0));
    m
}

pub fn theme_of(
    themes: &crate::model::themes::Themes,
    cfg: &crate::core::config::AppConfig,
    inst: Option<&crate::core::config::InstanceConfig>,
) -> crate::model::themes::ThemeInfo {
    let id = inst
        .and_then(|i| i.theme_id.as_deref())
        .unwrap_or(cfg.theme_id.as_str());
    themes.get(Some(id))
}

fn known_into(target: &mut Map<String, Value>, source: &Map<String, Value>) {
    let keys = defaults();
    for (k, v) in source {
        if keys.contains_key(k) {
            target.insert(k.clone(), v.clone());
        }
    }
}

/// Theme defaults plus the user's global tweaks: the keys the `:root` layer sets.
fn theme_layer(
    themes: &crate::model::themes::Themes,
    cfg: &crate::core::config::AppConfig,
    inst: Option<&crate::core::config::InstanceConfig>,
) -> Map<String, Value> {
    let mut d = Map::new();
    known_into(&mut d, &theme_of(themes, cfg, inst).appearance);
    known_into(&mut d, &cfg.theme);
    resolve(themes, d)
}

pub fn effective(
    themes: &crate::model::themes::Themes,
    cfg: &crate::core::config::AppConfig,
    inst: Option<&crate::core::config::InstanceConfig>,
) -> Map<String, Value> {
    let mut d = defaults();
    known_into(&mut d, &theme_layer(themes, cfg, inst));
    if let Some(i) = inst {
        known_into(&mut d, &i.appearance);
    }
    resolve(themes, d)
}

/// "system" as a colour means the Windows accent colour.
fn resolve(themes: &crate::model::themes::Themes, mut d: Map<String, Value>) -> Map<String, Value> {
    if d.get("accentColor").and_then(|v| v.as_str()) == Some("system") {
        d.insert(
            "accentColor".into(),
            Value::String(themes.system_accent.clone()),
        );
    }
    d
}

pub fn style(a: &Map<String, Value>) -> String {
    match a.get("style").and_then(|v| v.as_str()) {
        Some("frosted") => "frosted".into(),
        _ => "transparent".into(),
    }
}

pub fn shadow(a: &Map<String, Value>) -> bool {
    a.get("shadow").and_then(|v| v.as_bool()).unwrap_or(false)
}

pub fn margin_dip(a: &Map<String, Value>) -> i32 {
    if style(a) == "transparent" && shadow(a) {
        SHADOW_MARGIN_DIP as i32
    } else {
        0
    }
}

/// The two style blocks a widget page gets: theme (`:root`) and instance (`html:root`).
pub fn page_css(
    themes: &crate::model::themes::Themes,
    cfg: &crate::core::config::AppConfig,
    inst: &crate::core::config::InstanceConfig,
) -> (String, String) {
    let theme_layer = theme_layer(themes, cfg, Some(inst));
    let mut theme_merged = defaults();
    known_into(&mut theme_merged, &theme_layer);
    let all = effective(themes, cfg, Some(inst));

    let mut theme = css(&theme_layer, &theme_merged, ":root", None);
    let accent_var = format!("--w-system-accent:{};", themes.system_accent);
    theme.insert_str(":root{".len(), &accent_var);

    let mut user_layer = Map::new();
    known_into(&mut user_layer, &inst.appearance);
    let user_layer = resolve(themes, user_layer);
    let margin = margin_dip(&all);
    let mut user = css(&user_layer, &all, "html:root", Some(margin));
    if let Some(custom) = inst.custom_css.as_ref().filter(|c| !c.trim().is_empty()) {
        user.push('\n');
        user.push_str(&custom.replace("</", "<\\/"));
    }
    (theme, user)
}

fn num(d: &Map<String, Value>, key: &str, def: f64) -> f64 {
    d.get(key).and_then(|v| v.as_f64()).unwrap_or(def)
}

fn text(d: &Map<String, Value>, key: &str) -> String {
    d.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// CSS for one layer. `layer` = the keys this layer sets; `merged` = the values in effect at this
/// layer, for variables built from several keys (such as the background colour).
fn css(
    layer: &Map<String, Value>,
    merged: &Map<String, Value>,
    selector: &str,
    margin: Option<i32>,
) -> String {
    let mut out = String::with_capacity(400);
    out.push_str(selector);
    out.push('{');
    let mut var = |name: &str, value: &str| {
        out.push_str("--w-");
        out.push_str(name);
        out.push(':');
        out.push_str(value);
        out.push(';');
    };

    if layer.contains_key("background")
        || layer.contains_key("backgroundOpacity")
        || layer.contains_key("style")
    {
        let frosted = style(merged) == "frosted";
        let (r, g, b) =
            crate::core::util::parse_color(&text(merged, "background")).unwrap_or((22, 24, 34));
        let mut op = num(merged, "backgroundOpacity", 0.62).clamp(0.0, 1.0);
        if frosted {
            op *= 0.45; // the blur already gives the card body
        }
        var(
            "bg",
            &format!("rgba({r},{g},{b},{})", crate::core::util::fmt_num(op)),
        );
        var("bg-solid", &format!("rgb({r},{g},{b})"));
    }
    if layer.contains_key("textColor") {
        var(
            "fg",
            &crate::core::util::css_safe(&text(layer, "textColor")),
        );
    }
    if layer.contains_key("accentColor") {
        var(
            "accent",
            &crate::core::util::css_safe(&text(layer, "accentColor")),
        );
    }
    if layer.contains_key("fontFamily") {
        let font = text(layer, "fontFamily");
        if !font.is_empty() {
            var(
                "font",
                &format!(
                    "{},var(--w-font-fallback)",
                    crate::core::util::css_safe(&font)
                ),
            );
        }
    }
    if layer.contains_key("fontScale") {
        var(
            "font-scale",
            &crate::core::util::fmt_num(num(layer, "fontScale", 1.0).clamp(0.5, 3.0)),
        );
    }
    if layer.contains_key("radius") {
        var(
            "radius",
            &format!(
                "{}px",
                crate::core::util::fmt_num(num(layer, "radius", 16.0).clamp(0.0, 64.0))
            ),
        );
    }
    if layer.contains_key("padding") {
        var(
            "padding",
            &format!(
                "{}px",
                crate::core::util::fmt_num(num(layer, "padding", 16.0).clamp(0.0, 64.0))
            ),
        );
    }
    if layer.contains_key("opacity") {
        var(
            "opacity",
            &crate::core::util::fmt_num(num(layer, "opacity", 1.0).clamp(0.1, 1.0)),
        );
    }
    if layer.contains_key("shadow") && !shadow(layer) {
        var("shadow", "0 0 0 transparent"); // base.css combines this with an inset border
    }
    if let Some(m) = margin {
        var("margin", &format!("{m}px"));
    }
    out.push('}');
    out
}

/// Tint for the frosted backdrop, in the ABGR layout the accent policy wants.
pub fn frosted_tint(a: &Map<String, Value>) -> u32 {
    let (r, g, b) = crate::core::util::parse_color(&text(a, "background")).unwrap_or((22, 24, 34));
    let op = num(a, "backgroundOpacity", 0.62).clamp(0.0, 1.0);
    let alpha = (0x10 as f64 + op * 0x60 as f64).round() as u32;
    (alpha << 24) | ((b as u32) << 16) | ((g as u32) << 8) | r as u32
}

/// The appearance keys the control center edits, in the order it shows them.
pub fn keys() -> HashMap<&'static str, &'static str> {
    HashMap::new()
}
