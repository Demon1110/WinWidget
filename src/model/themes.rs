//! Global looks: `sdk/themes/<id>/theme.json` carries the name plus the appearance defaults the
//! host itself needs (card style, colours); `theme.css` is the rest, loaded by the pages.

use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::Path;

pub const DEFAULT_ID: &str = "instrument";

#[derive(Debug, Clone, Deserialize)]
pub struct ThemeInfo {
    pub id: String,
    pub name: Option<Value>,
    pub description: Option<Value>,
    #[serde(default)]
    pub appearance: Map<String, Value>,
}

impl ThemeInfo {
    pub fn display_name(&self) -> String {
        crate::core::text::pick(self.name.as_ref(), &self.id)
    }
    pub fn description(&self) -> String {
        crate::core::text::pick(self.description.as_ref(), "")
    }
    pub fn css_href(&self) -> String {
        format!("/__fw/themes/{}/theme.css", self.id)
    }
}

#[derive(Debug, Default)]
pub struct Themes {
    pub all: Vec<ThemeInfo>,
    pub system_accent: String,
}

impl Themes {
    pub fn load() -> Themes {
        let mut all = Vec::new();
        let dir = crate::core::paths::get().themes_dir();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let file = entry.path().join("theme.json");
                if !file.is_file() {
                    continue;
                }
                match crate::core::util::read_text(&file)
                    .ok()
                    .and_then(|t| serde_json::from_str::<ThemeInfo>(&t).ok())
                {
                    Some(t) if !t.id.is_empty() => all.push(t),
                    Some(_) => {}
                    None => {
                        crate::core::logging::warn(&format!("Theme {} skipped", file.display()))
                    }
                }
            }
        }
        all.sort_by(|a, b| {
            let ka = if a.id == DEFAULT_ID { 0 } else { 1 };
            let kb = if b.id == DEFAULT_ID { 0 } else { 1 };
            ka.cmp(&kb).then_with(|| a.id.cmp(&b.id))
        });
        let system_accent = system_accent_color();
        crate::core::logging::info(&format!(
            "Themes: {}; system accent {system_accent}",
            all.iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
        Themes { all, system_accent }
    }

    pub fn get(&self, id: Option<&str>) -> ThemeInfo {
        let want = id.unwrap_or("");
        self.all
            .iter()
            .find(|t| t.id.eq_ignore_ascii_case(want))
            .or_else(|| self.all.iter().find(|t| t.id == DEFAULT_ID))
            .cloned()
            .unwrap_or(ThemeInfo {
                id: DEFAULT_ID.into(),
                name: None,
                description: None,
                appearance: Map::new(),
            })
    }

    pub fn ids(&self) -> Vec<String> {
        self.all.iter().map(|t| t.id.clone()).collect()
    }

    /// The Windows accent colour, in the brighter shade Windows uses on dark surfaces.
    pub fn refresh_accent(&mut self) {
        self.system_accent = system_accent_color();
    }
}

fn system_accent_color() -> String {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent")
    {
        if let Ok(palette) = key.get_raw_value("AccentPalette") {
            let bytes = palette.bytes;
            if bytes.len() >= 8 {
                // Entries are lightest → darkest; entry 1 is "light 2".
                return format!("#{:02x}{:02x}{:02x}", bytes[4], bytes[5], bytes[6]);
            }
        }
    }
    if let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\DWM") {
        if let Ok(abgr) = key.get_value::<u32, _>("AccentColor") {
            return format!(
                "#{:02x}{:02x}{:02x}",
                abgr & 0xff,
                (abgr >> 8) & 0xff,
                (abgr >> 16) & 0xff
            );
        }
    }
    "#60cdff".to_string()
}

pub fn theme_file_exists(id: &str) -> bool {
    let dir = crate::core::paths::get().themes_dir();
    Path::new(&dir).join(id).join("theme.css").is_file()
}
