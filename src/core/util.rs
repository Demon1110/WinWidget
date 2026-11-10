//! Small shared helpers: JSON access, MIME types, colours, numbers.

use serde_json::{json, Value};
use std::path::Path;

/// An error meant for the widget page (a rejected promise), not a host bug.
#[derive(Debug)]
pub struct BridgeError(pub String);

impl BridgeError {
    pub fn new(msg: impl Into<String>) -> Self {
        BridgeError(msg.into())
    }
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BridgeError {}

pub type BridgeResult<T> = Result<T, BridgeError>;

// ── JSON helpers ────────────────────────────────────────────────────────────

/// Reads a UTF-8 text file and drops a leading BOM: Notepad, PowerShell and Excel add one,
/// and `serde_json` fails on it — which would silently reset a hand-edited config.
pub fn read_text(path: &Path) -> std::io::Result<String> {
    let text = std::fs::read_to_string(path)?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

pub fn jstr(p: &Value, key: &str) -> Option<String> {
    p.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub fn jnum(p: &Value, key: &str) -> Option<f64> {
    p.get(key).and_then(|v| v.as_f64())
}

pub fn jbool(p: &Value, key: &str) -> Option<bool> {
    p.get(key).and_then(|v| v.as_bool())
}

pub fn req_str(p: &Value, key: &str) -> BridgeResult<String> {
    match jstr(p, key) {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err(BridgeError::new(format!("missing parameter '{key}'"))),
    }
}

/// The value of `key`, or JSON null when absent (what the page sent is passed through).
pub fn prop(p: &Value, key: &str) -> Value {
    p.get(key).cloned().unwrap_or(Value::Null)
}

pub fn arr<'a>(p: &'a Value, key: &str) -> &'a [Value] {
    p.get(key)
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
}

// ── numbers ─────────────────────────────────────────────────────────────────

/// One decimal at most, no trailing ".0": numbers go into CSS and labels.
pub fn fmt_num(v: f64) -> String {
    if (v - v.round()).abs() < f64::EPSILON * 8.0 {
        format!("{}", v.round() as i64)
    } else {
        let s = format!("{v:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

// ── colours ─────────────────────────────────────────────────────────────────

/// "#rgb" / "#rrggbb" / "#rrggbbaa" → (r, g, b).
pub fn parse_color(s: &str) -> Option<(u8, u8, u8)> {
    let t = s.trim().trim_start_matches('#');
    let t = if t.len() == 3 {
        t.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        t.to_string()
    };
    if !(t.len() == 6 || t.len() == 8) {
        return None;
    }
    let r = u8::from_str_radix(&t[0..2], 16).ok()?;
    let g = u8::from_str_radix(&t[2..4], 16).ok()?;
    let b = u8::from_str_radix(&t[4..6], 16).ok()?;
    Some((r, g, b))
}

// ── files ───────────────────────────────────────────────────────────────────

pub fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "txt" | "md" => "text/plain; charset=utf-8",
        "fwz" | "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// True when `child` stays inside `root` (after resolving), so a request cannot walk out.
pub fn inside(root: &Path, child: &Path) -> bool {
    match (root.to_str(), child.to_str()) {
        (Some(r), Some(c)) => {
            let r = r.trim_end_matches(['\\', '/']).to_ascii_lowercase();
            let c = c.to_ascii_lowercase();
            c.starts_with(&format!("{r}\\")) || c.starts_with(&format!("{r}/"))
        }
        _ => false,
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn logs_dir_hint() -> String {
    crate::core::paths::log_file().to_string_lossy().to_string()
}

pub fn to_utf8_lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

/// JSON for a CSS string: the smallest escape rule is enough for the values we write.
pub fn css_safe(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, ';' | '{' | '}' | '<' | '>' | '\\'))
        .collect()
}

pub fn json_ok() -> Value {
    json!(true)
}
