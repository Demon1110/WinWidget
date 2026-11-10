//! Runtime: the card windows, the page bridge and the state that keeps them alive.
//!
//! This is the only place allowed to own windows (`window`, `snap`, `app`) or to translate
//! between the host and a web page (`bridge`). It sits above `core`, `platform`, `model` and
//! `market`, and is driven by `ui`.

pub mod app;
pub mod bridge;
pub mod monitor;
pub mod shim;
pub mod snap;
pub mod window;
