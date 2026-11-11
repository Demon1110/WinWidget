//! The local HTTP server every page talks to.
//!
//! Each widget type lives on its own origin (`<id>.widgets.localhost`), which keeps their storage,
//! relative paths and CSP apart from each other; the port is the only thing shared. Requests for
//! the page itself get the theme CSS, the user's CSS and the boot data injected, exactly like
//! FullWidget's WebResourceRequested handler did.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Request, Response, Server, StatusCode};

pub const CONTROL_HOST: &str = "widgets.localhost";

#[derive(Clone)]
pub struct Host {
    pub widget_id: String,
    pub dir: PathBuf,
    pub entry: String,
    pub csp: String,
    pub theme_href: String,
}

#[derive(Clone)]
pub struct Instance {
    pub host: String,
    pub boot: String,
    pub theme_href: String,
    pub theme_css: String,
    pub user_css: String,
    pub folders: HashMap<String, PathBuf>,
}

#[derive(Default)]
pub struct State {
    pub hosts: HashMap<String, Host>,
    pub instances: HashMap<String, Instance>,
    pub port: u16,
}

#[derive(Clone, Default)]
pub struct ServeState(Arc<Mutex<State>>);

impl ServeState {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.lock().unwrap()
    }
}

pub struct Server_ {
    pub state: ServeState,
    pub port: u16,
}

/// Binds a loopback-only port and serves pages on a background thread.
pub fn start(state: ServeState) -> Result<u16, String> {
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("the local server could not start: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "the local server has no address".to_string())?;
    state.lock().port = port;

    let shared = state.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&shared, request, port);
        }
    });
    Ok(port)
}

fn handle(state: &ServeState, request: Request, port: u16) {
    let method = request.method().as_str().to_ascii_uppercase();
    if method != "GET" && method != "HEAD" {
        let _ = request.respond(text_response(405, "method not allowed"));
        return;
    }
    let host_header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Host"))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default();
    let host = host_header
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let url = request.url().to_string();
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (url.clone(), String::new()),
    };

    if path == "/favicon.ico" {
        let _ = request.respond(Response::empty(StatusCode(204)));
        return;
    }

    let paths = crate::core::paths::get();
    let reply = if let Some(rest) = path.strip_prefix("/__fw/") {
        serve_file(&paths.sdk_dir(), rest, None, None)
    } else if let Some(rest) = path.strip_prefix("/__ui/") {
        serve_file(&paths.ui_dir(), rest, None, None)
    } else if let Some(rest) = path.strip_prefix("/__docs/") {
        serve_file(&paths.docs_dir(), rest, None, None)
    } else if let Some(rest) = path.strip_prefix("/__templates/") {
        serve_file(&paths.templates_dir(), rest, None, None)
    } else if let Some(rest) = path.strip_prefix("/__preview/") {
        let parts: Vec<&str> = rest.splitn(3, '/').collect();
        if parts.len() < 3 {
            None
        } else {
            let root = if parts[0].eq_ignore_ascii_case("user") {
                paths.user_widgets_dir()
            } else {
                paths.builtin_widgets_dir()
            };
            let rel = format!("{}/{}", parts[1], parts[2]);
            serve_file(&root, &rel, None, None)
        }
    } else if let Some(rest) = path.strip_prefix("/__files/") {
        serve_files_request(state, rest, &query)
    } else if let Some(key) = path.strip_prefix("/__media/cover/") {
        crate::platform::media::cover_path(key)
            .and_then(|p| std::fs::read(p).ok())
            .map(|bytes| response(200, "image/png", bytes))
    } else {
        serve_page(state, &host, &path, &query, port)
    };

    match reply {
        Some(response) => {
            let _ = request.respond(response);
        }
        None => {
            let _ = request.respond(text_response(404, "not found"));
        }
    }
}

fn serve_file(
    root: &std::path::Path,
    rel: &str,
    csp: Option<&str>,
    inject: Option<&Instance>,
) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    let mime = crate::core::util::mime_for(rel);
    let is_file_on_disk = crate::core::paths::resolve_inside(root, rel)
        .map(|file| file.is_file())
        .unwrap_or(false);
    // A folder next to the exe wins (development); a shipped single exe has no folder, so the
    // bytes come out of the binary.
    let raw: Vec<u8> = if is_file_on_disk {
        let file = crate::core::paths::resolve_inside(root, rel)?;
        std::fs::read(&file).ok()?
    } else {
        crate::core::assets::read_under(root, rel)?
    };
    let bytes = if mime.starts_with("text/html") && inject.is_some() {
        let text = String::from_utf8_lossy(&raw).to_string();
        let page = inject_page(&text, inject?);
        page.into_bytes()
    } else {
        raw
    };
    let mut resp = response(200, mime, bytes);
    if let Some(policy) = csp {
        if let Ok(h) = Header::from_bytes(&b"Content-Security-Policy"[..], policy.as_bytes()) {
            resp.add_header(h);
        }
    }
    if let Ok(h) = Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]) {
        resp.add_header(h);
    }
    Some(resp)
}

