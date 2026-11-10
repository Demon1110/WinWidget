//! Model layer: how a widget, a theme and an installed package are described on disk.
//!
//! These modules parse and validate data (manifests, catalogs, themes, permissions) and may
//! reach into `core`; they never open a window or talk to a web page.

pub mod appearance;
pub mod catalog;
pub mod categories;
pub mod icons;
pub mod manifest;
pub mod permissions;
pub mod themes;
