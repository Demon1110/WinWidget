#![allow(unused_imports)]

//! Tests for `src/market/packages.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use winwidget::market::packages::*;
use winwidget::runtime::app::App;

/// `.fwz` is a plain zip: standard headers, deflate, one folder inside. The probe file is left
/// behind on purpose so an outside reader (python's zipfile, `Expand-Archive`) can be pointed
/// at what the writer really produced.
#[test]
fn a_fwz_package_is_an_ordinary_zip() {
    let base = std::env::temp_dir().join(format!("winwidget-fwz-{}", std::process::id()));
    let src = base.join("demo");
    std::fs::create_dir_all(src.join("sub")).unwrap();
    std::fs::write(
        src.join("widget.json"),
        r#"{"id":"demo","name":"Demo","entry":"index.html"}"#,
    )
    .unwrap();
    std::fs::write(src.join("index.html"), "<!doctype html>").unwrap();
    std::fs::write(src.join("sub/note.txt"), b"hello").unwrap();
    let probe = base.join("demo-1.0.0.fwz");

    let file = std::fs::File::create(&probe).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    add_folder(&mut writer, &src, "demo", options).unwrap();
    writer.finish().unwrap();

    let mut archive = zip::ZipArchive::new(std::fs::File::open(&probe).unwrap()).unwrap();
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).unwrap();
        names.push(entry.name().unwrap_or_default().to_string());
    }
    names.sort();
    assert_eq!(
        names,
        vec!["demo/index.html", "demo/sub/note.txt", "demo/widget.json"]
    );
    assert!(names.iter().all(|name| name.starts_with("demo/")));
    println!("probe: {}", probe.display());
}

/// A uTools developer uploads `plugin.json` + the built files, so downloads of a plugin are a
/// plain `.zip` with no `widget.json` at all. That has to be recognised as a package too, and
/// rooted at the shallowest `plugin.json` (the extra copies some bundlers leave behind must not
/// win).
#[test]
fn a_zipped_utools_plugin_is_rooted_at_its_shallowest_plugin_json() {
    let base = std::env::temp_dir().join(format!("winwidget-zip-root-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let probe = base.join("plugin.zip");

    let file = std::fs::File::create(&probe).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("plugin.json", options).unwrap();
    writer
        .write_all(br#"{"pluginName":"demo plugin","main":"index.html","preload":"preload.js"}"#)
        .unwrap();
    writer.start_file("index.html", options).unwrap();
    writer.write_all(b"<!doctype html>").unwrap();
    writer
        .start_file("node_modules/x/plugin.json", options)
        .unwrap();
    writer.write_all(br#"{"pluginName":"nested"}"#).unwrap();
    writer.finish().unwrap();

    let mut archive = zip::ZipArchive::new(std::fs::File::open(&probe).unwrap()).unwrap();
    let (native, path) = package_root(&mut archive).unwrap();
    assert!(!native, "there is no widget.json in this package");
    assert_eq!(path, "plugin.json");
    let _ = std::fs::remove_dir_all(&base);
}

/// The exact package the user handed over: a uTools developer upload (files at the zip root,
/// `plugin.json` naming the plugin, a `preload.js` that wants Node) with no `widget.json`
/// anywhere. It has to unpack into a widget folder with a synthesised manifest.
#[test]
fn a_zipped_utools_plugin_unpacks_into_a_widget_folder() {
    let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("dist/plugin.zip");
    if !package.is_file() {
        println!("skip: {} is not there", package.display());
        return;
    }
    let dir = std::env::temp_dir().join(format!("winwidget-zip-real-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let unpacked = unpack_zip(&package, &dir).unwrap();
    assert!(unpacked.node, "the package declares preload.js");
    assert!(
        unpacked.id.starts_with("uplugin-"),
        "this plugin has no `name`, so the id is a hash of its name; got {}",
        unpacked.id
    );
    assert_eq!(unpacked.name, "变焦录屏");
    assert!(dir.join("index.html").is_file());
    assert!(dir.join("index.js").is_file());
    assert!(dir.join("plugin.json").is_file());
    let manifest = winwidget::core::util::read_text(&dir.join("widget.json")).unwrap();
    let value: Value = serde_json::from_str(&manifest).unwrap();
    assert_eq!(value["entry"], "index.html");
    assert_eq!(value["icon"], "logo.svg");
    assert_eq!(value["utools"]["preload"], "preload.js");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The native manifest always wins, even when it sits deeper than some `plugin.json`: a package
/// that already declares itself for WinWidget must never be converted from uTools fields.
#[test]
fn a_widget_manifest_wins_over_a_plugin_manifest() {
    let base = std::env::temp_dir().join(format!("winwidget-zip-native-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let probe = base.join("both.zip");

    let file = std::fs::File::create(&probe).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("plugin.json", options).unwrap();
    writer.write_all(br#"{"pluginName":"demo"}"#).unwrap();
    writer.start_file("demo/widget.json", options).unwrap();
    writer.write_all(br#"{"id":"demo"}"#).unwrap();
    writer.finish().unwrap();

    let mut archive = zip::ZipArchive::new(std::fs::File::open(&probe).unwrap()).unwrap();
    let (native, path) = package_root(&mut archive).unwrap();
    assert!(native);
    assert_eq!(path, "demo/widget.json");
    let _ = std::fs::remove_dir_all(&base);
}
