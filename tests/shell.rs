#![allow(unused_imports)]

//! Tests for `src/platform/shell.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::path::Path;
use winwidget::platform::shell::*;

#[test]
fn icon_rejects_names_that_are_not_paths_or_extensions() {
    // A path that does not exist has no icon; neither has an extension with separators in it.
    assert!(icon("C:\\definitely\\not\\here\\nope.xyz", 32).is_none());
    assert!(icon(".p/n", 32).is_none());
    assert!(icon(".", 32).is_none());
}

#[test]
fn known_folders_resolve_to_absolute_paths() {
    for name in ["home", "desktop", "documents", "downloads", "temp"] {
        let path = winwidget::platform::win32::known_folder_path(name);
        assert!(path.is_some(), "{name} should resolve");
        let path = path.unwrap();
        assert!(Path::new(&path).is_absolute(), "{name} → {path}");
    }
    assert!(winwidget::platform::win32::known_folder_path("nope").is_none());
}

#[test]
fn a_widget_folder_is_not_a_link_but_is_openable() {
    // The "folder" button used to run a folder path through `open`, which only accepts links.
    let folder = "C:\\Users\\admin\\AppData\\Roaming\\WinWidget\\widgets\\clipboard";
    assert!(!is_link(folder), "a folder must not look like a link");
    // `open_path` is the door a folder takes; for something that is not there it fails on the
    // missing folder rather than on the scheme, without launching Explorer.
    let missing = "C:\\definitely\\not\\here\\folder";
    assert!(!is_link(missing));
    match open_path(missing) {
        Err(e) => assert!(e.contains("does not exist"), "{e}"),
        Ok(()) => panic!("a missing folder should not open"),
    }
    for link in [
        "https://example.com",
        "HTTPS://example.com",
        " mailto:a@b.c",
        "www.example.com",
    ] {
        assert!(is_link(link), "{link} should be a link");
    }
    for text in [r"D:\java\git", "/home/user", "C:a.txt", ""] {
        assert!(!is_link(text), "{text} should not be a link");
    }
}

fn scratch_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "winwidget-rename-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn renames_a_file_in_place() {
    let dir = scratch_dir("ok");
    let from = dir.join("before.txt");
    let to = dir.join("after.txt");
    std::fs::write(&from, "x").unwrap();
    let report = rename(&[json!({
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
    })]);
    assert_eq!(report["ok"], true, "{report}");
    assert!(!from.exists());
    assert!(to.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn refuses_to_overwrite_an_existing_target() {
    let dir = scratch_dir("exists");
    let from = dir.join("a.txt");
    let to = dir.join("b.txt");
    std::fs::write(&from, "a").unwrap();
    std::fs::write(&to, "b").unwrap();
    let report = rename(&[json!({
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
    })]);
    assert_eq!(report["ok"], false, "{report}");
    assert!(report["items"][0]["error"]
        .as_str()
        .unwrap()
        .contains("already exists"));
    assert!(from.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn refuses_to_move_across_folders() {
    let dir = scratch_dir("cross");
    let other = dir.join("other");
    std::fs::create_dir_all(&other).unwrap();
    let from = dir.join("a.txt");
    let to = other.join("a.txt");
    std::fs::write(&from, "a").unwrap();
    let report = rename(&[json!({
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
    })]);
    assert_eq!(report["ok"], false, "{report}");
    assert!(report["items"][0]["error"]
        .as_str()
        .unwrap()
        .contains("another folder"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn refuses_an_illegal_windows_name() {
    let dir = scratch_dir("illegal");
    let from = dir.join("a.txt");
    let to = dir.join("bad:name.txt");
    std::fs::write(&from, "a").unwrap();
    let report = rename(&[json!({
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
    })]);
    assert_eq!(report["ok"], false, "{report}");
    let _ = std::fs::remove_dir_all(dir);
}
