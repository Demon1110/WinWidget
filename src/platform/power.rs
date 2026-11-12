//! The recycle bin and the power menu. Both are promised only to the built-in widgets, matching
//! how FullWidget keeps machine-wide actions out of third-party widgets.

use crate::platform::win32 as w;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// How long a measured size still counts as current. Measuring a big bin is not cheap — on a
/// machine with 59 GB and a quarter million files a full walk takes over a minute — so the card
/// shows the last answer with its age instead of asking again every few seconds.
const FRESH_SECS: u64 = 10 * 60;

#[derive(Clone, Copy)]
struct Measured {
    items: i64,
    size: i64,
    at: Instant,
}

static MEASURED: Mutex<Option<Measured>> = Mutex::new(None);
static SCANNING: AtomicBool = AtomicBool::new(false);
static EMPTYING: AtomicBool = AtomicBool::new(false);
/// Whether the snapshot on disk has been looked at already, so a restart doesn't walk the bin
/// again just to learn what the last run already knew.
static LOADED: AtomicBool = AtomicBool::new(false);
/// Bytes removed by the run in progress, and the size the bin had when it started (`-1` unknown).
static PROGRESS: Mutex<(u64, i64)> = Mutex::new((0, -1));

fn lock<T>(cell: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    cell.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the card draws: the last measured number, how old it is, and whether a walk or an empty
/// run is going on. Always answers immediately — the walking happens on a thread of its own.
pub fn recycle_state() -> Value {
    if !LOADED.swap(true, Ordering::SeqCst) {
        if let Some(saved) = load_snapshot() {
            *lock(&MEASURED) = Some(saved);
        }
    }
    let measured = *lock(&MEASURED);
    let age = measured.map(|m| m.at.elapsed().as_secs()).unwrap_or(u64::MAX);
    let scanning = SCANNING.load(Ordering::SeqCst);
    let emptying = EMPTYING.load(Ordering::SeqCst);
    let (done, total) = *lock(&PROGRESS);
    if age > FRESH_SECS && !scanning && !emptying {
        start_scan();
    }
    json!({
        "available": true,
        "items": measured.map(|m| m.items).unwrap_or(-1),
        "size": measured.map(|m| m.size).unwrap_or(-1),
        "age": if age == u64::MAX { Value::Null } else { json!(age) },
        "scanning": scanning,
        "emptying": emptying,
        "done": done,
        "total": if total < 0 { Value::Null } else { json!(total) },
    })
}

fn start_scan() {
    if SCANNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let (items, size) = measure();
        let measured = Measured {
            items,
            size,
            at: Instant::now(),
        };
        *lock(&MEASURED) = Some(measured);
        save_snapshot(measured);
        SCANNING.store(false, Ordering::SeqCst);
    });
}

fn snapshot_file() -> PathBuf {
    crate::core::paths::data_dir().join("recycle-bin.json")
}

/// The last answer survives a restart: a walk costs over a minute on a full bin, and starting the
/// app should not pay that again just to redraw a card.
fn save_snapshot(measured: Measured) {
    let Ok(now) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) else {
        return;
    };
    let ago = Instant::now().saturating_duration_since(measured.at).as_secs();
    let stamp = now.as_secs().saturating_sub(ago);
    let text = json!({ "items": measured.items, "size": measured.size, "at": stamp }).to_string();
    let _ = std::fs::write(snapshot_file(), text);
}

fn load_snapshot() -> Option<Measured> {
    let text = std::fs::read_to_string(snapshot_file()).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let items = value.get("items")?.as_i64()?;
    let size = value.get("size")?.as_i64()?;
    let stamp = value.get("at")?.as_u64()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let ago = now.saturating_sub(stamp);
    Some(Measured {
        items,
        size,
        at: Instant::now()
            .checked_sub(std::time::Duration::from_secs(ago))
            .unwrap_or_else(Instant::now),
    })
}

