//! A widget's `widget.json`: name, size, permissions and the settings the control center builds a
//! form from. Unknown keys are ignored, so widget authors can add their own.

use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Manifest {
    pub id: String,
    /// Ids this package replaces. A built-in widget that moves to the Hub keeps its old id here
    /// so the host can repoint existing cards and rename its old database without special-casing
    /// any single widget.
    pub aliases: Vec<String>,
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
    pub tools: Vec<ToolSpec>,

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
    /// slider 数值的单位后缀（如 "%"），仅用于控制中心展示
    pub unit: Option<String>,
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
            unit: None,
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

/// A command-line program the widget downloads and runs. When the declaration includes a
/// SHA-256, the host verifies it before anything is executed, and stores the file under the
/// widget's `bin\` folder.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ToolSpec {
    /// The name the widget uses in `widget.tool.run()`, e.g. "ffmpeg".
    pub name: String,
    /// An https URL. Redirects are checked against the widget's `network:` permissions too.
    pub url: String,
    /// Optional 64 hex characters. When present the downloaded file is rejected if it does not
    /// match; when absent the host only checks HTTPS and the optional size.
    pub sha256: Option<String>,
    /// The file name under `bin\`. Defaults to the last segment of `url`; must end with `.exe`.
    pub filename: Option<String>,
    /// Optional expected size in bytes; the download must match exactly. The hard limit is 512 MB.
    pub size: Option<u64>,
    /// Default run timeout in milliseconds (1 s – 300 s).
    pub timeout: Option<u64>,
}

impl Default for ToolSpec {
    fn default() -> Self {
        ToolSpec {
            name: String::new(),
            url: String::new(),
            sha256: None,
            filename: None,
            size: None,
            timeout: Some(30_000),
        }
    }
}

impl Manifest {
    pub fn display_name(&self) -> String {
        crate::core::text::pick(self.name.as_ref(), &self.id)
    }

    pub fn description(&self) -> String {
        crate::core::text::pick(self.description.as_ref(), "")
    }

    /// Each widget type gets its own origin, so their storage is isolated; all share the site
    /// "widgets.localhost", which Chromium resolves to this machine.
    pub fn host_name(&self) -> String {
        let clean: String = self
            .id
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        format!("{clean}.widgets.localhost")
    }

