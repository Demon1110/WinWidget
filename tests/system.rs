#![allow(unused_imports)]

//! Tests for `src/core/system.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::ports::SystemPort;
use winwidget::core::system::*;
use winwidget::core::util::{jnum, jstr, req_str, BridgeError, BridgeResult};
use winwidget::platform::win32 as w;

struct FakeSystem {
    known: Vec<(String, String)>,
    light: bool,
}

impl SystemPort for FakeSystem {
    fn known_folder_path(&self, name: &str) -> Option<String> {
        self.known
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, path)| path.clone())
    }
    fn light_mode(&self) -> bool {
        self.light
    }
    fn set_light_mode(&self, _light: bool) -> Result<(), String> {
        Ok(())
    }
}

fn fake() -> FakeSystem {
    FakeSystem {
        known: vec![
            ("desktop".into(), "C:\\Users\\me\\Desktop".into()),
            ("home".into(), "C:\\Users\\me".into()),
        ],
        light: true,
    }
}

#[test]
fn known_folder_resolves_to_json_string() {
    assert_eq!(
        named_path_value(&fake(), "desktop"),
        json!("C:\\Users\\me\\Desktop")
    );
}

#[test]
fn unknown_folder_resolves_to_json_null() {
    assert_eq!(named_path_value(&fake(), "nonesuch"), Value::Null);
}

#[test]
fn fake_reports_light_mode() {
    let dark = FakeSystem {
        known: Vec::new(),
        light: false,
    };
    assert!(fake().light_mode());
    assert!(!dark.light_mode());
}
