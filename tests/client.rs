#![allow(unused_imports)]

//! Tests for `src/market/client.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::time::Duration;
use winwidget::market::client::*;
use winwidget::runtime::app::App;

#[test]
fn the_default_page_is_the_web_market() {
    assert_eq!(page_of(None), MARKET_SITE);
    assert_eq!(page_of(Some("   ")), MARKET_SITE);
    assert_eq!(page_of(Some(MARKET_SITE)), MARKET_SITE);
}

#[test]
fn a_json_market_url_opens_the_folder_that_holds_it() {
    assert_eq!(
        page_of(Some(
            "https://demon1110.github.io/WinWidgetHub/widgets.json"
        )),
        "https://demon1110.github.io/WinWidgetHub"
    );
    assert_eq!(page_of(Some("widgets.json")), MARKET_SITE);
}
