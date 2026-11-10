//! WinWidget as a library: the desktop-widget engine, split into layers that a thin binary
//! (`main.rs`) drives and that other front ends can reuse.
//!
//! Layers, from the bottom up — each may only depend on the ones above it in this list:
//!
//! * [`core`] — paths, config, storage, logging, text, network and image helpers.
//! * [`platform`] — the Windows facts and capabilities behind that layer (win32, tray, tray,
//!   audio, power, shell, media, system info, guides).
//! * [`model`] — how widgets, themes, categories, permissions and icon assets are described.
//! * [`market`] — packages, the remote market client and self-update.
//! * [`runtime`] — the only layer that owns windows or drives an event loop.
//! * [`ui`] — the surfaces a user acts through: context menus, the control center, the local
//!   server that hands pages to the WebViews.
//!
//! Nothing here knows about `main.rs`; the binary reads its config, creates the event loop and
//! forwards events into [`runtime::app::App`].

pub mod core;
pub mod market;
pub mod model;
pub mod platform;
pub mod runtime;
pub mod ui;

/// Version reported by `--version` and by the control center.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
