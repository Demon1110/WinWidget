//! Replacing the running executable — what a release that is a single `.exe` needs.
//!
//! Windows refuses to overwrite the image a process is running from, so the work is handed to the
//! freshly downloaded copy: it starts with `--apply-update <exe to replace>`, waits until that file
//! is no longer in use, copies itself over it, and starts it again. That is the whole installer.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const FLAG: &str = "--apply-update";
/// Long enough for a busy machine to tear the old instance down, short enough to give up and say so.
const TIMEOUT: Duration = Duration::from_secs(30);

/// True when the command line asked for an update; handles it and never returns.
pub fn apply_from_args(args: &[String]) -> bool {
    if args.first().map(String::as_str) != Some(FLAG) {
        return false;
    }
    let Some(target) = args.get(1) else {
        crate::core::logging::error("--apply-update needs the exe to replace");
        return true;
    };
    apply(Path::new(target));
    true
}

/// Copies the running exe over `target`, retrying while the old instance still holds it, then
/// starts `target`. Called in the downloaded copy, not in the app being replaced.
pub fn apply(target: &Path) {
    let me = match std::env::current_exe() {
        Ok(path) => path,
        Err(e) => {
            crate::core::logging::error(&format!("apply-update: own path is unknown: {e}"));
            return;
        }
    };
    if same_file(&me, target) {
        crate::core::logging::info("apply-update: already in place, nothing to do");
        start(target);
        return;
    }
    crate::core::logging::info(&format!(
        "apply-update: {} -> {}",
        me.display(),
        target.display()
    ));
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match std::fs::copy(&me, target) {
            Ok(_) => break,
            Err(e) => {
                if Instant::now() >= deadline {
                    crate::core::logging::error(&format!(
                        "apply-update: could not replace {}: {e}",
                        target.display()
                    ));
                    crate::platform::message_box(
                        "WinWidget 更新失败",
                        &format!(
                            "无法替换 {}：{e}\n\n请手动把它删掉后重新下载。",
                            target.display()
                        ),
                    );
                    return;
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
    crate::core::logging::info("apply-update: copied, starting the new build");
    start(target);
}

/// Starts the freshly replaced exe, detached from this helper (which is about to exit).
fn start(target: &Path) {
    match std::process::Command::new(target).spawn() {
        Ok(child) => crate::core::logging::info(&format!(
            "apply-update: started {} (pid {})",
            target.display(),
            child.id()
        )),
        Err(e) => crate::core::logging::error(&format!(
            "apply-update: could not start {}: {e}",
            target.display()
        )),
    }
}

/// Starts the downloaded copy so it can take over `target` once this process is gone.
pub fn spawn_applier(new_exe: &Path, target: &Path) -> Result<u32, String> {
    std::process::Command::new(new_exe)
        .arg(FLAG)
        .arg(target)
        .spawn()
        .map(|child| child.id())
        .map_err(|e| e.to_string())
}

/// Removes leftovers of an older update attempt. The copy that is mid-update is younger than the
/// cutoff, so it is safe to sweep this folder at every start.
pub fn clean_downloads(local_dir: &Path) {
    let folder = local_dir.join("update");
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let old = meta
            .modified()
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .map(|age| age > Duration::from_secs(3600))
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// `C:\a\b.exe` and `c:\A\B.EXE` are the same file to Windows.
fn same_file(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| -> PathBuf {
        let text = p.to_string_lossy().replace('/', "\\").to_lowercase();
        let text = text.strip_prefix(r"\\?\").unwrap_or(&text).to_string();
        PathBuf::from(text)
    };
    norm(a) == norm(b)
}
