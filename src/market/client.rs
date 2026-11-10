//! The online widget list. There is no server baked in: a market address comes from
//! `market_url` in config.json, and without one the page says so plainly instead of pretending.

use crate::runtime::app::App;
use serde_json::{json, Value};
use std::time::Duration;

pub const DEFAULT_SITE: &str = "https://winwidget.example/market";

fn site(app: &App) -> String {
    app.cfg()
        .market_url
        .clone()
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SITE.to_string())
}

fn list_url(app: &App) -> String {
    let site = site(app);
    if site.ends_with(".json") {
        site
    } else {
        format!("{}/widgets.json", site.trim_end_matches('/'))
    }
}

fn cache_file() -> std::path::PathBuf {
    crate::core::paths::get().local_dir.join("market.json")
}

pub fn site_of(app: &App) -> String {
    site(app)
}

pub fn list_url_of(app: &App) -> String {
    list_url(app)
}

pub fn cache_path() -> std::path::PathBuf {
    cache_file()
}

/// Runs off the main thread: it only touches the network and a cache file.
pub fn fetch_list(url: &str, site_name: &str, cache: &std::path::Path, refresh: bool) -> Value {
    let cached = crate::core::util::read_text(cache).ok();
    if let Some(text) = &cached {
        if !refresh {
            if let Ok(mut value) = serde_json::from_str::<Value>(text) {
                decorate(&mut value, site_name);
                return value;
            }
        }
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build();
    match agent.get(url).set("Accept", "application/json").call() {
        Ok(response) => {
            let text = response.into_string().unwrap_or_default();
            match serde_json::from_str::<Value>(&text) {
                Ok(mut value) => {
                    if let Some(parent) = cache.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(cache, &text);
                    decorate(&mut value, site_name);
                    value
                }
                Err(e) => json!({ "widgets": [], "site": site_name, "offline": false,
                                  "error": format!("the market list could not be read: {e}") }),
            }
        }
        Err(e) => match cached {
            Some(text) => match serde_json::from_str::<Value>(&text) {
                Ok(mut value) => {
                    decorate(&mut value, site_name);
                    if let Some(obj) = value.as_object_mut() {
                        obj.insert("offline".into(), Value::Bool(true));
                    }
                    value
                }
                Err(_) => {
                    json!({ "widgets": [], "site": site_name, "offline": false, "error": format!("{e}") })
                }
            },
            None => {
                json!({ "widgets": [], "site": site_name, "offline": false, "error": format!("{e}") })
            }
        },
    }
}

/// The download address of one widget in the cached list. Runs on the main thread (no I/O).
pub fn download_url(list: &Value, id: &str) -> Result<String, String> {
    let empty = Vec::new();
    let widgets = list
        .get("widgets")
        .and_then(|w| w.as_array())
        .unwrap_or(&empty);
    let entry = widgets
        .iter()
        .find(|w| w.get("id").and_then(|i| i.as_str()) == Some(id))
        .ok_or_else(|| format!("\"{id}\" is not in the market list"))?;
    entry
        .get("download")
        .or_else(|| entry.get("url"))
        .and_then(|u| u.as_str())
        .filter(|u| u.starts_with("http"))
        .map(|u| u.to_string())
        .ok_or_else(|| {
            format!(
                "\"{id}\" has no download address in the market list — use \"open the page\" instead"
            )
        })
}

/// Downloads a package. Runs off the main thread and returns where the file landed.
pub fn download(url: &str, id: &str) -> Result<std::path::PathBuf, String> {
    let folder = crate::core::paths::get().staging_dir().join("download");
    std::fs::create_dir_all(&folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let target = folder.join(format!("{}.fwz", sanitise(id)));
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build();
    let response = agent.get(url).call().map_err(|e| format!("{e}"))?;
    let mut file =
        std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    std::io::copy(&mut response.into_reader(), &mut file).map_err(|e| format!("{e}"))?;
    Ok(target)
}

fn sanitise(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// The list as it sits on disk, for `market.install` when the page has already loaded it.
pub fn cached_list(site_name: &str) -> Value {
    let path = cache_file();
    let text = crate::core::util::read_text(&path).unwrap_or_else(|_| "{}".into());
    let mut value: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
    decorate(&mut value, site_name);
    value
}

fn decorate(value: &mut Value, site: &str) {
    if let Some(obj) = value.as_object_mut() {
        if obj.get("widgets").map(|w| !w.is_array()).unwrap_or(true) {
            obj.insert("widgets".into(), Value::Array(Vec::new()));
        }
        obj.entry("site")
            .or_insert_with(|| Value::String(site.to_string()));
        obj.entry("offline").or_insert(Value::Bool(false));
    }
}

pub fn open(app: &App, url: Option<String>) -> Result<(), String> {
    let target = match url {
        Some(u) if u.starts_with("http://") || u.starts_with("https://") => u,
        Some(_) => return Err("only web addresses can be opened".into()),
        None => site(app),
    };
    crate::platform::shell::open(&target)
}
