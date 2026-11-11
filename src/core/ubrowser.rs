//! uBrowser category: a page fetched from the host, not a real embedded browser.
//!
//! uTools' `utools.ubrowser()` drives an Electron browser window: `goto`, `click`, `input`, `wait`,
//! `run`. There is no second browser engine in this build, so only the part that can be answered
//! honestly is answered: a URL is fetched and returned as its title, text and HTML. A chain that
//! needs real interaction says which step it could not run instead of pretending it clicked.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jnum, jstr, BridgeError, BridgeResult};
use serde_json::{json, Value};

const OWNS: &[&str] = &["ubrowser.fetch"];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        "ubrowser.fetch" => {
            // Loading arbitrary pages is its own permission: a widget that fetches the user's URLs
            // must say so in widget.json.
            ctx.require("ubrowser")?;
            let url = jstr(p, "url").unwrap_or_default();
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return Err(BridgeError::new("goto needs an http(s) URL"));
            }
            let timeout = jnum(p, "timeout").unwrap_or(20_000.0) as u64;
            let steps = p
                .get("unsupported")
                .and_then(|s| s.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            ctx.spawn_reply(move || page(&url, timeout, &steps));
            Ok(Reply::Later)
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

fn page(url: &str, timeout_ms: u64, unsupported: &[String]) -> BridgeResult<Value> {
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinWidget")
        .build();
    let body = agent
        .get(url)
        .call()
        .map_err(|e| BridgeError::new(format!("goto failed: {e}")))?
        .into_string()
        .map_err(|e| BridgeError::new(format!("read failed: {e}")))?;
    Ok(json!({
        "url": url,
        "title": title_of(&body),
        "text": text_of(&body),
        "html": body,
        "skipped": unsupported,
    }))
}

/// `<title>` without a full parse.
fn title_of(html: &str) -> String {
    let lower = html.to_lowercase();
    let start = match lower.find("<title") {
        Some(i) => match html[i..].find('>') {
            Some(j) => i + j + 1,
            None => return String::new(),
        },
        None => return String::new(),
    };
    let end = lower[start..]
        .find("</title>")
        .map(|j| start + j)
        .unwrap_or(start);
    html[start..end].trim().to_string()
}

/// Visible-ish text: tags dropped, entities kept as they are, whitespace collapsed.
fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_script = false;
    let mut tag = String::new();
    for ch in html.chars() {
        if !in_tag && ch == '<' {
            in_tag = true;
            tag.clear();
            continue;
        }
        if in_tag {
            if ch == '>' {
                in_tag = false;
                let name = tag
                    .trim_start_matches('/')
                    .to_lowercase()
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string();
                if name == "script" || name == "style" {
                    in_script = !tag.starts_with('/');
                }
            } else if tag.len() < 24 {
                tag.push(ch);
            }
            continue;
        }
        if !in_script {
            out.push(ch);
        }
    }
    let collapsed: Vec<&str> = out.split_whitespace().collect();
    collapsed.join(" ")
}
