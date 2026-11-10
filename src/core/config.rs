//! `config.json`: the layout (which widgets sit where), the global look and the app's settings.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub version: i32,
    pub first_run_done: bool,
    /// "auto" follows Windows.
    pub language: String,
    /// Turns off hardware acceleration and asks WebView2 to use less memory (takes a restart).
    pub low_resource_mode: bool,
    /// Enables DevTools (F12) and reload-on-save in widgets.
    pub developer_mode: bool,
    pub hide_all: bool,
    /// While a full-screen app covers a monitor, its widgets hide.
    pub pause_on_fullscreen: bool,
    pub theme_id: String,
    /// The user's global appearance tweaks on top of the theme.
    pub theme: Map<String, Value>,
    /// Permissions the user allowed, per third-party widget id.
    pub grants: HashMap<String, Vec<String>>,
    /// Widgets this user made with "new widget": the author is the user, so they're trusted.
    pub own_widgets: Vec<String>,
    pub market_url: Option<String>,
    /// Where new versions are announced, e.g. ".../app.json"; unset = no update channel.
    pub update_url: Option<String>,
    pub auto_update_check: bool,
    pub update_notified: Option<String>,
    /// System-wide shortcuts, e.g. "notes": "Ctrl+Alt+N"; "" = off.
    pub hotkeys: HashMap<String, String>,
    pub instances: Vec<InstanceConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            version: 1,
            first_run_done: false,
            language: "auto".into(),
            low_resource_mode: false,
            developer_mode: false,
            hide_all: false,
            pause_on_fullscreen: true,
            theme_id: crate::model::themes::DEFAULT_ID.to_string(),
            theme: Map::new(),
            grants: HashMap::new(),
            own_widgets: Vec::new(),
            market_url: None,
            update_url: None,
            auto_update_check: false,
            update_notified: None,
            hotkeys: default_hotkeys(),
            instances: Vec::new(),
        }
    }
}

fn default_hotkeys() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("notes".to_string(), "Ctrl+Alt+N".to_string());
    m.insert("control".to_string(), "Ctrl+Alt+W".to_string());
    m
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct InstanceConfig {
    pub id: String,
    pub widget: String,
    /// Top-left of the card in physical screen pixels (the shadow margin is not included).
    pub x: i32,
    pub y: i32,
    /// Card size in device-independent pixels.
    pub width: f64,
    pub height: f64,
    /// "desktop" | "normal" | "top"
    pub layer: String,
    pub locked: bool,
    pub click_through: bool,
    /// Overrides the global theme for this instance only.
    pub theme_id: Option<String>,
    pub settings: Map<String, Value>,
    pub appearance: Map<String, Value>,
    pub custom_css: Option<String>,
}

impl Default for InstanceConfig {
    fn default() -> Self {
        InstanceConfig {
            id: new_id(),
            widget: String::new(),
            x: 40,
            y: 40,
            width: 240.0,
            height: 120.0,
            layer: "desktop".into(),
            locked: false,
            click_through: false,
            theme_id: None,
            settings: Map::new(),
            appearance: Map::new(),
            custom_css: None,
        }
    }
}

pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed) as u128;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let mix = nanos ^ (n << 32) ^ (pid << 8);
    format!("{:x}", mix & 0xffff_ffff_ffff)
}

/// Loads and saves config.json. The file is written whole and atomically, so a crash never
/// leaves half a layout behind.
pub struct ConfigStore {
    pub data: AppConfig,
}

impl ConfigStore {
    pub fn load() -> ConfigStore {
        let file = crate::core::paths::get().config_file();
        if !file.is_file() {
            return ConfigStore {
                data: AppConfig::default(),
            };
        }
        match crate::core::util::read_text(&file) {
            Ok(text) => match serde_json::from_str::<AppConfig>(&text) {
                Ok(data) => ConfigStore { data },
                Err(e) => {
                    let stamp = crate::platform::now_stamp();
                    let backup = file.with_file_name(format!("config.json.broken-{stamp}"));
                    let _ = std::fs::copy(&file, &backup);
                    crate::core::logging::error(&format!(
                        "Config unreadable ({e}), backed up to {}",
                        backup.display()
                    ));
                    ConfigStore {
                        data: AppConfig::default(),
                    }
                }
            },
            Err(e) => {
                crate::core::logging::error(&format!("Config could not be read: {e}"));
                ConfigStore {
                    data: AppConfig::default(),
                }
            }
        }
    }

    pub fn save(&self) {
        let file = crate::core::paths::get().config_file();
        let text = match serde_json::to_string_pretty(&self.data) {
            Ok(t) => t,
            Err(e) => {
                crate::core::logging::error(&format!("Config could not be serialised: {e}"));
                return;
            }
        };
        let tmp = file.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, text) {
            crate::core::logging::error(&format!("Config save failed: {e}"));
            return;
        }
        if let Err(e) = std::fs::rename(&tmp, &file) {
            crate::core::logging::error(&format!("Config replace failed: {e}"));
        }
    }
}
