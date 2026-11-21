#![allow(unused_imports)]

//! Tests for `src/ui/control.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use winwidget::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use winwidget::runtime::app::{App, CONTROL_WIN};
use winwidget::runtime::bridge::Reply;
use winwidget::ui::control::*;

#[test]
fn registry_covers_every_method() {
    let r = registry();
    // 57 methods + 1 legacy alias.
    assert_eq!(r.len(), 58);
    // The old and new spellings of the auto-update toggle share one handler.
    assert_eq!(r["app.updateAuto"] as usize, r["app.autoUpdate"] as usize);
    for name in [
        "app.editMode",
        "app.guide",
        "app.hotkey",
        "app.hotkeysPause",
        "app.language",
        "app.uiTheme",
        "app.lockAll",
        "app.openFolder",
        "app.rescan",
        "app.restart",
        "app.setDataDir",
        "app.resetDataDir",
        "app.reveal",
        "app.updateCheck",
        "app.updateInstall",
        "app.updateCancel",
        "app.updatePage",
        "app.updateAuto",
        "app.updateUrl",
        "app.autoUpdate",
        "app.autostart",
        "app.lowResource",
        "app.developer",
        "app.hideAll",
        "app.pauseFullscreen",
        "app.fileAssociation",
        "app.close",
        "fonts.list",
        "instance.appearance",
        "instance.css",
        "instance.locked",
        "instance.layer",
        "instance.theme",
        "instance.setting",
        "instance.size",
        "instance.reload",
        "instance.devtools",
        "instance.identify",
        "instance.duplicate",
        "instance.remove",
        "instance.clearAll",
        "instance.pickFolder",
        "widget.add",
        "widget.grant",
        "widget.openFolder",
        "widget.export",
        "widget.uninstall",
        "widget.create",
        "theme.global",
        "theme.override",
        "theme.reset",
        "package.import",
        "package.cancel",
        "package.install",
        "package.export",
        "market.list",
        "market.install",
        "market.open",
    ] {
        assert!(r.contains_key(name), "missing method {name}");
    }
}

#[test]
fn unknown_method_is_rejected() {
    assert!(handler_for("app.noSuchMethod").is_err());
    assert!(handler_for("").is_err());
}
