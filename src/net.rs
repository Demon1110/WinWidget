//! `widget.fetch`: a request made by the host, so a widget can reach a host it declared as
//! `network:<host>` without CORS. Redirects are followed by hand so every hop is re-checked.

use serde_json::{json, Map, Value};
use std::io::Read;
use std::time::Duration;

const MAX_REDIRECTS: usize = 6;
const MAX_BYTES: usize = 8 * 1024 * 1024;

pub struct FetchRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub base64: bool,
}

pub fn fetch(allowed: &[String], req: FetchRequest) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout(Duration::from_secs(20))
        .redirects(0)
        .build();

    let mut url = req.url.clone();
    let mut method = req.method.to_uppercase();
    let mut body = req.body.clone();

    for _hop in 0..=MAX_REDIRECTS {
        let (host, scheme) = split_url(&url)?;
        if scheme != "http" && scheme != "https" {
            return Err("only http and https addresses can be fetched".into());
        }
        if !crate::permissions::allows_host(allowed, &host) {
            return Err(format!(
                "\"{host}\" is not allowed: add \"network:{host}\" to permissions in widget.json and allow it in the control center"
            ));
        }

        let mut call = agent.request(&method, &url);
        call = call.set("User-Agent", &format!("WinWidget/{}", crate::APP_VERSION));
        for (k, v) in &req.headers {
            call = call.set(k, v);
        }
        let response = if let Some(payload) = &body {
            call.send_string(payload)
        } else {
            call.call()
        };

        let response = match response {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                if matches!(code, 301 | 302 | 303 | 307 | 308) {
                    if let Some(next) = r.header("Location") {
                        if code == 303 || (code == 301 || code == 302) && method == "POST" {
                            method = "GET".into();
                            body = None;
                        }
                        url = join_url(&url, next);
                        continue;
                    }
                }
                r
            }
            Err(ureq::Error::Transport(e)) => return Err(format!("{e}")),
        };

        let status = response.status();
        let status_text = response.status_text().to_string();
        let mut headers = Map::new();
        for name in response.headers_names() {
            let combined: Vec<String> = response
                .all(&name)
                .iter()
                .map(|v| v.to_string())
                .collect();
            headers.insert(name.to_lowercase(), Value::String(combined.join(", ")));
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("the response could not be read: {e}"))?;
        if bytes.len() > MAX_BYTES {
            return Err("the response is larger than 8 MB".into());
        }

        let (body_text, encoding) = if req.base64 {
            (crate::platform::win32::base64(&bytes), "base64")
        } else {
            (String::from_utf8_lossy(&bytes).to_string(), "text")
        };
        return Ok(json!({
            "url": url,
            "status": status,
            "statusText": status_text,
            "ok": (200..300).contains(&status),
            "headers": headers,
            "body": body_text,
            "encoding": encoding,
        }));
    }
    Err("too many redirects".into())
}

fn split_url(url: &str) -> Result<(String, String), String> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| format!("\"{url}\" is not a full address"))?;
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .to_string();
    let host = host.split(':').next().unwrap_or("").to_lowercase();
    if host.is_empty() {
        return Err(format!("\"{url}\" has no host"));
    }
    Ok((scheme.to_lowercase(), host))
}

fn join_url(base: &str, next: &str) -> String {
    if next.starts_with("http://") || next.starts_with("https://") {
        return next.to_string();
    }
    let (scheme, rest) = base.split_once("://").unwrap_or(("https", base));
    let host = rest.split('/').next().unwrap_or("");
    if next.starts_with('/') {
        format!("{scheme}://{host}{next}")
    } else {
        let path = base.rsplit_once('/').map(|(p, _)| p).unwrap_or(base);
        format!("{path}/{next}")
    }
}
