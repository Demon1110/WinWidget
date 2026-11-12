//! 动态功能 category: the functions a widget adds while it runs.
//!
//! A widget normally declares its commands in `widget.json`; `getFeatures` / `setFeature` /
//! `removeFeature` let it add, change or drop them at runtime (a web-launcher builds one entry per
//! site the user saved). WinWidget keeps those in `<data>\db\app\features.json`, one list per widget,
//! so they survive a restart the way uTools' do. The control center reads the same file when it lists
//! what a widget can be asked to do.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use serde_json::{Map, Value};

const OWNS: &[&str] = &["features.get", "features.set", "features.remove"];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    let widget = ctx.manifest.id.clone();
    match method {
        "features.get" => {
            let only: Option<Vec<String>> =
                p.get("codes").and_then(|c| c.as_array()).map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                });
            let data = load();
            let list = data
                .get(&widget)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|f| match &only {
                            Some(codes) => f
                                .get("code")
                                .and_then(|c| c.as_str())
                                .map(|c| codes.iter().any(|x| x == c))
                                .unwrap_or(false),
                            None => true,
                        })
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            Ok(Reply::Now(Value::Array(list)))
        }
        "features.set" => {
            let feature = p
                .get("feature")
                .cloned()
                .ok_or_else(|| BridgeError::new("feature is required"))?;
            let code = jstr(&feature, "code").unwrap_or_default();
            if code.is_empty() {
                return Err(BridgeError::new("feature.code is required"));
            }
            if !feature.get("cmds").map(|c| c.is_array()).unwrap_or(false) {
                return Err(BridgeError::new("feature.cmds must be an array"));
            }
            let mut data = load();
            let mut list = data
                .get(&widget)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            // Same code means "replace", which is what `setFeature` documents.
            list.retain(|f| f.get("code").and_then(|c| c.as_str()) != Some(code.as_str()));
            list.push(feature);
            data.insert(widget, Value::Array(list));
            save(&data)?;
            Ok(Reply::Now(Value::Null))
        }
        "features.remove" => {
            let code = jstr(p, "code").unwrap_or_default();
            let mut data = load();
            let before = data
                .get(&widget)
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            if let Some(list) = data.get_mut(&widget).and_then(|v| v.as_array_mut()) {
                list.retain(|f| f.get("code").and_then(|c| c.as_str()) != Some(code.as_str()));
            }
            save(&data)?;
            let after = data
                .get(&widget)
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            Ok(Reply::Now(Value::Bool(after < before)))
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// The runtime features a widget has right now, and its declared ones from `widget.json`, in one
/// list — what a launcher would search.
pub fn features_of(widget: &str) -> Vec<Value> {
    load()
        .get(widget)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

// ── Cmd matching ────────────────────────────────────────────────────────────
//
// uTools decides whether a command answers the main input box by its `Cmd.type`: "regex" runs
// `match`/`exclude` as regular expressions, "over" shows the command whenever the input contains
// `match`, "files" only when files were dropped, "img"/"window" only for those payload kinds.
// `minLength`/`maxLength` bound the input either way.

/// Which command of this widget answers `text` — `(feature code, command label)`.
pub fn match_command(widget: &str, text: &str) -> Option<(String, String)> {
    for feature in features_of(widget) {
        let code = jstr(&feature, "code").unwrap_or_default();
        let Some(cmds) = feature.get("cmds").and_then(|c| c.as_array()) else {
            continue;
        };
        if let Some(label) = cmds
            .iter()
            .find(|c| cmd_matches(c, text, &[]))
            .and_then(label_of)
        {
            return Some((code, label));
        }
    }
    None
}

/// Does this `Cmd` (a plain string label, or an object with `type`/`match`/`exclude`) accept the input?
pub fn cmd_matches(cmd: &Value, text: &str, files: &[String]) -> bool {
    let obj = match cmd {
        // A bare string is an exact label, which is how uTools treats `cmds: ["label"]`.
        Value::String(label) => return label == text,
        other => other,
    };
    let len = text.chars().count();
    let min = number(obj, "minLength").unwrap_or(0);
    let max = number(obj, "maxLength").unwrap_or(usize::MAX);
    if len < min || len > max {
        return false;
    }
    match jstr(obj, "type").unwrap_or_else(|| "over".to_string()).as_str() {
        "img" => false,
        "window" => false,
        "files" => {
            if files.is_empty() {
                return false;
            }
            match obj.get("extensions").and_then(|v| v.as_array()) {
                Some(exts) => files.iter().any(|f| {
                    exts.iter()
                        .filter_map(|e| e.as_str())
                        .any(|e| f.to_ascii_lowercase().ends_with(&e.to_ascii_lowercase()))
                }),
                None => true,
            }
        }
        "regex" => {
            let pattern = jstr(obj, "match").unwrap_or_default();
            if pattern.is_empty() {
                return !text.is_empty();
            }
            if !regex_hit(&pattern, text) {
                return false;
            }
            match jstr(obj, "exclude") {
                Some(exclude) if !exclude.is_empty() => !regex_hit(&exclude, text),
                _ => true,
            }
        }
        // "over" (uTools' default): the command covers any input that contains `match`.
        _ => match jstr(obj, "match") {
            Some(m) if !m.is_empty() => text.contains(&m),
            _ => true,
        },
    }
}

fn label_of(cmd: &Value) -> Option<String> {
    match cmd {
        Value::String(s) => Some(s.clone()),
        other => jstr(other, "label"),
    }
}

fn number(obj: &Value, key: &str) -> Option<usize> {
    obj.get(key).and_then(|v| v.as_u64()).map(|n| n as usize)
}

/// `regex-lite` compiles once per pattern and keeps it; a bad pattern is remembered as "never".
fn regex_hit(pattern: &str, text: &str) -> bool {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, Option<regex_lite::Regex>>>> =
        std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = match cache.lock() {
        Ok(map) => map,
        Err(poisoned) => poisoned.into_inner(),
    };
    let entry = map
        .entry(pattern.to_string())
        .or_insert_with(|| regex_lite::Regex::new(pattern).ok());
    match entry {
        Some(re) => re.is_match(text),
        None => false,
    }
}


fn file() -> std::path::PathBuf {
    crate::core::paths::get().features_file()
}

fn load() -> Map<String, Value> {
    std::fs::read_to_string(file())
        .ok()
        .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
        .unwrap_or_default()
}

fn save(data: &Map<String, Value>) -> BridgeResult<()> {
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| BridgeError::new(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(data).map_err(|e| BridgeError::new(e.to_string()))?;
    std::fs::write(path, text).map_err(|e| BridgeError::new(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn regex_cmd_matches_and_honours_exclude_and_length() {
        let cmd = json!({ "type": "regex", "label": "打开链接", "match": "^https?://", "exclude": "example\\.com", "minLength": 8 });
        assert!(cmd_matches(&cmd, "https://a.b/c", &[]));
        assert!(!cmd_matches(&cmd, "https://example.com", &[]));
        assert!(!cmd_matches(&cmd, "ftp://a", &[]));
        assert!(!cmd_matches(&cmd, "http://", &[]));
    }

    #[test]
    fn over_cmd_is_a_substring_test() {
        let with_match = json!({ "type": "over", "label": "翻译", "match": "translate" });
        assert!(cmd_matches(&with_match, "please translate this", &[]));
        assert!(!cmd_matches(&with_match, "unrelated", &[]));
        let plain = json!({ "label": "计算器" });
        assert!(cmd_matches(&plain, "anything at all", &[]));
    }

    #[test]
    fn files_cmd_needs_a_matching_extension() {
        let cmd = json!({ "type": "files", "label": "压缩图片", "extensions": [".png", ".jpg"] });
        assert!(cmd_matches(&cmd, "", &["C:\\a\\B.PNG".to_string()]));
        assert!(!cmd_matches(&cmd, "", &["C:\\a\\b.txt".to_string()]));
        assert!(!cmd_matches(&cmd, "", &[]));
    }

    #[test]
    fn img_and_window_cmds_never_answer_text() {
        assert!(!cmd_matches(&json!({ "type": "img", "label": "识图" }), "x", &[]));
        assert!(!cmd_matches(&json!({ "type": "window", "label": "贴边" }), "x", &[]));
    }

    #[test]
    fn a_broken_pattern_never_matches() {
        assert!(!cmd_matches(&json!({ "type": "regex", "label": "坏", "match": "([a-" }), "a", &[]));
    }
}