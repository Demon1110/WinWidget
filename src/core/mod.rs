//! Foundation: everything the rest of the crate may rely on, with no knowledge of widgets,
//! windows or the shell.
//!
//! Keep this layer dependency-free (only `platform` may be reached for OS facts such as the
//! data directory). Anything that knows about a widget, a theme or a window belongs elsewhere.

pub mod config;
pub mod img;
pub mod logging;
pub mod net;
pub mod paths;
pub mod storage;
pub mod text;
pub mod util;
