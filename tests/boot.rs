#![allow(unused_imports)]

//! Tests for the boot data `src/ui/server.rs` hands a custom window or a dialog.
//!
//! A custom page inherits its instance's boot wholesale, so anything the window decides for itself
//! has to be written back over it. `resizable` is the one that bites: the parent card is resizable
//! while a dialog is not, and the SDK hangs a resize grip on `boot.resizable`.

use serde_json::{json, Value};
use winwidget::ui::server::{custom_boot, dialog_boot};

fn card_boot() -> String {
    json!({
        "instanceId": "abc123",
        "windowType": "main",
        "resizable": true,
        "width": 380,
        "height": 640,
        "settings": { "city": "成田市" }
    })
    .to_string()
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).expect("boot data is JSON")
}

#[test]
fn a_custom_window_overrides_what_its_card_said() {
    let boot = parse(&custom_boot(&card_boot(), 7, false, false));
    assert_eq!(boot["windowType"], json!("custom"));
    assert_eq!(boot["windowId"], json!(7));
    assert_eq!(boot["parentInstance"], json!("abc123"));
    assert_eq!(boot["visible"], json!(false));
    assert_eq!(boot["resizable"], json!(false));
    // Everything else still comes from the card: origin, settings, size.
    assert_eq!(boot["instanceId"], json!("abc123"));
    assert_eq!(boot["settings"]["city"], json!("成田市"));
}

#[test]
fn a_resizable_custom_window_keeps_its_own_answer() {
    let boot = parse(&custom_boot(&card_boot(), 9, true, true));
    assert_eq!(boot["resizable"], json!(true));
    assert_eq!(boot["visible"], json!(true));
}

#[test]
fn a_dialog_carries_the_normalized_config_and_stays_unresizable() {
    let cfg = json!({ "kind": "alert", "title": "保存完成", "resizable": false });
    let boot = parse(&dialog_boot(&card_boot(), 12, true, false, &cfg));
    assert_eq!(boot["windowType"], json!("custom"));
    assert_eq!(boot["dialog"]["kind"], json!("alert"));
    assert_eq!(boot["kind"], json!("alert"));
    assert_eq!(boot["resizable"], json!(false));
}

#[test]
fn broken_parent_boot_still_yields_usable_boot_data() {
    // The page must not be left with a half-written boot object.
    let boot = parse(&custom_boot("not json at all", 3, true, false));
    assert_eq!(boot["windowType"], json!("custom"));
    assert_eq!(boot["windowId"], json!(3));
    assert_eq!(boot["resizable"], json!(false));
}
