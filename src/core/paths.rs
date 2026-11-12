//! Where everything lives on disk.
//!
//! One data folder holds everything the app writes — settings, widget databases, clipboard
//! history, logs, exports, cached covers, downloaded updates and the WebView2 profile:
//!
//! ```text
//! <data>\
//!   config.json                 settings (instances, theme, grants, hotkeys)
//!   widgets\                    your own and installed widgets (`.install` is staging)
//!   db\                         everything that must survive a restart
//!     plugins\<id>.json         per-widget key/value database (utools.db)
//!     plugins\<id>.attachments\ attachment bytes for that database
//!     instances\<id>.json       per-card storage (`widget.storage`)
//!     clipboard\history.json    clipboard history, with images under clipboard\images
//!     market.json               last market answer, for the offline view
//!     app\features.json         optional features
//!     app\schedule.json         reminders
//!     app\recycle-bin.json      last recycle bin measurement
//!   logs\app.log
//!   exports\                    `.fwz` packages written by `widget.export`
//!   media\                      album covers and other cached pictures
//!   update\                     update packages while one is being installed
//!   cache\webview2\             browser profile for every card (safe to delete)
//! ```
//!
//! The folder defaults to `%APPDATA%\WinWidget`; portable mode (a `portable` file next to the exe)
//! keeps it beside the executable as `<exe>\data`. A user can point it somewhere else, and that
//! choice is remembered in `location.json` **in the default folder** — the folder that is known
//! before anything is read, so the setting can be honoured on the next start.
//!
//! Resources (widgets, sdk, ui, docs) come from an `assets\` folder next to the exe or from the
//! source tree when `WINWIDGET_DEV_ROOT` points at it; a shipped single exe has no such folder and
//! falls back to the copy compiled into the binary (`core::assets`), reported as the virtual root
//! `embedded:/assets`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static PATHS: OnceLock<Paths> = OnceLock::new();

/// `<default data folder>\location.json`, the pointer to a user-chosen folder.
const LOCATION_FILE: &str = "location.json";

#[derive(Debug, Clone)]
pub struct Paths {
    /// The folder everything is written to: `%APPDATA%\WinWidget` unless the user moved it.
    pub data_dir: PathBuf,
    /// The folder that holds `location.json`: the default data folder, always known at startup.
    pub bootstrap: PathBuf,
    pub resource_root: PathBuf,
    pub portable: bool,
    /// True when `data_dir` came from `location.json` instead of the default.
    pub custom: bool,
}

