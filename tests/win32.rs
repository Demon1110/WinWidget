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
