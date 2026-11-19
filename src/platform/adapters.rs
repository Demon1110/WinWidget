//! Windows-backed implementations of the [`core::ports`] contracts.
//!
//! This is the only place where a host capability trait meets Win32. Capability modules
//! under `core/` depend on the trait, never on this file or on `win32` for these calls;
//! the runtime injects [`real_ports`] into every API call. To test a capability, inject a
//! fake `impl ClipboardPort` / `impl SystemPort` instead — no Windows required.

use crate::core::ports::{BluetoothPort, ClipboardPort, Ports, SystemPort};
use crate::platform::win32 as w;

struct WinClipboard;

impl ClipboardPort for WinClipboard {
    fn read_text(&self) -> Option<String> {
        w::clipboard_text()
    }
    fn write_text(&self, text: &str) -> bool {
        w::set_clipboard_text(text)
    }
    fn read_files(&self) -> Vec<String> {
        w::clipboard_files()
    }
    fn write_files(&self, paths: &[String]) -> bool {
        w::set_clipboard_files(paths)
    }
}

struct WinSystem;

impl SystemPort for WinSystem {
    fn known_folder_path(&self, name: &str) -> Option<String> {
        w::known_folder_path(name)
    }
    fn light_mode(&self) -> bool {
        crate::platform::system_light()
    }
}

struct WinBluetooth;

impl BluetoothPort for WinBluetooth {
    fn list(&self, with_battery: bool, refresh: bool) -> serde_json::Value {
        crate::platform::bluetooth::list(with_battery, refresh)
    }
}

static CLIPBOARD: WinClipboard = WinClipboard;
static SYSTEM: WinSystem = WinSystem;
static BLUETOOTH: WinBluetooth = WinBluetooth;

static REAL_PORTS: Ports = Ports {
    clipboard: &CLIPBOARD,
    system: &SYSTEM,
    bluetooth: &BLUETOOTH,
};

/// The real capability set, injected into API calls by the runtime. Keeping this a
/// function leaves room to pick a different set per widget without touching callers.
pub fn real_ports() -> &'static Ports {
    &REAL_PORTS
}
