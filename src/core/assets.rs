//! The `assets\` tree, compiled into the binary.
//!
//! A shipped WinWidget is one `.exe`: widgets, SDK, themes, control center and the developer
//! guide are all inside it (deflated where that pays — see `build.rs`). Nothing is unpacked to
//! disk, so the program has no folder to lose and no first-run extraction.
//!
//! The source tree still wins when it is on disk — `WINWIDGET_DEV_ROOT`, or an `assets\` folder
//! next to the exe — so editing a widget shows up without a rebuild. `paths::resource_root()`
//! holds a virtual path (`embedded:/assets`) when no folder was found; everything below accepts
//! either a real folder or that marker.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

/// A file packed into the binary. `packed` means `bytes` is raw deflate.
pub struct Asset {
    pub path: &'static str,
    pub packed: bool,
    pub bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/assets_embed.rs"));

/// Prefix of the virtual resource root: `embedded:/assets\widgets` and so on.
pub const VROOT: &str = "embedded:/assets";

fn index() -> &'static HashMap<&'static str, usize> {
    static INDEX: OnceLock<HashMap<&'static str, usize>> = OnceLock::new();
    INDEX.get_or_init(|| {
        ASSETS
            .iter()
            .enumerate()
            .map(|(i, a)| (a.path, i))
            .collect()
    })
}

/// True when `dir` is a virtual path rather than a folder on disk.
pub fn is_virtual(dir: &Path) -> bool {
    dir.to_string_lossy()
        .replace('\\', "/")
        .starts_with("embedded:")
}

/// `assets\sdk\base.css` → `sdk/base.css`; `None` for anything outside the tree.
fn normalize(rel: &str) -> Option<String> {
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_start_matches(['/', '\\']);
    if rel.is_empty() || rel.starts_with("..") || rel.contains("../") {
        return None;
    }
    Some(rel.trim_end_matches('/').to_string())
}

/// Reads an embedded file by its path inside `assets\`, e.g. `sdk/base.css`.
pub fn read(rel: &str) -> Option<Vec<u8>> {
    let rel = normalize(rel)?;
    let asset = &ASSETS[*index().get(rel.as_str())?];
    if !asset.packed {
        return Some(asset.bytes.to_vec());
    }
    use flate2::read::DeflateDecoder;
    use std::io::Read;

    let mut out = Vec::new();
    DeflateDecoder::new(asset.bytes)
        .read_to_end(&mut out)
        .ok()
        .map(|_| out)
}

pub fn has(rel: &str) -> bool {
    normalize(rel)
        .and_then(|r| index().get(r.as_str()).copied())
        .is_some()
}

/// Reads a file below `dir`, which may be a real folder or a virtual root.
pub fn read_under(dir: &Path, rel: &str) -> Option<Vec<u8>> {
    let base = virtual_base(dir)?;
    let rel = normalize(rel)?;
    let full = if base.is_empty() {
        rel
    } else {
        format!("{base}/{rel}")
    };
    read(&full)
}

/// True when a file exists below `dir`, which may be a real folder or a virtual root.
pub fn has_under(dir: &Path, rel: &str) -> bool {
    let Some(base) = virtual_base(dir) else {
        return false;
    };
    let rel = normalize(rel).unwrap_or_default();
    let full = if base.is_empty() {
        rel
    } else {
        format!("{base}/{rel}")
    };
    has(&full)
}

/// Bytes of a file below `dir`, whichever place it lives in: a folder on disk, or the copy in the
/// binary. Every read of widget, theme, ui and doc files goes through here.
pub fn file_bytes(dir: &Path, rel: &str) -> Option<Vec<u8>> {
    if is_virtual(dir) {
        return read_under(dir, rel);
    }
    let file = crate::core::paths::resolve_inside(dir, rel)?;
    if !file.is_file() {
        return None;
    }
    std::fs::read(&file).ok()
}

/// True when a file below `dir` exists, on disk or in the binary.
pub fn file_exists(dir: &Path, rel: &str) -> bool {
    if is_virtual(dir) {
        return has_under(dir, rel);
    }
    crate::core::paths::resolve_inside(dir, rel)
        .map(|f| f.is_file())
        .unwrap_or(false)
}

/// Every file below a virtual `dir`, as paths relative to it (`preview/x.webp`).
pub fn files_under(dir: &Path) -> Vec<String> {
    let Some(base) = virtual_base(dir) else {
        return Vec::new();
    };
    let prefix = if base.is_empty() {
        String::new()
    } else {
        format!("{base}/")
    };
    let mut out: Vec<String> = ASSETS
        .iter()
        .filter_map(|a| a.path.strip_prefix(prefix.as_str()))
        .filter(|rest| !rest.is_empty())
        .map(|rest| rest.to_string())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Immediate sub-folders of a virtual `dir` (for widget and theme discovery).
pub fn children_dirs(dir: &Path) -> Vec<String> {
    children(dir, true)
}

/// Immediate files of a virtual `dir`.
pub fn children_files(dir: &Path) -> Vec<String> {
    children(dir, false)
}

fn children(dir: &Path, want_dirs: bool) -> Vec<String> {
    let Some(base) = virtual_base(dir) else {
        return Vec::new();
    };
    let prefix = if base.is_empty() {
        String::new()
    } else {
        format!("{base}/")
    };
    let mut out: Vec<String> = Vec::new();
    for asset in ASSETS {
        let Some(rest) = asset.path.strip_prefix(prefix.as_str()) else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }
        match rest.split_once('/') {
            Some((name, _)) => {
                if want_dirs && !out.iter().any(|x| x == name) {
                    out.push(name.to_string());
                }
            }
            None if !want_dirs => out.push(rest.to_string()),
            None => {}
        }
    }
    out.sort();
    out
}

/// The part of `dir` below the virtual root, e.g. `embedded:/assets/widgets` → `widgets`.
fn virtual_base(dir: &Path) -> Option<String> {
    let text = dir.to_string_lossy().replace('\\', "/");
    let rest = text.strip_prefix(VROOT).unwrap_or("");
    let rest = rest.trim_start_matches('/');
    Some(rest.to_string())
}

#[cfg(test)]
mod tests {
    use super::{children_dirs, has, read};

    #[test]
    fn a_file_from_the_assets_tree_can_be_read() {
        let css = read("sdk/base.css").expect("sdk/base.css is embedded");
        assert!(css.len() > 1000, "the stylesheet is not empty");
        assert!(String::from_utf8_lossy(&css).contains("--w-bg"));
    }

    #[test]
    fn paths_outside_the_tree_are_refused() {
        assert!(!has("../../Cargo.toml"));
        assert!(!has("nope/nothing.css"));
    }

    #[test]
    fn widgets_are_listed_from_the_table() {
        let widgets = children_dirs(std::path::Path::new(super::VROOT).join("widgets").as_path());
        assert!(widgets.len() > 30, "got {widgets:?}");
        assert!(widgets.iter().any(|w| w == "clock"), "clock is bundled");
    }

    #[test]
    fn milestone_screenshots_stay_out() {
        assert!(!has("docs/m2/theme-paper.png"), "docs/m* is not packed");
    }
}
