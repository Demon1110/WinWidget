//! Checking for and applying a new version.
//!
//! Nothing happens automatically unless the user asked for it, and a copy that isn't an installed
//! release refuses to update itself. Both the check and the download run on a worker thread: the
//! check alone can wait 8 s for a connection and the download minutes, and doing that on the UI
//! thread froze the controls, the cards and the tray for as long as it took.

use crate::runtime::app::{self, App, Ev};
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Where the version comes from when `update_url` is empty: the project's own releases.
pub const DEFAULT_FEED: &str = "https://api.github.com/repos/Demon1110/WinWidget/releases/latest";

/// Set while a download is cancelled, so the worker stops instead of finishing anyway.
static CANCEL: AtomicBool = AtomicBool::new(false);

fn set(app: &mut App, value: Value) -> Value {
    app.update = value.clone();
    value
}

fn idle(app: &App) -> Value {
    json!({ "status": "idle", "current": crate::APP_VERSION,
            "auto": app.cfg().auto_update_check })
}

/// The feed to read: the user's own address, or the GitHub release of this project.
pub fn feed_url(app: &App) -> String {
    app.cfg()
        .update_url
        .clone()
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_FEED.to_string())
}

/// The state the control center renders. Takes `&App` because every push recomputes it, so the
/// page never shows a stale `auto` flag after a background check replaced the last release.
pub fn current(app: &App) -> Value {
    let mut value = app.update.clone();
    if let Some(obj) = value.as_object_mut() {
        obj.insert("current".into(), json!(crate::APP_VERSION));
        obj.insert("auto".into(), json!(app.cfg().auto_update_check));
        obj.insert("feed".into(), json!(feed_url(app)));
        obj.entry("latest").or_insert(json!(crate::APP_VERSION));
    } else {
        value = idle(app);
        if let Some(obj) = value.as_object_mut() {
            obj.insert("feed".into(), json!(feed_url(app)));
        }
    }
    value
}

/// `{"version": …, "url": …, …}` is our own feed; a GitHub release document is `tag_name` +
/// `assets`. Both end up as the same object, so the control center has one shape to render.
fn parse_release(text: &str) -> Result<Value, String> {
    let info: Value = serde_json::from_str(text).map_err(|_| "offline".to_string())?;
    if let Some(tag) = info.get("tag_name").and_then(|v| v.as_str()) {
        let assets = info
            .get("assets")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        // An installer first, then any other executable; a zip is not something to run.
        let pick = |want: &dyn Fn(&str) -> bool| {
            assets
                .iter()
                .find(|a| {
                    let name = a
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_lowercase();
                    want(&name)
                })
                .cloned()
        };
        let asset = pick(&|n| n.contains("setup") && n.ends_with(".exe"))
            .or_else(|| pick(&|n| n.ends_with(".exe")));
        let (url, size, name) = match &asset {
            Some(a) => (
                a.get("browser_download_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                a.get("size").and_then(|v| v.as_f64()).unwrap_or(0.0),
                a.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("WinWidget-new.exe")
                    .to_string(),
            ),
            None => (String::new(), 0.0, "WinWidget-new.exe".to_string()),
        };
        let version = tag.trim_start_matches(['v', 'V']).to_string();
        return Ok(json!({
            "version": version,
            "size": size,
            "notes": info.get("body").and_then(|v| v.as_str()).unwrap_or(""),
            "page": info.get("html_url").and_then(|v| v.as_str()),
            "url": if url.is_empty() { Value::Null } else { json!(url) },
            "file": name,
        }));
    }
    let version = info
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("offline")?
        .to_string();
    Ok(json!({
        "version": version,
        "size": info.get("size").and_then(|v| v.as_f64()).unwrap_or(0.0),
        "notes": info.get("notes").and_then(|v| v.as_str()).unwrap_or(""),
        "page": info.get("page").and_then(|v| v.as_str()),
        "url": info.get("url").and_then(|v| v.as_str()),
        "file": Value::Null,
    }))
}

/// One client for the check and the download, with the same proxy the widgets use. A machine
/// behind a system proxy reaches GitHub in a browser but not over a bare socket, and the check
/// would then just report "offline" forever.
fn agent(connect: u64, read: u64, total: u64) -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(connect))
        .timeout_read(Duration::from_secs(read))
        .timeout(Duration::from_secs(total))
        // GitHub answers 404 to a request without one; other feeds ignore it.
        .user_agent(concat!("WinWidget/", env!("CARGO_PKG_VERSION")));
    if let Some(address) = crate::core::net::system_proxy() {
        match ureq::Proxy::new(&address) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(e) => crate::core::logging::warn(&format!("ignoring proxy {address}: {e}")),
        }
    }
    builder.build()
}