/// Fixed drives with a `$Recycle.Bin`. Network drives are skipped on purpose: a walk over a share
/// can stall for minutes, and their bins are usually disabled anyway.
fn bins() -> Vec<PathBuf> {
    let mask = unsafe { w::GetLogicalDrives() };
    let mut out = Vec::new();
    for bit in 0..26u32 {
        if mask & (1 << bit) == 0 {
            continue;
        }
        let letter = (b'A' + bit as u8) as char;
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
        if unsafe { w::GetDriveTypeW(wide.as_ptr()) } != 3 {
            continue; // DRIVE_FIXED
        }
        let bin = PathBuf::from(format!("{letter}:\\$Recycle.Bin"));
        if bin.is_dir() {
            out.push(bin);
        }
    }
    out
}

/// `<drive>:\$Recycle.Bin\<sid>\` — the folders this user (and others) may delete from. Anything
/// outside a `S-1-` folder is left alone.
fn records() -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    for bin in bins() {
        let Ok(sids) = std::fs::read_dir(&bin) else {
            continue;
        };
        for sid in sids.flatten() {
            if !sid.file_name().to_string_lossy().starts_with("S-1-") {
                continue;
            }
            out.push((bin.clone(), sid.path()));
        }
    }
    out
}

/// `$I…` is the index file of a record, not the record itself: counting it would double the total.
fn is_index(name: &str) -> bool {
    name.starts_with("$I")
}

fn measure() -> (i64, i64) {
    let mut items = 0i64;
    let mut size = 0i64;
    for (_, sid) in records() {
        let Ok(entries) = std::fs::read_dir(&sid) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_index(&name) {
                continue;
            }
            items += 1;
            // A record is either a folder with the deleted tree in it or a single deleted file;
            // the big ones are usually the latter, so the size has to be read either way.
            let path = entry.path();
            size += match entry.metadata() {
                Ok(meta) if meta.is_dir() => subtree_bytes(&path),
                Ok(meta) => meta.len() as i64,
                Err(_) => 0,
            };
        }
    }
    (items, size)
}

fn subtree_bytes(root: &Path) -> i64 {
    let mut total = 0i64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len() as i64;
            }
        }
    }
    total
}

/// Starts emptying on a thread of its own. The shell's own `SHEmptyRecycleBinW` walks every record
/// through COM, which is why a bin this size takes an age and offers no progress; deleting the
/// files directly and reporting the bytes as they go is both faster and honest about where it is.
pub fn start_empty() -> Result<(), String> {
    if EMPTYING.swap(true, Ordering::SeqCst) {
        return Err("the recycle bin is already being emptied".into());
    }
    let total = lock(&MEASURED).map(|m| m.size).unwrap_or(-1);
    *lock(&PROGRESS) = (0, total);
    std::thread::spawn(|| {
        let mut removed = 0u64;
        let mut failed = 0u64;
        for (_, sid) in records() {
            let Ok(entries) = std::fs::read_dir(&sid) else {
                failed += 1;
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => {
                        purge(&path, &mut removed, &mut failed);
                        if std::fs::remove_dir(verbatim(&path)).is_err() {
                            failed += 1;
                        }
                    }
                    Ok(_) => {
                        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        if remove_file(&path) {
                            removed += len;
                            lock(&PROGRESS).0 = removed;
                        } else {
                            failed += 1;
                        }
                    }
                    Err(_) => failed += 1,
                }
            }
            // The folder that held the records must stay: Windows keeps its own `desktop.ini`
            // there and Explorer expects the per-user folder to exist.
        }
        if failed > 0 {
            // Leftovers are almost always read-only or locked files; let the shell finish the job.
            let flags = 0x0000_0001 | 0x0000_0002; // NOCONFIRMATION | NOPROGRESSUI
            unsafe { w::SHEmptyRecycleBinW(0, std::ptr::null(), flags) };
        }
        *lock(&MEASURED) = if failed == 0 {
            // Only claim "empty" when the walk really cleared everything; leftovers are counted by
            // the fresh scan below instead of a guess.
            Some(Measured {
                items: 0,
                size: 0,
                at: Instant::now(),
            })
        } else {
            *lock(&MEASURED)
        };
        lock(&PROGRESS).0 = removed;
        EMPTYING.store(false, Ordering::SeqCst);
        start_scan(); // lands the card on the real number instead of the guess above
    });
    Ok(())
}

