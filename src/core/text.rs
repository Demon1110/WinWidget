//! Picks the right language from strings like "時鐘" or { "zh-TW": "時鐘", "en": "Clock" }.

use serde_json::Value;
use std::sync::OnceLock;

static LOCALE: OnceLock<String> = OnceLock::new();

pub fn set_locale(locale: &str) {
    let resolved = if locale.trim().is_empty() || locale.eq_ignore_ascii_case("auto") {
        crate::platform::locale()
    } else {
        locale.to_string()
    };
    let _ = LOCALE.set(resolved);
}

pub fn locale() -> String {
    LOCALE.get().cloned().unwrap_or_else(|| "en".to_string())
}

/// The lookup order for this user: exact tag, aliases, then English.
pub fn candidates(locale: &str) -> Vec<String> {
    let lower = locale.to_lowercase();
    let mut list = vec![locale.to_string()];
    if lower.starts_with("zh") {
        let hans =
            matches!(lower.as_str(), "zh-cn" | "zh-sg" | "zh-hans") || lower.starts_with("zh-hans");
        if hans {
            list.extend(["zh-CN", "zh-Hans", "zh", "zh-TW"].map(String::from));
        } else {
            list.extend(["zh-TW", "zh-Hant", "zh-HK", "zh", "zh-CN"].map(String::from));
        }
    } else if let Some(dash) = locale.find('-') {
        list.push(locale[..dash].to_string());
    }
    list.push("en".to_string());
    list
}

/// A manifest string (a plain string, or a per-language object) in the user's language.
pub fn pick(value: Option<&Value>, fallback: &str) -> String {
    match value {
        None | Some(Value::Null) => fallback.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(map)) => {
            let order = candidates(&locale());
            for key in &order {
                for (k, v) in map {
                    if k.eq_ignore_ascii_case(key) {
                        if let Some(s) = v.as_str() {
                            return s.to_string();
                        }
                    }
                }
            }
            for (_k, v) in map {
                if let Some(s) = v.as_str() {
                    return s.to_string();
                }
            }
            fallback.to_string()
        }
        Some(other) => other.to_string(),
    }
}

fn is_lang_key(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.is_empty() || parts.len() > 2 {
        return false;
    }
    let ok = |p: &str, min: usize, max: usize| {
        (min..=max).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphabetic())
    };
    ok(parts[0], 2, 3) && (parts.len() == 1 || ok(parts[1], 2, 4))
}

/// A setting default given per language ({ "zh-TW": "google", "en": "google" }) → the value for
/// this UI language. Anything else is returned as it is.
pub fn pick_value(value: &Value) -> Value {
    let map = match value {
        Value::Object(m) => m,
        other => return other.clone(),
    };
    if map.is_empty() || !map.keys().all(|k| is_lang_key(k)) {
        return value.clone();
    }
    let order = candidates(&locale());
    for key in &order {
        for (k, v) in map {
            if k.eq_ignore_ascii_case(key) {
                return v.clone();
            }
        }
    }
    map.values().next().cloned().unwrap_or(Value::Null)
}

/// Every language's text of a manifest string, for the library's search box.
pub fn all(value: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    match value {
        Some(Value::String(s)) => out.push(s.clone()),
        Some(Value::Object(map)) => {
            for (_k, v) in map {
                if let Some(s) = v.as_str() {
                    out.push(s.to_string());
                }
            }
        }
        _ => {}
    }
    out
}