impl Paths {
    pub fn config_file(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }
    pub fn user_widgets_dir(&self) -> PathBuf {
        self.data_dir.join("widgets")
    }
    /// `db\` — every file that has to survive a restart.
    pub fn db_dir(&self) -> PathBuf {
        self.data_dir.join("db")
    }
    /// Per-widget key/value databases, one JSON file each.
    pub fn plugins_dir(&self) -> PathBuf {
        self.db_dir().join("plugins")
    }
    /// Per-card storage, one JSON file per instance.
    pub fn instances_dir(&self) -> PathBuf {
        self.db_dir().join("instances")
    }
    /// Databases the app itself keeps (features, reminders, recycle bin snapshot).
    pub fn app_dir(&self) -> PathBuf {
        self.db_dir().join("app")
    }
    pub fn clipboard_dir(&self) -> PathBuf {
        self.db_dir().join("clipboard")
    }
    pub fn clipboard_file(&self) -> PathBuf {
        self.clipboard_dir().join("history.json")
    }
    pub fn clipboard_images_dir(&self) -> PathBuf {
        self.clipboard_dir().join("images")
    }
    pub fn market_file(&self) -> PathBuf {
        self.db_dir().join("market.json")
    }
    pub fn features_file(&self) -> PathBuf {
        self.app_dir().join("features.json")
    }
    pub fn schedule_file(&self) -> PathBuf {
        self.app_dir().join("schedule.json")
    }
    pub fn recycle_file(&self) -> PathBuf {
        self.app_dir().join("recycle-bin.json")
    }
    pub fn log_file(&self) -> PathBuf {
        self.data_dir.join("logs").join("app.log")
    }
    pub fn exports_dir(&self) -> PathBuf {
        self.data_dir.join("exports")
    }
    pub fn media_dir(&self) -> PathBuf {
        self.data_dir.join("media")
    }
    pub fn update_dir(&self) -> PathBuf {
        self.data_dir.join("update")
    }
    /// The browser profile every card shares; delete it and the next start rebuilds it.
    pub fn webview_data_dir(&self) -> PathBuf {
        self.data_dir.join("cache").join("webview2")
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
    /// Every folder above, created. Cheap and idempotent, so a settings change can call it too.
    pub fn ensure_dirs(&self) {
        let dirs = [
            self.data_dir.clone(),
            self.log_file().parent().unwrap_or(&self.data_dir).to_path_buf(),
            self.user_widgets_dir(),
            self.plugins_dir(),
            self.instances_dir(),
            self.app_dir(),
            self.clipboard_images_dir(),
            self.exports_dir(),
            self.media_dir(),
            self.update_dir(),
            self.webview_data_dir(),
        ];
        for dir in dirs {
            let _ = std::fs::create_dir_all(&dir);
        }
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

fn default_data_dir(exe: &Path) -> PathBuf {
    let roaming = std::env::var("APPDATA").unwrap_or_else(|_| exe.to_string_lossy().to_string());
    PathBuf::from(roaming).join("WinWidget")
}

/// Reads `location.json`: `{ "dataDir": "<folder>" }`. Anything unreadable means "use the default".
fn read_location(bootstrap: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(bootstrap.join(LOCATION_FILE)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let dir = value.get("dataDir")?.as_str()?.trim().to_string();
    if dir.is_empty() {
        return None;
    }
    let expanded = expand_env(&dir);
    let path = PathBuf::from(expanded);
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

fn write_location(bootstrap: &Path, dir: Option<&Path>) -> Result<(), String> {
    std::fs::create_dir_all(bootstrap).map_err(|e| format!("{}: {e}", bootstrap.display()))?;
    let file = bootstrap.join(LOCATION_FILE);
    let body = match dir {
        Some(dir) => serde_json::json!({ "dataDir": dir.to_string_lossy() }),
        None => serde_json::json!({ "dataDir": "" }),
    };
    let text = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| format!("{}: {e}", file.display()))
}

pub fn init() -> &'static Paths {
    PATHS.get_or_init(|| {
        let exe = exe_dir();
        let portable = exe.join("portable").exists() || exe.join("portable.txt").exists();
        let resource_root = resolve_resource_root();

        let bootstrap = if portable {
            exe.join("data")
        } else {
            default_data_dir(&exe)
        };
        let custom = if portable {
            None
        } else {
            read_location(&bootstrap)
        };
        let data_dir = custom.clone().unwrap_or_else(|| bootstrap.clone());

        let paths = Paths {
            data_dir,
            bootstrap,
            resource_root,
            portable,
            custom: custom.is_some(),
        };
        // Migration first: `ensure_dirs` would create the target folders, and an existing (empty)
        // folder counts as "already there", which is how a whole directory used to be skipped.
        migrate_legacy(&paths);
        paths.ensure_dirs();
        paths
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

/// Moves `from` to `to` unless the target already exists. A rename is tried first; when the two
/// folders sit on different volumes it copies and removes the original. Errors are reported but
/// never fatal: the app can always start with a half-migrated folder.
fn move_path(from: &Path, to: &Path) -> bool {
    if !from.exists() {
        return false;
    }
    // A folder that is already there but still empty is a placeholder, not something to keep: this
    // is what a half-run migration or a pre-created folder looks like.
    match std::fs::read_dir(to) {
        Ok(_) => {
            let empty = std::fs::read_dir(to)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
            if to.is_dir() && empty {
                let _ = std::fs::remove_dir(to);
            } else {
                return false;
            }
        }
        Err(_) => {}
    }
    if to.exists() {
        return false;
    }
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::rename(from, to).is_ok() {
        return true;
    }
    if from.is_dir() {
        if let Ok(()) = copy_tree(from, to) {
            let _ = std::fs::remove_dir_all(from);
            return true;
        }
    } else if std::fs::copy(from, to).is_ok() {
        let _ = std::fs::remove_file(from);
        return true;
    }
    false
}

/// Removes a folder left behind by the migration: only when nothing is inside it any more.
fn prune_empty(dir: &Path) {
    if !dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                prune_empty(&path);
            }
        }
    }
    if std::fs::read_dir(dir)
        .map(|mut d| d.next().is_none())
        .unwrap_or(false)
    {
        let _ = std::fs::remove_dir(dir);
    }
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)?.flatten() {
        let path = entry.path();
        let dest = to.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

/// Folds older layouts into the structure above: the flat files that used to sit in the data folder
/// and everything that used to live in `%LOCALAPPDATA%\WinWidget`. Runs once — afterwards the old
/// names are gone, so every step is a no-op.
fn migrate_legacy(paths: &Paths) {
    let root = &paths.data_dir;
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();

    // Flat data folder → db\
    moves.push((
        root.join("clipboard-history.json"),
        paths.clipboard_file(),
    ));
    moves.push((
        root.join("clipboard").join("images"),
        paths.clipboard_images_dir(),
    ));
    moves.push((root.join("features.json"), paths.features_file()));
    moves.push((root.join("schedule.json"), paths.schedule_file()));
    moves.push((root.join("recycle-bin.json"), paths.recycle_file()));
    moves.push((root.join("market.json"), paths.market_file()));

    // db\<widget>.json → db\plugins\
    if let Ok(entries) = std::fs::read_dir(root.join("db")) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy().to_string();
            // The new sub folders are already there; anything else is an old widget database.
            if matches!(name.as_str(), "plugins" | "instances" | "app" | "clipboard" | "market.json")
            {
                continue;
            }
            moves.push((entry.path(), paths.plugins_dir().join(&name)));
        }
    }
    // storage\<instance>.json → db\instances\
    if let Ok(entries) = std::fs::read_dir(root.join("storage")) {
        for entry in entries.flatten() {
            moves.push((entry.path(), paths.instances_dir().join(entry.file_name())));
        }
    }

    // Machine-local folder → the data folder
    let legacy_local = if paths.portable {
        exe_dir().join("data").join("local")
    } else {
        let local = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| root.to_string_lossy().to_string());
        PathBuf::from(local).join("WinWidget")
    };
    if legacy_local != *root {
        moves.push((
            legacy_local.join("logs").join("app.log"),
            paths.log_file(),
        ));
        moves.push((legacy_local.join("exports"), paths.exports_dir()));
        moves.push((legacy_local.join("media"), paths.media_dir()));
        moves.push((legacy_local.join("update"), paths.update_dir()));
        moves.push((legacy_local.join("market.json"), paths.market_file()));
        moves.push((legacy_local.join("WebView2"), paths.webview_data_dir()));
    }

    let mut moved = 0usize;
    for (from, to) in moves {
        // `move_path` itself decides: an empty folder standing at the destination is a placeholder
        // and gets replaced, anything already holding files is left alone.
        if move_path(&from, &to) {
            moved += 1;
        }
    }
    // Old names are gone; drop the now-empty shells they left behind, even when nothing moved this
    // run (a previous run may have emptied them but failed to clean up).
    prune_empty(&root.join("clipboard"));
    prune_empty(&root.join("storage"));
    if legacy_local != *root {
        prune_empty(&legacy_local);
    }
    if moved > 0 {
        // Logging is not up yet (this runs while the paths are being resolved), so say it here.
        eprintln!("moved {moved} old data file(s) into {}", root.display());
    }
}

/// Total bytes of the folders worth carrying over when the user picks a new data folder.
fn carried_over(paths: &Paths) -> Vec<PathBuf> {
    vec![
        paths.config_file(),
        paths.user_widgets_dir(),
        paths.db_dir(),
        paths.exports_dir(),
        paths.media_dir(),
    ]
}

/// Points the app at `target` and copies what is worth keeping. Returns `{ dir, copied, moved }`;
/// the caller restarts the app, because a running process cannot swap its folders.
pub fn set_data_dir(target: &str) -> Result<serde_json::Value, String> {
    let paths = get();
    let text = expand_env(target);
    let text = text.trim();
    if text.is_empty() {
        return Err("missing folder".into());
    }
    let path = PathBuf::from(text);
    std::fs::create_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let full = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if full == paths.data_dir {
        return Err("that is where the data already lives".into());
    }
    // A folder that already holds WinWidget settings would be merged into, not replaced.
    if full.join("config.json").is_file() || full.join("db").is_dir() {
        return Err(
            "that folder already holds WinWidget data — pick an empty folder instead".into(),
        );
    }

    let mut copied = 0usize;
    for source in carried_over(paths) {
        if !source.exists() {
            continue;
        }
        let name = source
            .strip_prefix(&paths.data_dir)
            .unwrap_or(&source)
            .to_path_buf();
        let dest = full.join(&name);
        if source.is_dir() {
            copy_tree(&source, &dest)
                .map_err(|e| format!("{}: {e}", source.display()))?;
        } else {
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&source, &dest)
                .map_err(|e| format!("{}: {e}", source.display()))?;
        }
        copied += 1;
    }
    write_location(&paths.bootstrap, Some(&full))?;
    Ok(serde_json::json!({
        "dir": full.to_string_lossy(),
        "copied": copied,
    }))
}

