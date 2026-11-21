#![allow(unused_imports)]

//! Tests for `src/platform/files.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use winwidget::platform::files::*;


#[test]
fn every_entry_gets_the_route_the_page_loads_it_from() {
    let mut listing = json!({
        "files": [{ "path": r"C:\Pics\a b\today.jpg", "name": "today.jpg" }]
    });
    with_urls(&mut listing, "inst", "folder", Path::new(r"C:\Pics"));
    assert_eq!(
        listing["files"][0]["url"],
        "/__files/inst/folder/a%20b/today.jpg"
    );
}
