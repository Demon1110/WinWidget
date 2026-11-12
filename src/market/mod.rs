//! Distribution: reading and writing widget packages, talking to a market and updating the app.
//!
//! Installs, exports and upgrades touch the user's disk, so every entry point here is
//! expected to be idempotent and to report a clear error instead of panicking.

pub mod client;
pub mod packages;
pub mod updater;
pub mod upx;
