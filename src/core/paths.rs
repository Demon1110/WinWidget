//! Where everything lives on disk.
//!
//! Data: `%APPDATA%\WinWidget` (or `.\data` in portable mode). Machine-local: `%LOCALAPPDATA%\WinWidget`.
//! Resources (widgets, sdk, ui, docs) come from an `assets\` folder next to the exe or from the
//! source tree when `WINWIDGET_DEV_ROOT` points at it; a shipped single exe has no such folder and
//! falls back to the copy compiled into the binary (`core::assets`), reported as the virtual root
//! `embedded:/assets`.

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
        !self.embedded()
            && self
                .resource_root
                .to_string_lossy()
                .to_lowercase()
                .ne(&exe_dir().to_string_lossy().to_lowercase())
    }
    /// True when the assets are the copy inside the binary (a shipped single exe).
    pub fn embedded(&self) -> bool {
        crate::core::assets::is_virtual(&self.resource_root)
    }
}

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// `%USERPROFILE%\Downloads` → `C:\Users\me\Downloads`, so a setting written with an environment
/// variable works the way it does in Explorer. Unknown names are left as they are.
pub fn expand_env(input: &str) -> String {
    let text = input.trim();
    if !text.contains('%') {
        return input.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) if !name.is_empty() => out.push_str(&value),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Picks the folder that holds `sdk\base.css`: an explicit dev root, the exe's `assets`, or the
/// source tree's `assets` next to the build folder (so `cargo run` needs no copying). With none of
/// them (a shipped single exe) it returns the virtual root, answered from `core::assets`.
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
    // `cargo run` keeps the build under `target\<profile>`, so try the folders around it too — but
    // only for debug builds. A release exe dropped inside the source tree (say `dist\`) must use the
    // copy inside itself, or it would quietly serve the repo's `assets\` and open docs as `file://`.
    if cfg!(debug_assertions) {
        for ancestor in exe.ancestors().skip(1).take(3) {
            candidates.push(ancestor.join("assets"));
        }
    }
    for c in &candidates {
        if c.join("sdk").join("base.css").is_file() {
            return c.clone();
        }
    }
    PathBuf::from(crate::core::assets::VROOT)
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

/// WebView2 used to put its profile in `<exe name>.WebView2` next to the executable, because no
/// user data folder was passed. Every card now shares `%LOCALAPPDATA%\WinWidget\WebView2` (see
/// `webview_data_dir`), so that folder is dead weight: browser cache, cookies and localStorage for
/// the loopback pages, nothing the app reads back. Delete it once at startup, and only when it sits
/// beside our own exe.
pub fn clean_stray_profile() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(name) = exe.file_name().map(|n| n.to_string_lossy().to_string()) else {
        return;
    };
    let dir = exe.with_file_name(format!("{name}.WebView2"));
    if !dir.is_dir() {
        return;
    }
    // A profile the user pointed us at is never removed: only the default next to the exe.
    if dir == get().webview_data_dir() {
        return;
    }
    let bytes = dir_size(&dir);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => crate::core::logging::info(&format!(
            "removed the old WebView2 profile {} ({bytes} bytes); the browser cache now lives in {}",
            dir.display(),
            get().webview_data_dir().display()
        )),
        // Usually the previous version is still running and holds the folder open.
        Err(e) => crate::core::logging::warn(&format!(
            "could not remove the old WebView2 profile {}: {e}",
            dir.display()
        )),
    }
}

/// Recursive byte count, for the log line above; unreadable entries count as zero.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += dir_size(&path);
        } else if let Ok(meta) = entry.metadata() {
            total += meta.len();
        }
    }
    total
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

#[cfg(test)]
mod tests {
    use super::expand_env;

    #[test]
    fn expands_a_variable_that_exists() {
        let root = std::env::var("SystemRoot").expect("SystemRoot is set on Windows");
        assert_eq!(expand_env(r"%SystemRoot%\Fonts"), format!(r"{root}\Fonts"));
    }

    #[test]
    fn keeps_an_unknown_name_and_plain_text() {
        assert_eq!(expand_env(r"%NOPE%\x"), r"%NOPE%\x");
        assert_eq!(expand_env(r"C:\Windows"), r"C:\Windows");
    }
}