fn fetch_release(url: &str) -> Value {
    let agent = agent(8, 15, 15);
    let text = match agent.get(url).call() {
        Ok(response) => response.into_string().unwrap_or_default(),
        // GitHub answers 404 until the first release is published, and that is not a network
        // problem: saying "offline" sent people looking at their proxy for nothing.
        Err(ureq::Error::Status(404, _)) => {
            return json!({
                "status": "error", "error": "noRelease", "current": crate::APP_VERSION,
                "feed": url, "checkedAt": crate::core::util::now_ms(),
            })
        }
        Err(_) => String::new(),
    };
    match parse_release(&text) {
        Ok(info) => {
            let latest = info
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or(crate::APP_VERSION)
                .to_string();
            let download = info
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let newer = compare(&latest, crate::APP_VERSION) > 0;
            // A newer release with nothing to run is not "you are up to date": say so, because
            // 404-free releases that only carry a zip are exactly what a portable build looks like.
            let missing = newer && download.is_none();
            json!({
                "status": if !newer { "latest" } else if missing { "error" } else { "available" },
                "error": if missing { json!("noAsset") } else { Value::Null },
                "current": crate::APP_VERSION,
                "latest": latest,
                "size": info.get("size").cloned().unwrap_or(json!(0)),
                "notes": info.get("notes").cloned().unwrap_or(json!("")),
                "page": info.get("page").cloned().unwrap_or(Value::Null),
                "url": download,
                "file": info.get("file").cloned().unwrap_or(Value::Null),
                "feed": url,
                "checkedAt": crate::core::util::now_ms(),
            })
        }
        Err(error) => json!({
            "status": "error", "error": error, "current": crate::APP_VERSION, "feed": url,
        }),
    }
}

/// Starts the check on a worker thread and answers with the state the page should show meanwhile.
pub fn check_async(app: &mut App) -> Value {
    let url = feed_url(app);
    let auto = app.cfg().auto_update_check;
    let busy = app.update.get("status").and_then(|v| v.as_str()) == Some("checking");
    if !busy {
        let state = json!({ "status": "checking", "current": crate::APP_VERSION,
                            "auto": auto, "feed": url, "latest": crate::APP_VERSION });
        set(app, state.clone());
        let proxy = app.proxy.clone();
        std::thread::spawn(move || {
            let value = fetch_release(&url);
            let _ = app::post(&proxy, Ev::Command(format!("update:{value}")));
        });
        return state;
    }
    current(app)
}

/// Synchronous check, kept for the CLI and for the tests.
pub fn check(app: &mut App) -> Value {
    let url = feed_url(app);
    set(
        app,
        json!({ "status": "checking", "current": crate::APP_VERSION,
                "auto": app.cfg().auto_update_check, "feed": url }),
    );
    let value = fetch_release(&url);
    set(app, value)
}

