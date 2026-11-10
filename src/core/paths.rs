//! Where everything lives on disk.
//!
//! Data: `%APPDATA%\WinWidget` (or `.\data` in portable mode). Machine-local: `%LOCALAPPDATA%\WinWidget`.
//! Resources (widgets, sdk, ui, docs) ship next to the exe in `assets\`, or come from the source
//! tree when `WINWIDGET_DEV_ROOT` points at it — the same arrangement FullWidget uses.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static PATHS: OnceLock<Paths> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct Paths {
    pub data_dir: PathBuf,
    pub local_dir: PathBuf,
    pub resource_root: PathBuf,
    pub portable: bool,
}

impl Paths {
    pub fn config_file(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }
    pub fn user_widgets_dir(&self) -> PathBuf {
        self.data_dir.join("widgets")
    }
    pub fn storage_dir(&self) -> PathBuf {
        self.data_dir.join("storage")
    }
    pub fn webview_data_dir(&self) -> PathBuf {
        self.local_dir.join("WebView2")
    }
    pub fn log_file(&self) -> PathBuf {
        self.local_dir.join("logs").join("app.log")
    }
    pub fn builtin_widgets_dir(&self) -> PathBuf {
        self.resource_root.join("widgets")
    }
    pub fn sdk_dir(&self) -> PathBuf {
        self.resource_root.join("sdk")
    }
    pub fn themes_dir(&self) -> PathBuf {
        self.resource_root.join("sdk").join("themes")
    }
    pub fn ui_dir(&self) -> PathBuf {
        self.resource_root.join("ui")
    }
    pub fn docs_dir(&self) -> PathBuf {
        self.resource_root.join("docs")
    }
    pub fn templates_dir(&self) -> PathBuf {
        self.resource_root.join("templates")
    }
    pub fn staging_dir(&self) -> PathBuf {
        self.user_widgets_dir().join(".install")
    }
    /// Where `widget.export` puts `.fwz` files.
    pub fn exports_dir(&self) -> PathBuf {
        self.local_dir.join("exports")
    }
    /// True when built-in widgets and the SDK come from a source tree (edits show up at once).
    pub fn dev_root(&self) -> bool {
        self.resource_root
            .to_string_lossy()
            .to_lowercase()
            .ne(&exe_dir().to_string_lossy().to_lowercase())
    }
}

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Picks the folder that holds `sdk\base.css`: an explicit dev root, the exe's `assets`, or the
/// source tree's `assets` next to the build folder (so `cargo run` needs no copying).
fn resolve_resource_root() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("WINWIDGET_DEV_ROOT") {
        if !dir.is_empty() {
            candidates.push(PathBuf::from(dir.clone()));
            candidates.push(PathBuf::from(&dir).join("assets"));
        }
    }
    let exe = exe_dir();
    candidates.push(exe.join("assets"));
    // `cargo run` keeps the build under `target\<profile>`, so try the folders around it too.
    for ancestor in exe.ancestors().skip(1).take(3) {
        candidates.push(ancestor.join("assets"));
    }
    for c in &candidates {
        if c.join("sdk").join("base.css").is_file() {
            return c.clone();
        }
    }
    candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| exe.join("assets"))
}

pub fn init() -> &'static Paths {
    PATHS.get_or_init(|| {
        let exe = exe_dir();
        let portable = exe.join("portable").exists() || exe.join("portable.txt").exists();
        let resource_root = resolve_resource_root();

        let (data_dir, local_dir) = if portable {
            (exe.join("data"), exe.join("data").join("local"))
        } else {
            let roaming =
                std::env::var("APPDATA").unwrap_or_else(|_| exe.to_string_lossy().to_string());
            let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| roaming.clone());
            (
                PathBuf::from(roaming).join("WinWidget"),
                PathBuf::from(local).join("WinWidget"),
            )
        };

        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::create_dir_all(data_dir.join("widgets"));
        let _ = std::fs::create_dir_all(data_dir.join("storage"));
        let _ = std::fs::create_dir_all(local_dir.join("logs"));

        Paths {
            data_dir,
            local_dir,
            resource_root,
            portable,
        }
    })
}

pub fn get() -> &'static Paths {
    init()
}

pub fn log_file() -> PathBuf {
    get().log_file()
}

pub fn data_dir() -> PathBuf {
    get().data_dir.clone()
}

pub fn resource_root() -> PathBuf {
    get().resource_root.clone()
}

pub fn sdk_dir() -> PathBuf {
    get().sdk_dir()
}

/// Absolute path if `rel` stays inside `root`; used for every path a page asks for.
pub fn resolve_inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let clean = rel.trim_start_matches(['\\', '/']).replace('\\', "/");
    let joined = root.join(clean.replace('/', std::path::MAIN_SEPARATOR_STR));
    let full = joined.canonicalize().ok()?;
    let root_full = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if crate::core::util::inside(&root_full, &full) {
        Some(full)
    } else {
        None
    }
}
