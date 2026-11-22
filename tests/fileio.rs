#![allow(unused_imports)]

//! Tests for `src/core/fileio.rs`.
//!
//! These live outside `src/` like the rest of the suite: they call the module's public helpers
//! with real temporary files, and never go through the bridge (which needs a window).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use winwidget::core::fileio::*;
use winwidget::core::util::{jbool, jstr, req_str, BridgeError, BridgeResult};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A folder of our own under the system temp dir, so two runs never share files.
fn sandbox() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ww-fileio-{}-{}", std::process::id(), n));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn refuses_relative_and_empty_paths() {
    assert!(absolute("").is_err());
    assert!(absolute("   ").is_err());
    assert!(absolute("cat.png").is_err());
    assert!(absolute(r".\cat.png").is_err());
    assert!(absolute(r"C:\Windows\notepad.exe").is_ok());
    assert!(absolute(r"\\server\share\a.txt").is_ok());
}

#[test]
fn expands_environment_variables_in_paths() {
    let path = absolute("%TEMP%\\ww-fileio-check.txt").unwrap();
    assert!(path.is_absolute());
    assert!(!path.to_string_lossy().contains('%'));
}

#[test]
fn writes_then_reads_the_same_bytes() {
    let dir = sandbox();
    let file = dir.join("nested").join("picture.ico");
    let bytes = vec![0u8, 1, 2, 250, 251, 255];
    write_bytes(&file, &bytes).unwrap();
    // The parent folder did not exist: write_bytes created it.
    assert!(file.is_file());
    assert_eq!(read_bytes(&file).unwrap(), bytes);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reads_text_and_says_so_when_it_is_a_folder() {
    let dir = sandbox();
    let file = dir.join("note.txt");
    std::fs::write(&file, "中文 ok").unwrap();
    assert_eq!(
        winwidget::core::util::to_utf8_lossy(&read_bytes(&file).unwrap()),
        "中文 ok"
    );
    assert!(read_bytes(&dir).is_err(), "a folder is not a file");
    assert!(read_bytes(&dir.join("missing.txt")).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn info_describes_files_folders_and_missing_paths() {
    let dir = sandbox();
    let file = dir.join("shape.PNG");
    std::fs::write(&file, b"x").unwrap();

    let info = info_value(&file);
    assert_eq!(info["exists"], json!(true));
    assert_eq!(info["isFile"], json!(true));
    assert_eq!(info["isDir"], json!(false));
    assert_eq!(info["ext"], json!("png"), "extensions come back lower case");
    assert_eq!(info["size"], json!(1));
    assert_eq!(info["name"], json!("shape.PNG"));

    let folder = info_value(&dir);
    assert_eq!(folder["isDir"], json!(true));
    assert_eq!(folder["isFile"], json!(false));

    let missing = info_value(&dir.join("nope.bin"));
    assert_eq!(missing["exists"], json!(false));
    assert_eq!(missing["size"], json!(0));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn lists_files_and_folders_but_skips_hidden_names() {
    let dir = sandbox();
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    std::fs::write(dir.join("a.txt"), b"aa").unwrap();
    std::fs::write(dir.join(".hidden"), b"h").unwrap();

    let flat = list_value(&dir, false);
    let rows = flat["files"].as_array().unwrap();
    let names: Vec<&str> = rows
        .iter()
        .filter_map(|r| r["name"].as_str())
        .collect::<Vec<_>>();
    assert!(names.contains(&"a.txt"));
    assert!(names.contains(&"sub"));
    assert!(!names.contains(&".hidden"));
    assert_eq!(
        flat["missing"],
        Value::Null,
        "an existing folder is not missing"
    );

    // The folder row says it is a folder; the file row says it is not.
    let sub = rows.iter().find(|r| r["name"] == json!("sub")).unwrap();
    assert_eq!(sub["isDir"], json!(true));

    let deep = list_value(&dir, true);
    let deep_rows = deep["files"].as_array().unwrap();
    assert_eq!(
        deep_rows.len(),
        2,
        "recursive listing still has two entries"
    );

    let absent = list_value(&dir.join("gone"), false);
    assert_eq!(absent["missing"], json!(true));
    std::fs::remove_dir_all(&dir).ok();
}
