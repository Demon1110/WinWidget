#![allow(unused_imports)]

//! Tests for `src/core/text.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::Value;
use std::sync::RwLock;
use winwidget::core::text::*;

#[test]
fn the_language_can_change_while_the_app_runs() {
    let before = locale();
    set_locale("en");
    assert_eq!(locale(), "en");
    // The old implementation only kept the first value, so a second choice never arrived.
    set_locale("zh-CN");
    assert_eq!(locale(), "zh-CN");
    set_locale(&before);
}
