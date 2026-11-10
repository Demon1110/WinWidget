//! User interface surfaces: the context menu, the control center and the loopback server that
//! serves every page to the WebViews.
//!
//! These modules are the entry points a user action arrives through; they read and mutate the
//! `runtime` state but do not implement it.

pub mod control;
pub mod menus;
pub mod server;
