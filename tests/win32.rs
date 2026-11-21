#![allow(unused_imports)]

//! Tests for `src/platform/win32.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use std::collections::HashMap;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use winwidget::platform::win32::*;

/// The frameless style must never be written onto a child window. An effect window mounted on the
/// wallpaper layer is a `WS_CHILD` of the shell; `WS_POPUP` on it makes Windows stack it as a popup,
/// which lifts the effect back above the desktop icons and hides them behind an opaque sheet.
#[test]
fn frameless_style_leaves_child_windows_alone() {
    // A mounted wallpaper window: child of the shell, no caption, already stripped.
    let child = WS_CHILD | WS_CLIPCHILDREN | 0x1000_0000; // WS_VISIBLE
    assert_eq!(frameless_style(child), child);
    // Even if the frame bits somehow survived, a child still must not gain WS_POPUP.
    let child_framed = child | 0x00C0_0000 /* WS_CAPTION */ | 0x0004_0000 /* WS_THICKFRAME */;
    assert_eq!(frameless_style(child_framed), child_framed);
    assert_eq!(frameless_style(child_framed) & WS_POPUP, 0);

    // An ordinary card: caption and sizing edge dropped, WS_POPUP stated.
    let popup = 0x1000_0000 | 0x00C0_0000 | 0x0004_0000 | 0x0008_0000;
    let styled = frameless_style(popup);
    assert_eq!(styled & WS_POPUP, WS_POPUP);
    assert_eq!(styled & WS_CHILD, 0);
    assert_eq!(styled & 0x00C0_0000, 0, "the caption must be gone");
    assert_eq!(styled & 0x0004_0000, 0, "the sizing edge must be gone");
    // Idempotent: stripping an already frameless window changes nothing.
    assert_eq!(frameless_style(styled), styled);
}

/// The wallpaper mount only works if the shell really exposes an icon layer we can sit below.
/// This is read-only: it never creates or moves a window, so it is safe in CI and on a live
/// desktop. On non-Windows dev builds there is no Progman and the test is a no-op.
#[test]
fn wallpaper_host_finds_the_icon_layer() {
    let prog = progman();
    if prog == 0 {
        return; // not a Windows shell (or headless CI) — nothing to assert
    }
    let (host, defview) = wallpaper_host();
    assert_ne!(host, 0, "the shell must expose a wallpaper host");
    if host == prog {
        // Fallback layout: DefView lives directly under Progman and no WorkerW could be
        // spawned, so the effect mounts below the icons inside Progman.
        assert_ne!(defview, 0, "SHELLDLL_DefView must be a child of Progman");
        assert_eq!(class_name(defview), "SHELLDLL_DefView");
    } else {
        // Preferred layout: the wallpaper WorkerW below the icon host. It has no DefView of
        // its own — the icons live in the sibling window above us.
        assert_eq!(class_name(host), "WorkerW");
        assert_eq!(defview, 0, "the wallpaper WorkerW must not host the icons");
    }
}