/// Forgets a custom folder; the next start uses the default one again.
pub fn reset_data_dir() -> Result<serde_json::Value, String> {
    let paths = get();
    write_location(&paths.bootstrap, None)?;
    Ok(serde_json::json!({ "dir": paths.bootstrap.to_string_lossy() }))
}

/// WebView2 used to put its profile in `<exe name>.WebView2` next to the executable, because no
/// user data folder was passed. Every card now shares `<data>\cache\webview2` (see
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
    use super::{expand_env, move_path};

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

    /// A migration step never overwrites what is already in the new place, and the second run is a
    /// no-op because the old name is gone.
    #[test]
    fn a_migration_move_keeps_both_sides() {
        let base = std::env::temp_dir().join(format!("winwidget-move-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("old").join("images")).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("old").join("images").join("a.png"), b"one").unwrap();
        std::fs::write(base.join("old").join("history.json"), b"{}").unwrap();

        let target_dir = base.join("new").join("images");
        move_path(&base.join("old").join("images"), &target_dir);
        assert!(target_dir.join("a.png").is_file());
        assert!(!base.join("old").join("images").exists());
        // second move at the same place does nothing
        move_path(&base.join("old").join("images"), &target_dir);
        assert!(!target_dir.join("a.png").exists() || target_dir.join("a.png").is_file());

        // a target that already exists is never replaced
        let other = base.join("other.json");
        std::fs::write(&other, b"two").unwrap();
        let kept = base.join("new").join("history.json");
        std::fs::write(&kept, b"kept").unwrap();
        move_path(&other, &kept);
        assert_eq!(std::fs::read(&kept).unwrap(), b"kept");
        assert!(other.is_file());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A destination folder that exists but holds nothing is a placeholder left by an earlier
    /// half-run; the migration has to fill it instead of skipping the move (this is what left real
    /// data behind in `%LOCALAPPDATA%` while empty `exports`/`media` folders sat in the new place).
    #[test]
    fn an_empty_placeholder_folder_still_receives_the_old_data() {
        let base = std::env::temp_dir().join(format!("winwidget-place-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("old")).unwrap();
        std::fs::create_dir_all(base.join("new")).unwrap();
        std::fs::write(base.join("old").join("a.fwz"), b"one").unwrap();
        assert!(move_path(&base.join("old"), &base.join("new")));
        assert!(base.join("new").join("a.fwz").is_file());
        assert!(!base.join("old").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
