//! Foundation: everything the rest of the crate may rely on.
//!
//! Two kinds of module live here: plumbing (assets, config, paths, storage, net, text) and the
//! **uTools API categories** — one file per category, so the compatibility surface has a home of
//! its own instead of being spread over the runtime. `window` is the first of them; system,
//! clipboard, screen, db and the rest follow the same shape.

pub mod assets;
pub mod config;
pub mod img;
pub mod logging;
pub mod net;
pub mod paths;
pub mod storage;
pub mod text;
pub mod util;
pub mod window;
