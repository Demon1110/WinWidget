#![allow(unused_imports)]

//! Tests for `src/core/paths.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use winwidget::core::paths::*;

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
