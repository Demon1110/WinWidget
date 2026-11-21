#![allow(unused_imports)]

//! Tests for `src/platform/power.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use winwidget::platform::power::*;
use winwidget::platform::win32 as w;

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
    let mut perms = std::fs::metadata(root.join("three.txt"))
        .unwrap()
        .permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(root.join("three.txt"), perms).unwrap();

    let mut removed = 0u64;
    let mut failed = 0u64;
    purge(&root, &mut removed, &mut failed);
    assert_eq!(failed, 0, "every entry should have been removed");
    assert_eq!(removed, 70, "5 + 64 + 1 bytes");
    assert_eq!(
        std::fs::read_dir(&root).unwrap().count(),
        0,
        "the folder itself stays"
    );
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
    // The card needs to tell "nothing happened" apart from "a few locked files were left behind".
    assert!(
        state["failed"].as_i64().is_some_and(|n| n >= 0),
        "every answer carries the leftover count"
    );
}
