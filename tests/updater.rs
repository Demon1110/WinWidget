#![allow(unused_imports)]

//! Tests for `src/market/updater.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use winwidget::market::updater::*;
use winwidget::runtime::app::{self, App, Ev};

#[test]
fn versions_compare_numerically() {
    assert_eq!(compare("1.0.10", "1.0.9"), 1);
    assert_eq!(compare("v1.1", "1.0"), 1);
    assert_eq!(compare("1.0", "1.0.0"), 0);
    assert_eq!(compare("0.9", "1.0"), -1);
}

#[test]
fn a_github_release_becomes_the_same_shape_as_our_own_feed() {
    let text = r#"{"tag_name":"v1.2.0","body":"notes","html_url":"https://x/rel",
        "assets":[{"name":"WinWidget-1.2.0-setup.exe","size":123,"browser_download_url":"https://x/a.exe"}]}"#;
    let v = parse_release(text).expect("github release");
    assert_eq!(v["version"], "1.2.0");
    assert_eq!(v["url"], "https://x/a.exe");
    assert_eq!(v["file"], "WinWidget-1.2.0-setup.exe");
    let own = parse_release(r#"{"version":"1.3.0","url":"https://x/b.exe","notes":"n"}"#)
        .expect("own feed");
    assert_eq!(own["version"], "1.3.0");
}

#[test]
fn a_release_with_only_a_zip_has_nowhere_to_install_from() {
    let text = r#"{"tag_name":"v1.2.0","html_url":"https://x/rel",
        "assets":[{"name":"WinWidget-1.2.0-windows-x64.zip","size":999,
        "browser_download_url":"https://x/a.zip"}]}"#;
    let v = parse_release(text).expect("github release");
    assert_eq!(v["version"], "1.2.0");
    // 挑资产时明确不拿 zip 当更新包：zip 不是能直接跑起来的东西
    assert!(v["url"].is_null());
}
