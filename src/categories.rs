//! Groups in the widget library ("category" in widget.json); unknown ones fall under "other".

use crate::manifest::Manifest;

pub const KNOWN: [&str; 6] = ["time", "weather", "system", "productivity", "info", "media"];

pub fn of(m: &Manifest) -> String {
    let c = m.category.as_deref().unwrap_or("").trim().to_lowercase();
    if KNOWN.contains(&c.as_str()) {
        c
    } else {
        "other".to_string()
    }
}

pub fn order(category: &str) -> usize {
    KNOWN
        .iter()
        .position(|c| *c == category)
        .unwrap_or(KNOWN.len())
}
