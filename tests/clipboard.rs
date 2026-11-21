#![allow(unused_imports)]

//! Tests for `src/core/clipboard.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::clipboard::*;
use winwidget::core::ports::ClipboardPort;
use winwidget::core::util::{jstr, BridgeError, BridgeResult};
use winwidget::platform::win32 as w;

use std::sync::Mutex;

/// A clipboard that lives in memory: no window, no Win32, no `App`. This is exactly
/// what the old `core → platform::win32` coupling made impossible to inject.
struct FakeClipboard {
    text: Mutex<Option<String>>,
    files: Mutex<Vec<String>>,
    writes: Mutex<Vec<String>>,
}

impl FakeClipboard {
    fn new(text: Option<&str>, files: &[&str]) -> Self {
        FakeClipboard {
            text: Mutex::new(text.map(str::to_string)),
            files: Mutex::new(files.iter().map(|s| s.to_string()).collect()),
            writes: Mutex::new(Vec::new()),
        }
    }
}

impl ClipboardPort for FakeClipboard {
    fn read_text(&self) -> Option<String> {
        self.text.lock().unwrap().clone()
    }
    fn write_text(&self, text: &str) -> bool {
        self.writes.lock().unwrap().push(text.to_string());
        true
    }
    fn read_files(&self) -> Vec<String> {
        self.files.lock().unwrap().clone()
    }
    fn write_files(&self, paths: &[String]) -> bool {
        self.writes.lock().unwrap().extend_from_slice(paths);
        true
    }
}

#[test]
fn read_text_maps_present_text_to_json_string() {
    let port = FakeClipboard::new(Some("hello 中文"), &[]);
    assert_eq!(read_text_value(&port), json!("hello 中文"));
}

#[test]
fn read_text_maps_empty_clipboard_to_json_null() {
    let port = FakeClipboard::new(None, &[]);
    assert_eq!(read_text_value(&port), Value::Null);
}

#[test]
fn write_text_forwards_exact_text_to_port() {
    let port = FakeClipboard::new(None, &[]);
    assert!(port.write_text("  spaced\ttext "));
    assert_eq!(*port.writes.lock().unwrap(), vec!["  spaced\ttext "]);
}

#[test]
fn read_files_returns_the_ports_list() {
    let port = FakeClipboard::new(None, &["C:\\a.txt", "D:\\img.png"]);
    assert_eq!(
        port.read_files(),
        vec!["C:\\a.txt".to_string(), "D:\\img.png".to_string()]
    );
}

#[test]
fn null_ports_are_a_safe_default() {
    let port = winwidget::core::ports::NullPorts;
    assert_eq!(read_text_value(&port), Value::Null);
    assert!(!port.write_text("anything"));
    assert!(port.read_files().is_empty());
}