fn compare(a: &str, b: &str) -> i32 {
    let parts = |v: &str| -> Vec<i64> {
        // GitHub tags carry a leading "v" ("v1.1"), our own feed does not.
        v.trim_start_matches(['v', 'V'])
            .split(['-', '+'])
            .next()
            .unwrap_or(v)
            .split('.')
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    let pa = parts(a);
    let pb = parts(b);
    for i in 0..pa.len().max(pb.len()) {
        let x = *pa.get(i).unwrap_or(&0);
        let y = *pb.get(i).unwrap_or(&0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}

/// Downloads the installer on a worker thread, reporting progress as it goes, then starts it and
/// quits so the files can be replaced.
pub fn install_async(app: &mut App) -> Value {
    if app.cfg().developer_mode {
        let value = json!({ "status": "error", "error": "dev", "current": crate::APP_VERSION });
        set(app, value.clone());
        return value;
    }
    let url = app
        .update
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        let value =
            json!({ "status": "error", "error": "noChannel", "current": crate::APP_VERSION });
        set(app, value.clone());
        return value;
    }
    let latest = app
        .update
        .get("latest")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let file = app
        .update
        .get("file")
        .and_then(|v| v.as_str())
        .filter(|n| n.to_lowercase().ends_with(".exe"))
        .unwrap_or("WinWidget-new.exe")
        .to_string();
    let total = app
        .update
        .get("size")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let state = json!({ "status": "downloading", "latest": latest, "progress": 0.0,
                        "current": crate::APP_VERSION, "size": total });
    set(app, state.clone());
    CANCEL.store(false, Ordering::SeqCst);
    let proxy = app.proxy.clone();
    let folder = crate::core::paths::get().local_dir.join("update");
    std::thread::spawn(move || download(&proxy, &url, &latest, &file, total, &folder));
    state
}

fn download(
    proxy: &tao::event_loop::EventLoopProxy<Ev>,
    url: &str,
    latest: &str,
    file: &str,
    total: f64,
    folder: &std::path::Path,
) {
    let fail = |error: &str, detail: String| -> Value {
        json!({ "status": "error", "error": error, "current": crate::APP_VERSION,
                "detail": detail })
    };
    let _ = std::fs::create_dir_all(folder);
    let target = folder.join(file);
    let agent = agent(10, 120, 600);
    let response = match agent.get(url).call() {
        Ok(r) => r,
        Err(e) => {
            let _ = app::post(
                proxy,
                Ev::Command(format!("update:{}", fail("download", e.to_string()))),
            );
            return;
        }
    };
    let expect = response
        .header("content-length")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(total);
    let mut reader = response.into_reader();
    let mut out = match std::fs::File::create(&target) {
        Ok(f) => f,
        Err(e) => {
            let _ = app::post(
                proxy,
                Ev::Command(format!("update:{}", fail("readonly", e.to_string()))),
            );
            return;
        }
    };
    let mut buffer = vec![0u8; 64 * 1024];
    let mut done = 0f64;
    let mut reported = Instant::now();
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            drop(out);
            let _ = std::fs::remove_file(&target);
            let _ = app::post(
                proxy,
                Ev::Command(format!(
                    "update:{}",
                    json!({ "status": "idle", "current": crate::APP_VERSION })
                )),
            );
            return;
        }
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                use std::io::Write;
                if let Err(e) = out.write_all(&buffer[..n]) {
                    let _ = app::post(
                        proxy,
                        Ev::Command(format!("update:{}", fail("readonly", e.to_string()))),
                    );
                    return;
                }
                done += n as f64;
                // Four reports a second is plenty for a progress bar and keeps the UI thread free.
                if reported.elapsed() >= Duration::from_millis(250) {
                    reported = Instant::now();
                    let progress = if expect > 0.0 {
                        (done / expect).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let _ = app::post(
                        proxy,
                        Ev::Command(format!(
                            "update:{}",
                            json!({ "status": "downloading", "latest": latest,
                                    "progress": progress, "current": crate::APP_VERSION,
                                    "size": expect })
                        )),
                    );
                }
            }
            Err(e) => {
                let _ = app::post(
                    proxy,
                    Ev::Command(format!("update:{}", fail("download", e.to_string()))),
                );
                return;
            }
        }
    }
    use std::io::Write;
    let _ = out.flush();
    drop(out);
    if done <= 0.0 {
        let _ = app::post(
            proxy,
            Ev::Command(format!(
                "update:{}",
                fail("download", "the server sent an empty file".into())
            )),
        );
        return;
    }
    // Something that cannot even be read as an executable is a broken download, not an update.
    let mut head = [0u8; 2];
    if let Ok(mut probe) = std::fs::File::open(&target) {
        let _ = probe.read_exact(&mut head);
    }
    if &head != b"MZ" {
        let _ = app::post(
            proxy,
            Ev::Command(format!(
                "update:{}",
                fail(
                    "verify",
                    "the downloaded file is not a Windows program".into()
                )
            )),
        );
        return;
    }
    match crate::platform::shell::launch(&target.to_string_lossy()) {
        Ok(_) => {
            let _ = app::post(
                proxy,
                Ev::Command(format!(
                    "update:{}",
                    json!({ "status": "applying", "latest": latest,
                            "current": crate::APP_VERSION, "progress": 1.0 })
                )),
            );
        }
        Err(e) => {
            let _ = app::post(proxy, Ev::Command(format!("update:{}", fail("failed", e))));
        }
    }
}

pub fn cancel(app: &mut App) -> Value {
    CANCEL.store(true, Ordering::SeqCst);
    set(
        app,
        json!({ "status": "idle", "current": crate::APP_VERSION,
                "auto": app.cfg().auto_update_check }),
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

#[cfg(test)]
mod tests {
    use super::{compare, parse_release};

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare("1.0.10", "1.0.9"), 1);
        assert_eq!(compare("v1.1", "1.0"), 1);
        assert_eq!(compare("1.0", "1.0.0"), 0);
        assert_eq!(compare("0.9", "1.0"), -1);
    }

    #[test]
    fn a_github_release_becomes_the_same_shape_as_our_own_feed() {
        let text = r#"{"tag_name":"v1.2.0","body":"notes","html_url":"https://x/rel",
            "assets":[{"name":"WinWidget-1.2.0-setup.exe","size":123,"browser_download_url":"https://x/a.exe"}]}"#;
        let v = parse_release(text).expect("github release");
        assert_eq!(v["version"], "1.2.0");
        assert_eq!(v["url"], "https://x/a.exe");
        assert_eq!(v["file"], "WinWidget-1.2.0-setup.exe");
        let own = parse_release(r#"{"version":"1.3.0","url":"https://x/b.exe","notes":"n"}"#)
            .expect("own feed");
        assert_eq!(own["version"], "1.3.0");
    }

    #[test]
    fn a_release_with_only_a_zip_has_nowhere_to_install_from() {
        let text = r#"{"tag_name":"v1.2.0","html_url":"https://x/rel",
            "assets":[{"name":"WinWidget-1.2.0-windows-x64.zip","size":999,
            "browser_download_url":"https://x/a.zip"}]}"#;
        let v = parse_release(text).expect("github release");
        assert_eq!(v["version"], "1.2.0");
        // 挑资产时明确不拿 zip 当更新包：zip 不是能直接跑起来的东西
        assert!(v["url"].is_null());
    }
}