/// `/__files/<instance>/<setting-key>/<path>` — only images, only inside the chosen folder.
fn serve_files_request(
    state: &ServeState,
    rest: &str,
    query: &str,
) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    let parts: Vec<&str> = rest.splitn(3, '/').collect();
    if parts.len() < 3 {
        return None;
    }
    let instance_id = parts[0];
    let key = parts[1];
    let rel = percent_decode(parts[2]);
    let folder = {
        let st = state.lock();
        st.instances.get(instance_id)?.folders.get(key)?.clone()
    };
    let file = crate::core::paths::resolve_inside(&folder, &rel)?;
    if !crate::platform::files::is_image(&file) {
        return None;
    }
    let width = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("w="))
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let bytes = crate::platform::files::thumbnail(&file, width)?;
    let mut resp = response(200, "image/png", bytes);
    if let Ok(h) = Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]) {
        resp.add_header(h);
    }
    Some(resp)
}

fn serve_page(
    state: &ServeState,
    host: &str,
    path: &str,
    query: &str,
    _port: u16,
) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    let paths = crate::core::paths::get();
    if host == CONTROL_HOST || host.trim_start_matches("www.") == CONTROL_HOST {
        let rel = if path == "/" || path.is_empty() {
            "control-center/index.html"
        } else {
            path.trim_start_matches('/')
        };
        return serve_file(&paths.ui_dir(), rel, None, None);
    }
    let st = state.lock();
    let target = st.hosts.get(host)?;
    let instance_id = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("w="))
        .map(|v| v.to_string())
        .or_else(|| {
            st.instances
                .iter()
                .find(|(_, i)| i.host == host)
                .map(|(id, _)| id.clone())
        });
    let instance = instance_id.and_then(|id| st.instances.get(&id).cloned());
    let rel = if path == "/" || path.is_empty() {
        target.entry.clone()
    } else {
        percent_decode(path.trim_start_matches('/'))
    };
    let csp = target.csp.clone();
    let dir = target.dir.clone();
    drop(st);
    match &instance {
        Some(i) => serve_file(&dir, &rel, Some(&csp), Some(i)),
        None => serve_file(&dir, &rel, Some(&csp), None),
    }
}

pub fn text_response(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    response(
        status,
        "text/plain; charset=utf-8",
        body.as_bytes().to_vec(),
    )
}

pub fn response(status: u16, mime: &str, body: Vec<u8>) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap_or_else(|_| {
        Header::from_bytes(&b"Content-Type"[..], &b"application/octet-stream"[..]).unwrap()
    });
    Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(header)
}

/// Inserts the theme links, the boot data and the SDK into a widget's HTML.
fn inject_page(html: &str, inst: &Instance) -> String {
    let boot = &inst.boot;
    let head_block = format!(
        "<link rel=\"stylesheet\" href=\"/__fw/base.css\"><link id=\"__fw_theme_link\" href=\"{href}\"><style id=\"__fw_theme\">{theme}</style><script>window.__FW_BOOT__={boot};</script><script src=\"/__fw/widget-sdk.js\"></script><script src=\"/__fw/utools.js\"></script>",
        href = inst.theme_href,
        theme = inst.theme_css,
        boot = boot
    );
    let tail_block = format!("<style id=\"__fw_user\">{}</style>", inst.user_css);
    let lower = html.to_lowercase();
    let mut out = html.to_string();
    let head_end = lower.find("</head>");
    if let Some(pos) = lower.find("<head>") {
        let insert_at = pos + "<head>".len();
        out.insert_str(insert_at, &head_block);
        if let Some(tail) = head_end {
            let shift = head_block.len();
            let at = tail + shift;
            if at <= out.len() {
                out.insert_str(at, &tail_block);
                return out;
            }
        }
    } else if let Some(pos) = lower.find("<html") {
        let after = lower[pos..].find('>').map(|i| pos + i + 1).unwrap_or(pos);
        out.insert_str(after, &format!("<head>{head_block}</head>"));
        out.push_str(&tail_block);
        return out;
    }
    out.push_str(&tail_block);
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The boot object handed to a page: everything the SDK reads plus a copy of the current look.
pub fn boot_json(
    boot: &crate::runtime::app::Boot,
    settings: &serde_json::Map<String, Value>,
    appearance: &Value,
    state: &Value,
) -> String {
    let value = serde_json::json!({
        "hostVersion": crate::APP_VERSION,
        "instanceId": boot.instance_id,
        "widgetId": boot.widget_id,
        "widgetVersion": boot.widget_version,
        "locale": crate::core::text::locale(),
        "settings": settings,
        "appearance": appearance,
        "state": state,
        "locked": boot.locked,
        "layer": boot.layer,
        "clickThrough": boot.click_through,
        "resizable": boot.resizable,
        "size": {
            "width": boot.width,
            "height": boot.height,
            "grow": boot.grow,
        },
        "developer": boot.developer,
        "permissions": boot.permissions,
    });
    value.to_string()
}
