//! Checking for and applying a new version. Nothing happens automatically unless the user asked
//! for it, and a copy that isn't an installed release refuses to update itself.

use crate::runtime::app::App;
use serde_json::{json, Value};
use std::time::Duration;

fn state(app: &App) -> Value {
    app.update.clone()
}

fn set(app: &mut App, value: Value) -> Value {
    app.update = value.clone();
    value
}

pub fn current(app: &mut App) -> Value {
    let mut value = state(app);
    if let Some(obj) = value.as_object_mut() {
        obj.insert("current".into(), json!(crate::APP_VERSION));
        obj.insert("auto".into(), json!(app.cfg().auto_update_check));
    }
    set(app, value)
}

/// Reads the release note at `update_url` and compares versions.
pub fn check(app: &mut App) -> Value {
    let Some(url) = app
        .cfg()
        .update_url
        .clone()
        .filter(|u| !u.trim().is_empty())
    else {
        return set(
            app,
            json!({
                "status": "error", "error": "noChannel",
                "current": crate::APP_VERSION,
                "auto": app.cfg().auto_update_check,
            }),
        );
    };
    set(
        app,
        json!({ "status": "checking", "current": crate::APP_VERSION,
                "auto": app.cfg().auto_update_check }),
    );
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build();
    let result = agent.get(&url).call();
    let value = match result {
        Ok(response) => {
            let text = response.into_string().unwrap_or_default();
            match serde_json::from_str::<Value>(&text) {
                Ok(info) => {
                    let latest = info
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or(crate::APP_VERSION)
                        .to_string();
                    let size = info.get("size").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let notes = info.get("notes").and_then(|v| v.as_str()).unwrap_or("");
                    let page = info
                        .get("page")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let download = info
                        .get("url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let newer = compare(&latest, crate::APP_VERSION) > 0 && download.is_some();
                    json!({
                        "status": if newer { "available" } else { "latest" },
                        "current": crate::APP_VERSION,
                        "latest": latest,
                        "size": size,
                        "notes": notes,
                        "page": page,
                        "url": download,
                        "checkedAt": crate::core::util::now_ms(),
                        "auto": app.cfg().auto_update_check,
                    })
                }
                Err(_) => json!({
                    "status": "error", "error": "offline",
                    "current": crate::APP_VERSION, "auto": app.cfg().auto_update_check,
                }),
            }
        }
        Err(_) => json!({
            "status": "error", "error": "offline",
            "current": crate::APP_VERSION, "auto": app.cfg().auto_update_check,
        }),
    };
    set(app, value)
}

fn compare(a: &str, b: &str) -> i32 {
    let pa: Vec<i64> = a
        .split(['-', '+'])
        .next()
        .unwrap_or(a)
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();
    let pb: Vec<i64> = b
        .split(['-', '+'])
        .next()
        .unwrap_or(b)
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();
    for i in 0..pa.len().max(pb.len()) {
        let x = *pa.get(i).unwrap_or(&0);
        let y = *pb.get(i).unwrap_or(&0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}

/// Downloads the installer, then starts it and quits so the files can be replaced.
pub fn install(app: &mut App) -> Value {
    if app.cfg().developer_mode {
        return set(
            app,
            json!({ "status": "error", "error": "dev", "current": crate::APP_VERSION }),
        );
    }
    let url = app
        .update
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        return set(
            app,
            json!({ "status": "error", "error": "noChannel", "current": crate::APP_VERSION }),
        );
    }
    let latest = app
        .update
        .get("latest")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    set(
        app,
        json!({ "status": "downloading", "latest": latest, "progress": 0.0,
                "current": crate::APP_VERSION }),
    );

    let folder = crate::core::paths::get().local_dir.join("update");
    let _ = std::fs::create_dir_all(&folder);
    let target = folder.join("WinWidget-new.exe");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(120))
        .build();
    let result = (|| -> Result<(), String> {
        let response = agent.get(&url).call().map_err(|e| format!("{e}"))?;
        let mut file = std::fs::File::create(&target).map_err(|e| format!("{e}"))?;
        std::io::copy(&mut response.into_reader(), &mut file).map_err(|e| format!("{e}"))?;
        Ok(())
    })();
    match result {
        Ok(_) => {
            if let Err(e) = crate::platform::shell::launch(&target.to_string_lossy()) {
                let value = set(
                    app,
                    json!({ "status": "error", "error": "failed", "current": crate::APP_VERSION,
                            "detail": e }),
                );
                return value;
            }
            set(
                app,
                json!({ "status": "applying", "latest": latest, "current": crate::APP_VERSION }),
            )
        }
        Err(e) => set(
            app,
            json!({ "status": "error", "error": "download", "current": crate::APP_VERSION,
                    "detail": e }),
        ),
    }
}

pub fn cancel(app: &mut App) -> Value {
    set(
        app,
        json!({ "status": "idle", "current": crate::APP_VERSION }),
    )
}

pub fn page(app: &App) -> Result<(), String> {
    let url = app
        .update
        .get("page")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| app.cfg().update_url.clone())
        .unwrap_or_else(|| crate::market::client::DEFAULT_SITE.to_string());
    crate::platform::shell::open(&url)
}
