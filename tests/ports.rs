#![allow(unused_imports)]

//! Tests for `src/core/ports.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use winwidget::core::ports::*;

struct FakeBluetooth;

impl BluetoothPort for FakeBluetooth {
    fn list(&self, with_battery: bool, refresh: bool) -> serde_json::Value {
        serde_json::json!({ "battery": with_battery, "refresh": refresh })
    }
}

/// `bluetooth.list` runs the port on a worker thread. The field in `Ports` is a `&'static dyn`,
/// so it must be movable into a `'static` closure — that is the whole reason this capability
/// is a port rather than a direct `core -> platform` call.
#[test]
fn bluetooth_port_is_movable_into_worker_thread() {
    static FAKE: FakeBluetooth = FakeBluetooth;
    let port: &'static dyn BluetoothPort = &FAKE;
    let handle = std::thread::spawn(move || port.list(true, false));
    let value = handle.join().unwrap();
    assert_eq!(
        value,
        serde_json::json!({ "battery": true, "refresh": false })
    );
}

#[test]
fn null_bluetooth_port_returns_unsupported_snapshot() {
    let value = NullPorts.list(false, true);
    assert_eq!(
        value,
        serde_json::json!({
            "supported": false,
            "adapter": "missing",
            "devices": [],
            "updated": 0,
            "error": null,
        })
    );
}
