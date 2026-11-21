//! Ports — the contracts the host offers to the capability modules.
//!
//! This is the bottom of the dependency graph on purpose. A capability module
//! (`core::clipboard`, `core::system`, …) calls a trait defined here; the Windows-backed
//! implementation lives in `platform::adapters`; the runtime injects one into every API
//! call through [`crate::core::api::Ctx`]. Neither side needs to know the other, so a
//! capability can be tested by injecting a fake and no real clipboard, window or registry
//! is ever touched.
//!
//! Adding a host capability used to mean reaching from `core` straight into
//! `platform::win32` (one of the reverse dependencies the arch guard freezes). New code
//! should add a trait here and an adapter under `platform/` instead.

/// Text and files on the system clipboard — the parts of `core::clipboard` that talk to
/// the OS. The history layer on top of these stays in the capability module.
pub trait ClipboardPort: Send + Sync {
    fn read_text(&self) -> Option<String>;
    fn write_text(&self, text: &str) -> bool;
    fn read_files(&self) -> Vec<String>;
    fn write_files(&self, paths: &[String]) -> bool;
}

/// Machine facts the widget API exposes synchronously (no subscription needed).
pub trait SystemPort: Send + Sync {
    /// A uTools `getPath` name → absolute path, e.g. `desktop`, `home`, `temp`.
    fn known_folder_path(&self, name: &str) -> Option<String>;
    /// Windows' "apps use light theme" switch.
    fn light_mode(&self) -> bool;
    /// Flips Windows' own light/dark mode (app-mode and system-mode switches together).
    fn set_light_mode(&self, light: bool) -> Result<(), String>;
}

/// Paired Bluetooth devices and their reported battery levels.
///
/// Enumeration and GATT reads block, so the adapter does the work on the caller's worker thread;
/// the trait is `Send + Sync` like the other ports so the `'static` reference can be moved there.
pub trait BluetoothPort: Send + Sync {
    /// `with_battery` enables the slow GATT reads; `refresh` bypasses the short device-list cache.
    /// Returns the same JSON shape the page expects.
    fn list(&self, with_battery: bool, refresh: bool) -> serde_json::Value;
}

/// Sending a bridge answer back to a page. The runtime implements this for `App`, so a
/// transport/capability only needs `&dyn Host` rather than a mutable handle to the whole
/// application. Kept as the contract for the next refactoring step; [`Ports`] only carries
/// the capabilities already migrated.
#[allow(dead_code)]
pub trait Host: Send + Sync {
    fn send_to(&self, target: &str, body: &str);
}

/// The narrow slice of the host that the `events` category needs. Expressed in domain terms
/// ("does this widget have pending permissions?", "refresh the control center") so the core
/// module never has to name `runtime::app::App`, `AppConfig` or `Manifest`. Every method is
/// object-safe and returns owned values; the `App` impl keeps the detailed logic.
pub trait EventsHost {
    /// True when this widget declares permissions the user has not allowed yet.
    fn has_pending_permissions(&self, instance: &str) -> bool;
    /// Bring the control center's state up to date after a page announced itself ready.
    fn refresh_control_state(&mut self);
}

/// The narrow slice of the host that the `schedule` clock needs: find the live instances of a
/// widget and deliver an event to one of them. Both stay object-safe (owned returns, no
/// borrowed `AppConfig` leaking into core).
pub trait ScheduleHost {
    /// Instance ids currently mounted for a widget id (case-insensitive match, as the old
    /// `app.cfg().instances` scan did).
    fn instances_of_widget(&self, widget: &str) -> Vec<String>;
    /// Send a named event with a JSON payload to one instance.
    fn event_to(&self, instance: &str, ev: &str, data: serde_json::Value);
}

/// The capabilities injected into a single API call. Static references keep this a
/// zero-allocation hop: the concrete adapters are stateless singletons in `platform`.
pub struct Ports {
    pub clipboard: &'static dyn ClipboardPort,
    pub system: &'static dyn SystemPort,
    pub bluetooth: &'static dyn BluetoothPort,
}

/// A do-nothing set for callers that have no host behind them (used by unit tests that
/// exercise only parameter handling, and as the safe default before an injection point
/// is wired up).
pub struct NullPorts;

impl ClipboardPort for NullPorts {
    fn read_text(&self) -> Option<String> {
        None
    }
    fn write_text(&self, _text: &str) -> bool {
        false
    }
    fn read_files(&self) -> Vec<String> {
        Vec::new()
    }
    fn write_files(&self, _paths: &[String]) -> bool {
        false
    }
}

impl SystemPort for NullPorts {
    fn known_folder_path(&self, _name: &str) -> Option<String> {
        None
    }
    fn light_mode(&self) -> bool {
        true
    }
    fn set_light_mode(&self, _light: bool) -> Result<(), String> {
        Err("system theme is not available in this host".into())
    }
}

impl BluetoothPort for NullPorts {
    fn list(&self, _with_battery: bool, _refresh: bool) -> serde_json::Value {
        // Keep the same object shape as the real adapter. Widget code reads `result.supported`
        // and `result.devices`; returning `[]` would leave both undefined and look like a
        // supported adapter with no fields instead of an unsupported host.
        serde_json::json!({
            "supported": false,
            "adapter": "missing",
            "devices": [],
            "updated": 0,
            "error": null,
        })
    }
}
