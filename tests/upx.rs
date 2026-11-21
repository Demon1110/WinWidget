#![allow(unused_imports)]

//! Tests for `src/market/upx.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;
use winwidget::market::upx::*;

use std::io::Write;

/// Builds a `.upx` the same way uTools does: gzip(4 u32 header + JSON + 1 byte + payloads).
fn pack(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut json = String::from("{\"files\":{");
    let mut payload = Vec::new();
    for (i, (name, body)) in files.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!(
            "\"{name}\":{{\"size\":{},\"offset\":\"{}\",\"executable\":true}}",
            body.len(),
            payload.len()
        ));
        payload.extend_from_slice(body);
    }
    json.push_str("}}");
    let mut raw = Vec::new();
    let len = json.len() as u32;
    for n in [4u32, len + 9, len + 5, len] {
        raw.extend_from_slice(&n.to_le_bytes());
    }
    raw.extend_from_slice(json.as_bytes());
    // uTools 把目录补到 4 字节边界，数据区从这里开始。
    while raw.len() % 4 != 0 {
        raw.push(0);
    }
    raw.extend_from_slice(&payload);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&raw).unwrap();
    gz.finish().unwrap()
}

fn sample() -> Vec<u8> {
    let plugin = r#"{"pluginName":"插件面板","name":"abc123","main":"index.html","version":"0.0.6","author":"me","logo":"logo.png","preload":"preload.js"}"#.as_bytes();
    let html = b"<html><head></head><body><script>utools.copyText('x')</script></body></html>";
    pack(&[
        ("plugin.json", plugin),
        ("index.html", html),
        ("logo.png", b"\x89PNG"),
        ("preload.js", b"const os = require('os')"),
    ])
}

fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("wwupx-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn unpacks_and_builds_a_manifest() {
    let dir = scratch("manifest");
    let file = dir.with_extension("upx");
    std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
    std::fs::write(&file, sample()).unwrap();
    let summary = unpack(&file, &dir).unwrap();
    assert_eq!(summary.id, "abc123", "plugin.json name is the id");
    assert_eq!(summary.name, "插件面板");
    assert_eq!(summary.version, "0.0.6");
    assert!(summary.node, "preload.js means Node is needed");
    assert!(summary.permissions.iter().any(|p| p == "clipboard"));
    let text = std::fs::read_to_string(dir.join("widget.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["entry"], "index.html");
    assert_eq!(value["icon"], "logo.png");
    let mut m = winwidget::model::manifest::Manifest::load(&dir, false).unwrap();
    m.validate().unwrap();
    let html = std::fs::read_to_string(dir.join("index.html")).unwrap();
    assert!(html.contains("utools.copyText"));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn falls_back_to_a_hash_id_for_a_chinese_name() {
    let dir = scratch("hash");
    let file = dir.with_extension("upx");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        &file,
        pack(&[
            (
                "plugin.json",
                r#"{"pluginName":"找两列差异","main":"index.html"}"#.as_bytes(),
            ),
            ("index.html", b"<html></html>"),
        ]),
    )
    .unwrap();
    let summary = unpack(&file, &dir).unwrap();
    assert!(summary.id.starts_with("uplugin-"), "id was {}", summary.id);
    assert_eq!(summary.id.len(), "uplugin-".len() + 8);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// 拿真实的 uTools 包当回归样本：`WW_UPX_SAMPLES` 是 `;` 分隔的路径列表。
#[test]
fn real_samples_still_open() {
    let Ok(list) = std::env::var("WW_UPX_SAMPLES") else {
        return;
    };
    for (i, path) in list.split(';').filter(|p| !p.trim().is_empty()).enumerate() {
        let dir = scratch(&format!("real-{i}"));
        let summary = unpack(Path::new(path), &dir).unwrap();
        assert!(!summary.name.is_empty());
        let mut m = winwidget::model::manifest::Manifest::load(&dir, false).unwrap();
        m.validate().unwrap();
        println!(
            "{} -> {} {} permissions={:?} node={}",
            Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            summary.name,
            summary.id,
            summary.permissions,
            summary.node
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

/// 造一个最小的 `.asar`：`[4][len+8][len+4][len]` + JSON 目录 + 数据区。
fn pack_asar(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut json = String::from("{\"files\":{");
    let mut payload = Vec::new();
    for (i, (name, body)) in files.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!(
            "\"{name}\":{{\"size\":{},\"offset\":\"{}\"}}",
            body.len(),
            payload.len()
        ));
        payload.extend_from_slice(body);
    }
    json.push_str("}}");
    let mut text = json.into_bytes();
    while text.len() % 4 != 0 {
        text.push(b' ');
    }
    let mut raw = Vec::new();
    let len = text.len() as u32;
    for n in [4u32, len + 8, len + 4, len] {
        raw.extend_from_slice(&n.to_le_bytes());
    }
    raw.extend_from_slice(&text);
    raw.extend_from_slice(&payload);
    raw
}

#[test]
fn opens_an_installed_utools_plugin_asar() {
    let dir = scratch("asar");
    let file = dir.with_extension("asar");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        &file,
        pack_asar(&[
            (
                "plugin.json",
                r#"{"pluginName":"剪贴板","name":"clipboard","main":"index.html","version":"4.3.2","author":"uTools 团队"}"#.as_bytes(),
            ),
            ("index.html", b"<html><body></body></html>"),
            ("logo.png", b"\x89PNG"),
        ]),
    )
    .unwrap();
    let summary = unpack_asar(&file, &dir).unwrap();
    assert_eq!(summary.id, "clipboard");
    assert_eq!(summary.name, "剪贴板");
    assert_eq!(summary.version, "4.3.2");
    assert!(!summary.node, "this sample has no preload");
    let mut m = winwidget::model::manifest::Manifest::load(&dir, false).unwrap();
    m.validate().unwrap();
    assert!(dir.join("index.html").is_file());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn upxs_packages_are_refused_with_a_reason() {
    let dir = scratch("upxs");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("plugin.upxs");
    std::fs::write(&file, [0xc8, 0x01, 0x00, 0x00, 0x99]).unwrap();
    assert!(is_upxs(&file));
    assert!(!is_upx(&file), "an .upxs is not a gzip .upx");
    assert!(UPXS_HINT.contains("encrypted"));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// 拿本机 uTools 已安装的插件当回归样本：`WW_ASAR_SAMPLES` 是 `;` 分隔的路径列表。
#[test]
fn real_asar_samples_still_open() {
    let Ok(list) = std::env::var("WW_ASAR_SAMPLES") else {
        return;
    };
    for (i, path) in list.split(';').filter(|p| !p.trim().is_empty()).enumerate() {
        let dir = scratch(&format!("asar-real-{i}"));
        let summary = unpack_asar(Path::new(path), &dir).unwrap();
        let mut m = winwidget::model::manifest::Manifest::load(&dir, false).unwrap();
        m.validate().unwrap();
        println!(
            "{} -> {} {} v{} permissions={:?} node={}",
            Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            summary.name,
            summary.id,
            summary.version,
            summary.permissions,
            summary.node
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
