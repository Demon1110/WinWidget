#![allow(unused_imports)]

//! Tests for `src/runtime/window_category.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::collections::HashMap;
use tao::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, Window, WindowBuilder};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::bus::{post, Ev};
use winwidget::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use winwidget::platform::win32 as w;
use winwidget::runtime::app::App;
use winwidget::runtime::window_category::*;
use wry::{Rect, WebView, WebViewBuilder};

#[test]
fn dip_round_trip_at_real_scales() {
    for scale in [1.0, 1.25, 1.5, 2.0] {
        for dip in [0.0, 12.0, 96.0, 333.0] {
            assert_eq!(
                from_dip(to_dip(from_dip(dip, scale), scale), scale),
                from_dip(dip, scale)
            );
        }
    }
    // A non-positive scale is treated as "no scaling", not a divide-by-zero.
    assert_eq!(to_dip(96.0, 0.0), 96.0);
    assert_eq!(from_dip(96.0, -1.0), 96.0);
}

#[test]
fn parses_hex_and_css_colours() {
    assert_eq!(parse_color("#fff", false), (255, 255, 255, 255));
    assert_eq!(parse_color("#000000", false), (0, 0, 0, 255));
    assert_eq!(parse_color("#4cc9f0", false), (0x4c, 0xc9, 0xf0, 255));
    assert_eq!(parse_color("#11223344", false), (0x11, 0x22, 0x33, 0x44));
    assert_eq!(parse_color("rgb(1, 2, 3)", false), (1, 2, 3, 255));
    assert_eq!(parse_color("rgba(1, 2, 3, 0.5)", false), (1, 2, 3, 128));
    assert_eq!(parse_color("transparent", true), (0, 0, 0, 0));
    assert_eq!(parse_color("transparent", false), (255, 255, 255, 255));
    assert_eq!(parse_color("not a colour", false), (255, 255, 255, 255));
}

#[test]
fn snap_metrics_scale_and_clamp() {
    assert_eq!(snap_metrics(1.0), (12, 8, (1, 5, 4)));
    assert_eq!(snap_metrics(2.0), (24, 16, (2, 10, 8)));
    // A tiny scale still leaves a one-pixel guide and a positive snap reach.
    let (gap, reach, (thickness, _, _)) = snap_metrics(0.01);
    assert!(gap >= 0 && reach >= 1 && thickness >= 1);
}

#[test]
fn unsupported_methods_explain_why() {
    assert!(unsupported_reason("capturePage").is_some());
    assert!(unsupported_reason("printToPDF").is_some());
    assert!(unsupported_reason("window.hide").is_none());
    assert!(unsupported_reason("").is_none());
}
