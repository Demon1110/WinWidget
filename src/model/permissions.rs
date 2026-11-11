//! What a widget may do. A widget declares permissions in widget.json; a third-party widget gets
//! them only after the user allows them. Built-in widgets, and widgets the user made here, are
//! trusted with whatever they declare.

use crate::core::config::AppConfig;
use crate::model::manifest::Manifest;

pub const KNOWN: [&str; 12] = [
    "system",
    "notify",
    "audio",
    "media",
    "clipboard",
    "screen",
    "input",
    "schedule",
    "sharp",
    "ubrowser",
    "shell.open",
    "shell.launch",
];

pub fn is_known(p: &str) -> bool {
    KNOWN.contains(&p) || (p.starts_with("network:") && p.len() > "network:".len())
}

pub fn trusted(cfg: &AppConfig, m: &Manifest) -> bool {
    m.builtin
        || cfg
            .own_widgets
            .iter()
            .any(|id| id.eq_ignore_ascii_case(&m.id))
}

/// The declared permissions the widget may use right now.
pub fn allowed(cfg: &AppConfig, m: &Manifest) -> Vec<String> {
    let known: Vec<String> = m
        .permissions
        .iter()
        .filter(|p| is_known(p))
        .map(|p| p.to_string())
        .collect::<Vec<_>>();
    let mut deduped: Vec<String> = Vec::new();
    for p in known {
        if !deduped.iter().any(|x| x.eq_ignore_ascii_case(&p)) {
            deduped.push(p);
        }
    }
    if trusted(cfg, m) {
        return deduped;
    }
    let granted = cfg
        .grants
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(&m.id))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    deduped
        .into_iter()
        .filter(|p| granted.iter().any(|g| g.eq_ignore_ascii_case(p)))
        .collect()
}

/// Declared permissions still waiting for the user's OK.
pub fn pending(cfg: &AppConfig, m: &Manifest) -> Vec<String> {
    let ok = allowed(cfg, m);
    let mut out: Vec<String> = Vec::new();
    for p in m.permissions.iter().filter(|p| is_known(p)) {
        if ok.iter().any(|x| x.eq_ignore_ascii_case(p)) {
            continue;
        }
        if !out.iter().any(|x| x.eq_ignore_ascii_case(p)) {
            out.push(p.clone());
        }
    }
    out
}

/// Allows everything the widget declares (what the user just saw and accepted).
pub fn grant(cfg: &mut AppConfig, m: &Manifest) {
    let list = m
        .permissions
        .iter()
        .filter(|p| is_known(p))
        .cloned()
        .collect();
    cfg.grants.insert(m.id.clone(), list);
}

pub fn has(allowed: &[String], permission: &str) -> bool {
    allowed.iter().any(|p| p.eq_ignore_ascii_case(permission))
}

/// Network hosts from the allowed permissions: "api.example.com", "*.example.com" or "*".
pub fn hosts(allowed: &[String]) -> Vec<String> {
    allowed
        .iter()
        .filter(|p| p.to_lowercase().starts_with("network:"))
        .map(|p| p["network:".len()..].trim().to_lowercase())
        .filter(|h| !h.is_empty())
        .collect()
}

pub fn allows_host(allowed: &[String], host: &str) -> bool {
    let host = host.to_lowercase();
    for pattern in hosts(allowed) {
        if pattern == "*" || pattern == host {
            return true;
        }
        if let Some(rest) = pattern.strip_prefix("*.") {
            if host == rest || host.ends_with(&format!(".{rest}")) {
                return true;
            }
        }
    }
    false
}

/// Content-Security-Policy for a widget page: its own origin, plus only the hosts it may reach.
/// Inline scripts and eval stay allowed so any framework works.
pub fn content_security_policy(allowed: &[String]) -> String {
    let mut sources: Vec<String> = Vec::new();
    for h in hosts(allowed) {
        if h == "*" {
            for s in ["https:", "http:", "wss:", "ws:"] {
                sources.push(s.to_string());
            }
            continue;
        }
        let list: Vec<String> = if let Some(rest) = h.strip_prefix("*.") {
            vec![rest.to_string(), h.clone()]
        } else {
            vec![h.clone()]
        };
        for x in list {
            if valid_host_pattern(&x) {
                for scheme in ["https", "http", "wss", "ws"] {
                    sources.push(format!("{scheme}://{x}"));
                }
            }
        }
    }
    sources.dedup();
    let net = sources.join(" ");
    format!(
        "default-src 'self' data: blob: {net}; \
         script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: {net}; \
         style-src 'self' 'unsafe-inline' data: {net}; \
         form-action 'none'; base-uri 'self'; object-src 'none'"
    )
}

fn valid_host_pattern(s: &str) -> bool {
    let s = s.trim_start_matches("*.");
    let (host, port) = match s.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (s, None),
    };
    if host.is_empty() {
        return false;
    }
    let host_ok = host
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.' || c == '*');
    let port_ok = port
        .map(|p| p.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(true);
    host_ok && port_ok
}
