#![allow(unused_imports)]

//! Tests for `src/core/tool.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::tool::*;
use winwidget::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use winwidget::model::manifest::ToolSpec;

fn digest(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex(&hasher.finish())
}

#[test]
fn sha256_known_vectors() {
    assert_eq!(
        digest(""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        digest("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        digest("The quick brown fox jumps over the lazy dog"),
        "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
    );
}

#[test]
fn sha256_matches_a_long_stream() {
    let text = "a".repeat(1000);
    let mut hasher = Sha256::new();
    for chunk in text.as_bytes().chunks(37) {
        hasher.update(chunk);
    }
    assert_eq!(
        hex(&hasher.finish()),
        "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
    );
}

#[cfg(windows)]
#[test]
fn captures_exit_code_stdout_and_stderr() {
    let result = execute(
        std::path::Path::new(r"C:\Windows\System32\cmd.exe"),
        &["/C".into(), "echo out& echo err 1>&2".into()],
        None,
        std::path::Path::new("."),
        5_000,
    )
    .unwrap();
    assert_eq!(result["code"].as_i64(), Some(0));
    assert_eq!(result["ok"].as_bool(), Some(true));
    assert!(result["stdout"].as_str().unwrap().contains("out"));
    assert!(result["stderr"].as_str().unwrap().contains("err"));
}

#[test]
#[ignore = "network: downloads a 5-byte body from httpbin.org"]
fn downloads_verifies_and_caches() {
    let dir = std::env::temp_dir().join(format!("winwidget-tool-download-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html>").unwrap();
    let mut manifest: winwidget::model::manifest::Manifest = serde_json::from_value(json!({
        "id": "test.download",
        "version": "1.0.0",
        "size": { "width": 320, "height": 200 },
        "permissions": ["tool.exec", "network:httpbin.org"],
        "tools": [{
            "name": "hello",
            "url": "https://httpbin.org/base64/aGVsbG8=",
            "filename": "hello.exe",
            "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            "size": 5
        }]
    }))
    .unwrap();
    manifest.dir = dir.clone();
    manifest.validate().unwrap();
    let allowed = vec!["tool.exec".to_string(), "network:httpbin.org".to_string()];
    let spec = &manifest.tools[0];

    let first = ensure_tool(&manifest.dir, &manifest.id, &allowed, spec, false).unwrap();
    assert!(first.downloaded);
    assert_eq!(file_len(&first.path), 5);
    let second = ensure_tool(&manifest.dir, &manifest.id, &allowed, spec, false).unwrap();
    assert!(!second.downloaded, "a verified cache should be reused");
    let third = ensure_tool(&manifest.dir, &manifest.id, &allowed, spec, true).unwrap();
    assert!(third.downloaded);

    let mut bad = spec.clone();
    bad.sha256 = Some("0".repeat(64));
    assert!(ensure_tool(&manifest.dir, &manifest.id, &allowed, &bad, true).is_err());

    // Without a declared hash the download still succeeds and the sidecar keeps the cache fresh.
    let mut no_hash = spec.clone();
    no_hash.sha256 = None;
    let fourth = ensure_tool(&manifest.dir, &manifest.id, &allowed, &no_hash, true).unwrap();
    assert!(fourth.downloaded);
    let fifth = ensure_tool(&manifest.dir, &manifest.id, &allowed, &no_hash, false).unwrap();
    assert!(!fifth.downloaded, "an unhashed cache should be reused");
    let _ = std::fs::remove_dir_all(dir);
}
