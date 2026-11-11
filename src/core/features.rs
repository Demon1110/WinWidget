//! 动态功能 category: the functions a widget adds while it runs.
//!
//! A widget normally declares its commands in `widget.json`; `getFeatures` / `setFeature` /
//! `removeFeature` let it add, change or drop them at runtime (a web-launcher builds one entry per
//! site the user saved). WinWidget keeps those in `data/features.json`, one list per widget, so they
//! survive a restart the way uTools' do. The control center reads the same file when it lists what a
//! widget can be asked to do.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use serde_json::{Map, Value};

const OWNS: &[&str] = &["features.get", "features.set", "features.remove"];
const FILE_NAME: &str = "features.json";

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

fn file() -> std::path::PathBuf {
    crate::core::paths::data_dir().join(FILE_NAME)
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