fn purge(dir: &Path, removed: &mut u64, failed: &mut u64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        *failed += 1;
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => {
                purge(&path, removed, failed);
                if std::fs::remove_dir(verbatim(&path)).is_err() {
                    *failed += 1;
                }
            }
            Ok(_) => {
                let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
                if remove_file(&path) {
                    *removed += len;
                    lock(&PROGRESS).0 = *removed;
                } else {
                    *failed += 1;
                }
            }
            Err(_) => *failed += 1,
        }
    }
}

/// `\\?\` prefix, so a record nested deeper than `MAX_PATH` can still be removed.
fn verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if text.starts_with(r"\\?\") {
        return path.to_path_buf();
    }
    PathBuf::from(format!(r"\\?\{}", text))
}

fn remove_file(path: &Path) -> bool {
    let wide: Vec<u16> = verbatim(path).to_string_lossy().encode_utf16().collect();
    if std::fs::remove_file(verbatim(path)).is_ok() {
        return true;
    }
    // A read-only record refuses the plain delete; clearing the attribute is what Explorer does.
    let mut with_nul = wide.clone();
    with_nul.push(0);
    unsafe { w::SetFileAttributesW(with_nul.as_ptr(), 0x80) }; // FILE_ATTRIBUTE_NORMAL
    std::fs::remove_file(verbatim(path)).is_ok()
}

pub fn recycle_open() -> Result<(), String> {
    crate::platform::shell::open_shell_folder("shell:RecycleBinFolder")
}

/// `shutdown` | `restart` | `sleep` | `hibernate` | `lock` | `signout`.
pub fn do_power(action: &str) -> Result<Value, String> {
    const EWX_SHUTDOWN: u32 = 0x0000_0001;
    const EWX_REBOOT: u32 = 0x0000_0002;
    const EWX_LOGOFF: u32 = 0x0000_0000;
    const EWX_FORCE: u32 = 0x0000_0004;
    match action {
        "shutdown" => {
            unsafe { w::ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "restart" => {
            unsafe { w::ExitWindowsEx(EWX_REBOOT | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "signout" => {
            unsafe { w::ExitWindowsEx(EWX_LOGOFF | EWX_FORCE, 0) };
            Ok(json!({ "ok": true }))
        }
        "sleep" => {
            unsafe { w::SetSuspendState(0, 1, 0) };
            Ok(json!({ "ok": true }))
        }
        "hibernate" => {
            unsafe { w::SetSuspendState(1, 1, 0) };
            Ok(json!({ "ok": true }))
        }
        "lock" => {
            // `ShellExecuteW` takes a file, not a command line: passing "rundll32.exe
            // user32.dll,LockWorkStation" there fails with "Windows could not open …", which is why
            // the power card's lock button did nothing. `LockWorkStation` is the same call Win+L uses.
            let ok = unsafe { w::LockWorkStation() };
            if ok == 0 {
                Err("Windows refused to lock the workstation".into())
            } else {
                Ok(json!({ "ok": true }))
            }
        }
        other => Err(format!("unknown power action '{other}'")),
    }
}

/// Kept here so the shell module doesn't need to know about power-menu verbs.
pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The emptying walk has to cope with the two things a real bin is full of: nested folders and
    /// read-only files. Run it on a tree of our own — a test must never touch the real bin.
    #[test]
    fn purge_empties_a_tree_and_counts_bytes() {
        let root = std::env::temp_dir().join(format!("winwidget-purge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("a/b/one.txt"), b"hello").unwrap();
        std::fs::write(root.join("a/two.bin"), vec![0u8; 64]).unwrap();
        std::fs::write(root.join("three.txt"), b"x").unwrap();
        let mut perms = std::fs::metadata(root.join("three.txt")).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(root.join("three.txt"), perms).unwrap();

        let mut removed = 0u64;
        let mut failed = 0u64;
        purge(&root, &mut removed, &mut failed);
        assert_eq!(failed, 0, "every entry should have been removed");
        assert_eq!(removed, 70, "5 + 64 + 1 bytes");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0, "the folder itself stays");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The card can never be made to wait for a walk: an answer comes back at once, either from the
    /// last measurement or with `items: -1` while the walk is still going.
    #[test]
    fn state_answers_without_walking() {
        let started = Instant::now();
        let state = recycle_state();
        assert!(started.elapsed() < std::time::Duration::from_millis(200));
        assert_eq!(state["available"], json!(true));
        assert!(state["items"].is_i64());
    }
}

