#![allow(unused_imports)]

//! Tests for `src/core/features.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{Map, Value};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::features::*;
use winwidget::core::util::{jstr, BridgeError, BridgeResult};

use serde_json::json;

#[test]
fn regex_cmd_matches_and_honours_exclude_and_length() {
    let cmd = json!({ "type": "regex", "label": "打开链接", "match": "^https?://", "exclude": "example\\.com", "minLength": 8 });
    assert!(cmd_matches(&cmd, "https://a.b/c", &[]));
    assert!(!cmd_matches(&cmd, "https://example.com", &[]));
    assert!(!cmd_matches(&cmd, "ftp://a", &[]));
    assert!(!cmd_matches(&cmd, "http://", &[]));
}

#[test]
fn over_cmd_is_a_substring_test() {
    let with_match = json!({ "type": "over", "label": "翻译", "match": "translate" });
    assert!(cmd_matches(&with_match, "please translate this", &[]));
    assert!(!cmd_matches(&with_match, "unrelated", &[]));
    let plain = json!({ "label": "计算器" });
    assert!(cmd_matches(&plain, "anything at all", &[]));
}

#[test]
fn files_cmd_needs_a_matching_extension() {
    let cmd = json!({ "type": "files", "label": "压缩图片", "extensions": [".png", ".jpg"] });
    assert!(cmd_matches(&cmd, "", &["C:\\a\\B.PNG".to_string()]));
    assert!(!cmd_matches(&cmd, "", &["C:\\a\\b.txt".to_string()]));
    assert!(!cmd_matches(&cmd, "", &[]));
}

#[test]
fn img_and_window_cmds_never_answer_text() {
    assert!(!cmd_matches(
        &json!({ "type": "img", "label": "识图" }),
        "x",
        &[]
    ));
    assert!(!cmd_matches(
        &json!({ "type": "window", "label": "贴边" }),
        "x",
        &[]
    ));
}

#[test]
fn a_broken_pattern_never_matches() {
    assert!(!cmd_matches(
        &json!({ "type": "regex", "label": "坏", "match": "([a-" }),
        "a",
        &[]
    ));
}
