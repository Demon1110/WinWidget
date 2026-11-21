#![allow(unused_imports)]

//! Tests for `src/core/schedule.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Map, Value, Value::Null};
use winwidget::core::api::{Ctx, Reply};
use winwidget::core::ports::ScheduleHost;
use winwidget::core::schedule::*;
use winwidget::core::util::{jstr, now_ms, BridgeError, BridgeResult};

fn parts(hour: u32, minute: u32) -> LocalParts {
    LocalParts {
        minute,
        hour,
        day: 1,
        month: 1,
        weekday: 0,
        minute_start: 0,
    }
}

#[test]
fn cron_fields_match_the_way_cron_does() {
    assert!(field("*/15", 0, 0, 59));
    assert!(field("*/15", 45, 0, 59));
    assert!(!field("*/15", 7, 0, 59));
    assert!(field("9-18", 12, 0, 23));
    assert!(!field("9-18", 20, 0, 23));
    assert!(field("1,15,30", 15, 0, 59));
    assert!(field("10-20/2", 14, 0, 59));
    assert!(!field("10-20/2", 15, 0, 59));
}

#[test]
fn a_whole_expression_matches() {
    let fields = parse_cron("0 9-18 * * *").unwrap();
    assert!(matches(&fields, &parts(9, 0)));
    assert!(matches(&fields, &parts(18, 0)));
    assert!(!matches(&fields, &parts(9, 1)));
    assert!(!matches(&fields, &parts(8, 0)));
}

#[test]
fn a_typo_is_rejected() {
    assert!(parse_cron("0 9 * *").is_err());
    assert!(parse_cron("0 25 * * *").is_err());
    assert!(parse_cron("0 9 * * *").is_ok());
}

#[test]
fn a_due_one_shot_fires_once() {
    let trigger = json!(minute_of(1, 9, 0));
    assert!(is_due(&trigger, &parts(9, 0), None, minute_of(1, 9, 0)));
    // A minute missed (the machine slept, the app had just started) is caught up once rather
    // than dropped.
    assert!(is_due(&trigger, &parts(9, 1), None, minute_of(1, 9, 1)));
    assert!(!is_due(
        &trigger,
        &parts(9, 0),
        Some(minute_of(1, 9, 0)),
        minute_of(1, 9, 0)
    ));
}