    pub fn declares(&self, permission: &str) -> bool {
        self.permissions
            .iter()
            .any(|p| p.eq_ignore_ascii_case(permission))
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
        self.aliases.retain(|a| !a.trim().is_empty());
        let mut alias_names = std::collections::HashSet::new();
        for alias in &self.aliases {
            if alias.eq_ignore_ascii_case(&self.id) {
                return Err(format!("alias \"{alias}\" is the widget's own id"));
            }
            if !valid_id(alias) {
                return Err(format!(
                    "alias \"{alias}\" is invalid: use lowercase letters, digits, dots, dashes and underscores (2–64 characters)"
                ));
            }
            if !alias_names.insert(alias.to_lowercase()) {
                return Err(format!("two aliases resolve to \"{alias}\""));
            }
        }
        if self.entry.trim().is_empty() {
            self.entry = "index.html".into();
        }
        let entry_rel = self.entry.replace('\\', "/");
        // A widget inside the binary has no folder to stat, so ask the asset table instead.
        let entry_exists = if crate::core::assets::is_virtual(&self.dir) {
            crate::core::assets::has_under(&self.dir, &entry_rel)
        } else {
            self.dir.join(&entry_rel).is_file()
        };
        if !entry_exists {
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
        if !self.tools.is_empty() {
            if !self.declares("tool.exec") {
                return Err(
                    "widget.json declares tools but not the \"tool.exec\" permission".into(),
                );
            }
            let mut tool_names = std::collections::HashSet::new();
            for tool in &self.tools {
                if !valid_tool_name(&tool.name) {
                    return Err(format!(
                        "tool name \"{}\" is invalid: use lowercase letters, digits, dots, dashes and underscores (1–32 characters)",
                        tool.name
                    ));
                }
                if !tool_names.insert(tool.name.to_lowercase()) {
                    return Err(format!("two tools use the name \"{}\"", tool.name));
                }
                if !tool.url.starts_with("https://") {
                    return Err(format!(
                        "tool \"{}\" must be downloaded over https",
                        tool.name
                    ));
                }
                let host = https_host(&tool.url)
                    .ok_or_else(|| format!("tool \"{}\" has an invalid download URL", tool.name))?;
                if !crate::model::permissions::allows_host(&self.permissions, &host) {
                    return Err(format!(
                        "tool \"{}\" downloads from {host}: add \"network:{host}\" to permissions",
                        tool.name
                    ));
                }
                if let Some(hash) = &tool.sha256 {
                    if !valid_sha256(hash) {
                        return Err(format!(
                            "tool \"{}\" sha256 must be 64 hex characters",
                            tool.name
                        ));
                    }
                }
                tool.file_name()?;
                if let Some(size) = tool.size {
                    if size == 0 || size > 512 * 1024 * 1024 {
                        return Err(format!(
                            "tool \"{}\" size must be between 1 byte and 512 MB",
                            tool.name
                        ));
                    }
                }
                let timeout = tool.timeout.unwrap_or(30_000);
                if !(1_000..=300_000).contains(&timeout) {
                    return Err(format!(
                        "tool \"{}\" timeout must be between 1000 and 300000 ms",
                        tool.name
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn load(dir: &Path, builtin: bool) -> Result<Manifest, String> {
        let file = dir.join("widget.json");
        let text = crate::core::util::read_text(&file)
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

    /// A widget compiled into the binary: `dir` is its virtual folder, e.g.
    /// `embedded:/assets/widgets/clock`.
    pub fn load_embedded(dir: &Path) -> Result<Manifest, String> {
        let text = crate::core::assets::read_under(dir, "widget.json")
            .ok_or_else(|| "widget.json is missing from the built-in copy".to_string())?;
        let text = String::from_utf8_lossy(&text);
        let mut m: Manifest = serde_json::from_str(&text).map_err(|e| {
            let line = e.line();
            if line > 0 {
                format!("widget.json line {line}: {e}")
            } else {
                format!("widget.json: {e}")
            }
        })?;
        m.dir = dir.to_path_buf();
        m.builtin = true;
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

impl ToolSpec {
    /// The file name under the widget's `bin\` folder. A declared name wins; otherwise the last
    /// path segment of the URL is used. Paths are never accepted here.
    pub fn file_name(&self) -> Result<String, String> {
        let raw = match self.filename.as_deref() {
            Some(name) if !name.trim().is_empty() => name.trim().to_string(),
            Some(_) => return Err(format!("tool \"{}\" has an empty filename", self.name)),
            None => {
                let path = self.url.split(['?', '#']).next().unwrap_or("");
                path.rsplit('/').next().unwrap_or("").to_string()
            }
        };
        if !tool_file_name_ok(&raw) {
            return Err(format!(
                "tool \"{}\" filename \"{}\" is invalid: use letters, digits, dots, dashes or underscores and end with .exe",
                self.name, raw
            ));
        }
        Ok(raw)
    }

    pub fn timeout_ms(&self) -> u64 {
        self.timeout.unwrap_or(30_000).clamp(1_000, 300_000)
    }
}

fn valid_tool_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > 32 {
        return false;
    }
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

fn tool_file_name_ok(name: &str) -> bool {
    if name.len() > 128 || !name.to_ascii_lowercase().ends_with(".exe") {
        return false;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return false;
    }
    // Windows resolves these names to devices even with an extension, so a tool must never be
    // allowed to write or execute `CON.exe`, `NUL.exe`, `COM1.exe` and the like.
    let base = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    !matches!(
        base.as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

fn valid_sha256(hash: &str) -> bool {
    hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest
        .split(['/', '?', '#'])
        .next()?
        .rsplit('@')
        .next()?
        .split(':')
        .next()?
        .trim()
        .to_lowercase();
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
    {
        return None;
    }
    Some(host)
}
