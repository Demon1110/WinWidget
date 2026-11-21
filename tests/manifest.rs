#![allow(unused_imports)]

//! Tests for `src/model/manifest.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use winwidget::model::manifest::*;


fn manifest_with_tools(label: &str, tools: &str, permissions: &str) -> (Manifest, PathBuf) {
    let dir =
        std::env::temp_dir().join(format!("winwidget-manifest-{}-{label}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html>").unwrap();
    let json = format!(
        r#"{{
            "id": "test.tools",
            "version": "1.0.0",
            "size": {{ "width": 320, "height": 200 }},
            "permissions": {permissions},
            "tools": {tools}
        }}"#
    );
    let mut manifest: Manifest = serde_json::from_str(&json).unwrap();
    manifest.dir = dir.clone();
    (manifest, dir)
}

#[test]
fn accepts_a_declared_tool() {
    let (mut manifest, dir) = manifest_with_tools(
        "ok",
        r#"[{
            "name": "ocr",
            "url": "https://example.com/tools/ocr.exe",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }]"#,
        r#"["tool.exec", "network:example.com"]"#,
    );
    assert!(manifest.validate().is_ok());
    assert_eq!(manifest.tools[0].file_name().unwrap(), "ocr.exe");
    assert_eq!(manifest.tools[0].timeout_ms(), 30_000);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn accepts_a_tool_without_a_hash() {
    let (mut manifest, dir) = manifest_with_tools(
        "no-hash",
        r#"[{
            "name": "ocr",
            "url": "https://example.com/tools/ocr.exe"
        }]"#,
        r#"["tool.exec", "network:example.com"]"#,
    );
    assert!(manifest.validate().is_ok());
    assert!(manifest.tools[0].sha256.is_none());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn rejects_a_tool_without_permission_or_a_bad_hash() {
    let (mut manifest, dir) = manifest_with_tools(
        "no-permission",
        r#"[{
            "name": "ocr",
            "url": "https://example.com/tools/ocr.exe",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }]"#,
        r#"["network:example.com"]"#,
    );
    assert!(manifest.validate().is_err());
    let _ = std::fs::remove_dir_all(dir);

    let (mut manifest, dir) = manifest_with_tools(
        "bad-hash",
        r#"[{
            "name": "ocr",
            "url": "https://example.com/tools/ocr.exe",
            "sha256": "not-a-hash"
        }]"#,
        r#"["tool.exec", "network:example.com"]"#,
    );
    assert!(manifest.validate().is_err());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn rejects_a_device_filename() {
    let (mut manifest, dir) = manifest_with_tools(
        "device-name",
        r#"[{
            "name": "ocr",
            "url": "https://example.com/tools/CON.exe",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }]"#,
        r#"["tool.exec", "network:example.com"]"#,
    );
    assert!(manifest.validate().is_err());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn accepts_aliases_for_a_renamed_widget() {
    let dir = std::env::temp_dir().join(format!("winwidget-manifest-alias-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html>").unwrap();
    let json = r#"{
        "id": "ledger",
        "version": "1.4.0",
        "aliases": ["winwidget.ledger"],
        "size": { "width": 320, "height": 300 }
    }"#;
    let mut manifest: Manifest = serde_json::from_str(json).unwrap();
    manifest.dir = dir.clone();
    assert!(manifest.validate().is_ok());
    assert_eq!(manifest.aliases, vec!["winwidget.ledger"]);

    let json = r#"{
        "id": "ledger",
        "version": "1.4.0",
        "aliases": ["ledger"],
        "size": { "width": 320, "height": 300 }
    }"#;
    let mut manifest: Manifest = serde_json::from_str(json).unwrap();
    manifest.dir = dir.clone();
    assert!(manifest.validate().is_err());
    let _ = std::fs::remove_dir_all(dir);
}
