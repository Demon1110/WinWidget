//! The online widget list. A market address can be given with `market_url` in config.json;
//! without one this build reads the WinWidgetHub pages site, so the market works out of the box.

use crate::runtime::app::App;
use serde_json::{json, Value};
use std::time::Duration;

/// 软件更新页面的兜底地址（不是组件市场）。
pub const DEFAULT_SITE: &str = "https://github.com/Demon1110/WinWidgetHub";

/// “在網站上看／怎樣投稿”打开的网页版市场首页。
pub const MARKET_SITE: &str = "https://demon1110.github.io/WinWidgetHub/";

/// 没有配置 `market_url` 时读的清单：WinWidgetHub 的 Pages 站点。
/// 不走 raw.githubusercontent.com：国内网络经常连不上，清单就一直拉不下来。
/// 清单里的下载地址、预览图都是绝对网址，所以这里直接给文件地址，不加 `/widgets.json`。
pub const DEFAULT_LIST: &str = "https://demon1110.github.io/WinWidgetHub/widgets.json";

/// Pages 连不上时的备选：仓库里的原始文件。两个域名在国内被墙的情况不一样，留一条后路。
pub const FALLBACK_LIST: &str =
    "https://raw.githubusercontent.com/Demon1110/WinWidgetHub/main/widgets.json";

/// 配置了自己地址就只读那个地址；默认地址则 Pages 失败后换 raw。
fn candidates(url: &str) -> Vec<&str> {
    if url == DEFAULT_LIST {
        vec![DEFAULT_LIST, FALLBACK_LIST]
    } else {
        vec![url]
    }
}

fn site(app: &App) -> String {
    page_of(app.cfg().market_url.as_deref())
}

/// The page “在網站上看” opens: the market address without a `*.json` list in it.
fn page_of(market_url: Option<&str>) -> String {
    let Some(url) = market_url.map(str::trim).filter(|u| !u.is_empty()) else {
        return MARKET_SITE.to_string();
    };
    if url.ends_with(".json") {
        return match url.rsplit_once('/') {
            Some((dir, _)) if !dir.is_empty() => dir.to_string(),
            _ => MARKET_SITE.to_string(),
        };
    }
    url.to_string()
}

fn list_url(app: &App) -> String {
    let configured = app
        .cfg()
        .market_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty());
    match configured {
        Some(site) if site.ends_with(".json") => site.to_string(),
        Some(site) => format!("{}/widgets.json", site.trim_end_matches('/')),
        None => DEFAULT_LIST.to_string(),
    }
}

fn cache_file() -> std::path::PathBuf {
    crate::core::paths::get().market_file()
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
    let mut errors: Vec<String> = Vec::new();
    for candidate in candidates(url) {
        match agent
            .get(candidate)
            .set("Accept", "application/json")
            .call()
        {
            Ok(response) => {
                let text = response.into_string().unwrap_or_default();
                match serde_json::from_str::<Value>(&text) {
                    Ok(mut value) => {
                        if let Some(parent) = cache.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(cache, &text);
                        let count = value
                            .get("widgets")
                            .and_then(|w| w.as_array())
                            .map(|w| w.len())
                            .unwrap_or(0);
                        crate::core::logging::info(&format!(
                            "Market: {count} widget(s) from {candidate}"
                        ));
                        decorate(&mut value, site_name);
                        return value;
                    }
                    Err(e) => {
                        let msg = format!("{candidate}: the market list could not be read: {e}");
                        crate::core::logging::warn(&msg);
                        errors.push(msg);
                    }
                }
            }
            Err(e) => {
                let msg = format!("{candidate}: {e}");
                crate::core::logging::warn(&msg);
                errors.push(msg);
            }
        }
    }

    match cached {
        Some(text) => match serde_json::from_str::<Value>(&text) {
            Ok(mut value) => {
                crate::core::logging::warn("Market: network failed, using the cached list");
                decorate(&mut value, site_name);
                if let Some(obj) = value.as_object_mut() {
                    obj.insert("offline".into(), Value::Bool(true));
                }
                value
            }
            Err(_) => json!({ "widgets": [], "site": site_name, "offline": false,
                              "error": errors.join("; ") }),
        },
        None => {
            json!({ "widgets": [], "site": site_name, "offline": false, "error": errors.join("; ") })
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_page_is_the_web_market() {
        assert_eq!(page_of(None), MARKET_SITE);
        assert_eq!(page_of(Some("   ")), MARKET_SITE);
        assert_eq!(page_of(Some(MARKET_SITE)), MARKET_SITE);
    }

    #[test]
    fn a_json_market_url_opens_the_folder_that_holds_it() {
        assert_eq!(
            page_of(Some(
                "https://demon1110.github.io/WinWidgetHub/widgets.json"
            )),
            "https://demon1110.github.io/WinWidgetHub"
        );
        assert_eq!(page_of(Some("widgets.json")), MARKET_SITE);
    }
}
