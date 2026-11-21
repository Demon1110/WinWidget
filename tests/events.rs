#![allow(unused_imports)]

//! Tests for `src/core/events.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::Value;
use winwidget::core::events::*;
use winwidget::core::ports::EventsHost;
use winwidget::core::util::jstr;

use std::cell::Cell;

struct FakeEventsHost {
    pending: bool,
    refreshes: Cell<u32>,
}

impl EventsHost for FakeEventsHost {
    fn has_pending_permissions(&self, _instance: &str) -> bool {
        self.pending
    }
    fn refresh_control_state(&mut self) {
        self.refreshes.set(self.refreshes.get() + 1);
    }
}

#[test]
fn ready_refreshes_when_permissions_are_pending() {
    let mut host = FakeEventsHost {
        pending: true,
        refreshes: Cell::new(0),
    };
    notify(&mut host, "card-1", "ready", &Value::Null);
    assert_eq!(host.refreshes.get(), 1);
}

#[test]
fn ready_does_not_refresh_when_nothing_is_pending() {
    let mut host = FakeEventsHost {
        pending: false,
        refreshes: Cell::new(0),
    };
    notify(&mut host, "card-1", "ready", &Value::Null);
    assert_eq!(host.refreshes.get(), 0);
}

#[test]
fn unknown_notification_is_a_no_op_on_the_host() {
    let mut host = FakeEventsHost {
        pending: true,
        refreshes: Cell::new(0),
    };
    notify(&mut host, "card-1", "something-else", &Value::Null);
    assert_eq!(host.refreshes.get(), 0);
}
