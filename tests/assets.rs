#![allow(unused_imports)]

//! Tests for `src/core/assets.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use winwidget::core::assets::*;

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
    let widgets = children_dirs(std::path::Path::new(VROOT).join("widgets").as_path());
    assert!(!widgets.is_empty(), "assets/widgets 里至少要有一个组件");
    // 数量跟着仓库走，但每个列出来的目录都得有 manifest，否则客户端发现不了它
    for w in &widgets {
        assert!(
            has(&format!("widgets/{w}/widget.json")),
            "{w} 缺 widget.json"
        );
    }
}

#[test]
fn milestone_screenshots_stay_out() {
    assert!(!has("docs/m2/theme-paper.png"), "docs/m* is not packed");
}
