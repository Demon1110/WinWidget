//! A widget's `widget.json`: name, size, permissions and the settings the control center builds a
//! form from. Unknown keys are ignored, so widget authors can add their own.

use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Manifest {
    pub id: String,
    pub name: Option<Value>,
    pub description: Option<Value>,
    pub version: String,
    pub author: Option<String>,
    pub entry: String,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub preview: Option<String>,
    pub size: SizeSpec,
    pub layer: Option<String>,
    pub permissions: Vec<String>,
    pub settings: Vec<SettingSpec>,

    #[serde(skip)]
    pub dir: PathBuf,
    #[serde(skip)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SizeSpec {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub max_width: f64,
    pub max_height: f64,
    pub resizable: bool,
    /// How much the content grows when the card is bigger than its default size (0–1).
    pub grow: f64,
}

impl Default for SizeSpec {
    fn default() -> Self {
        SizeSpec {
            width: 240.0,
            height: 120.0,
            min_width: 80.0,
            min_height: 48.0,
            max_width: 2000.0,
            max_height: 2000.0,
            resizable: true,
            grow: 0.0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SettingSpec {
    pub key: String,
    /// toggle | text | textarea | number | slider | select | color | font | file | folder
    pub r#type: String,
    pub label: Option<Value>,
    pub description: Option<Value>,
    pub default: Option<Value>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub placeholder: Option<Value>,
    pub options: Option<Vec<OptionSpec>>,
}

impl Default for SettingSpec {
    fn default() -> Self {
        SettingSpec {
            key: String::new(),
            r#type: "text".into(),
            label: None,
            description: None,
            default: None,
            min: None,
            max: None,
            step: None,
            placeholder: None,
            options: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OptionSpec {
    pub value: Value,
    pub label: Option<Value>,
}

impl Manifest {
    pub fn display_name(&self) -> String {
        crate::text::pick(self.name.as_ref(), &self.id)
    }

    pub fn description(&self) -> String {
        crate::text::pick(self.description.as_ref(), "")
    }

    /// Each widget type gets its own origin, so their storage is isolated; all share the site
    /// "widgets.localhost", which Chromium resolves to this machine.
    pub fn host_name(&self) -> String {
        let clean: String = self
            .id
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
            .collect();
        format!("{clean}.widgets.localhost")
    }

    pub fn declares(&self, permission: &str) -> bool {
        self.permissions.iter().any(|p| p.eq_ignore_ascii_case(permission))
    }

    /// Loose check the catalog runs before a widget appears in the library.
    pub fn validate(&mut self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("widget.json has no \"id\"".into());
        }
        if !valid_id(&self.id) {
            return Err(format!(
                "\"{}\" is not a valid id: use lowercase letters, digits, dots, dashes and underscores (2–64 characters)",
                self.id
            ));
        }
        if self.entry.trim().is_empty() {
            self.entry = "index.html".into();
        }
        let entry = self.dir.join(self.entry.replace('\\', "/"));
        if !entry.is_file() {
            return Err(format!("the entry file \"{}\" is missing", self.entry));
        }
        if self.version.trim().is_empty() {
            self.version = "0.0.0".into();
        }
        let s = &mut self.size;
        s.min_width = s.min_width.clamp(32.0, 4000.0);
        s.min_height = s.min_height.clamp(32.0, 4000.0);
        s.max_width = s.max_width.max(s.min_width);
        s.max_height = s.max_height.max(s.min_height);
        s.width = s.width.clamp(s.min_width, s.max_width);
        s.height = s.height.clamp(s.min_height, s.max_height);
        s.grow = s.grow.clamp(0.0, 1.0);
        let mut keys = std::collections::HashSet::new();
        for setting in &self.settings {
            if setting.key.trim().is_empty() {
                return Err("a setting has no \"key\"".into());
            }
            if !keys.insert(setting.key.clone()) {
                return Err(format!("two settings use the key \"{}\"", setting.key));
            }
        }
        Ok(())
    }

    pub fn load(dir: &Path, builtin: bool) -> Result<Manifest, String> {
        let file = dir.join("widget.json");
        let text = crate::util::read_text(&file)
            .map_err(|e| format!("widget.json could not be read: {e}"))?;
        let mut m: Manifest = serde_json::from_str(&text).map_err(|e| {
            let line = e.line();
            if line > 0 {
                format!("widget.json line {line}: {e}")
            } else {
                format!("widget.json: {e}")
            }
        })?;
        m.dir = dir.to_path_buf();
        m.builtin = builtin;
        m.validate()?;
        Ok(m)
    }
}

fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}
