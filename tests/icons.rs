#![allow(unused_imports)]

//! Tests for `src/model/icons.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use winwidget::model::icons::*;
use winwidget::model::manifest::Manifest;

#[test]
fn webp_preview_falls_back_to_png_then_jpeg() {
    assert_eq!(
        preview_candidates("preview/device.webp"),
        vec![
            "preview/device.webp",
            "preview/device.png",
            "preview/device.jpg",
            "preview/device.jpeg"
        ]
    );
}

#[test]
fn a_png_preview_is_not_rewritten() {
    assert_eq!(
        preview_candidates("preview/device.png"),
        vec!["preview/device.png"]
    );
    assert_eq!(
        preview_candidates("preview/no-extension"),
        vec!["preview/no-extension"]
    );
}

#[test]
fn a_missing_webp_falls_back_to_the_png_on_disk() {
    let dir = std::env::temp_dir().join(format!(
        "winwidget-preview-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(dir.join("preview")).expect("create the preview folder");
    std::fs::write(dir.join("preview/preview.png"), b"png").expect("write a fake png");

    let manifest = Manifest {
        dir: dir.clone(),
        preview: Some("preview/preview.webp".into()),
        ..Manifest::default()
    };

    let url = preview_url(&manifest, "instrument", "zh-CN").expect("a png should be accepted");
    assert!(url.contains("preview/preview.png"), "{url}");

    let _ = std::fs::remove_dir_all(&dir);
}
