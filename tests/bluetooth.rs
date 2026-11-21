#![allow(unused_imports)]

//! Tests for `src/platform/bluetooth.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::core::{GUID, HSTRING};
use windows::Devices::Bluetooth::GenericAttributeProfile::GattCommunicationStatus;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Devices::Radios::{Radio, RadioKind, RadioState};
use windows::Storage::Streams::DataReader;
use winwidget::platform::bluetooth::*;

#[test]
fn addresses_are_grouped_in_pairs() {
    assert_eq!(format_address(0x0011_2233_4455), "00:11:22:33:44:55");
    assert_eq!(format_address(0), "00:00:00:00:00:00");
}

#[test]
fn class_decides_the_kind_first() {
    assert_eq!(kind_of(4, 6, "whatever"), "audio");
    assert_eq!(kind_of(5, 0x40, "whatever"), "keyboard");
    assert_eq!(kind_of(5, 0x80, "whatever"), "mouse");
    assert_eq!(kind_of(2, 3, "whatever"), "phone");
    assert_eq!(kind_of(7, 0, "whatever"), "wearable");
}

#[test]
fn the_name_is_the_fallback() {
    assert_eq!(guess_kind("AirPods Pro"), "audio");
    assert_eq!(guess_kind("MX Keys keyboard"), "keyboard");
    assert_eq!(guess_kind("Logitech mouse"), "mouse");
    assert_eq!(guess_kind("Watch"), "wearable");
    assert_eq!(guess_kind("Mystery"), "other");
}

#[test]
fn the_id_carries_the_address() {
    assert_eq!(
        address_from_id("BluetoothLE#BluetoothLEdc:97:ba:9b:51:2b-13:08:AC:00:04:53"),
        Some(0x1308_ac00_0453)
    );
    assert_eq!(
        address_from_id("Bluetooth#Bluetoothdc:97:ba:9b:51:2b-20:ff:36:ec:49:cf"),
        Some(0x20ff_36ec_49cf)
    );
    assert_eq!(address_from_id("not-a-device"), None);
}

#[test]
fn classic_and_le_endpoints_collapse_into_one_row() {
    let mut classic = Device {
        id: "Bluetooth#classic".into(),
        name: "BT5.2 Mouse".into(),
        address: Some("13:08:AC:00:04:53".into()),
        kind: "other",
        connected: false,
        le: false,
        major: 0,
        minor: 0,
        battery: None,
    };
    let le = Device {
        id: "BluetoothLE#le".into(),
        name: "BT5.2 Mouse".into(),
        address: Some("13:08:AC:00:04:53".into()),
        kind: "mouse",
        connected: true,
        le: true,
        major: 0,
        minor: 0,
        battery: Some(100),
    };
    assert!(classic.same_as(&le));
    classic.absorb(le);
    assert!(classic.connected);
    assert!(classic.le);
    assert_eq!(classic.kind, "mouse");
    assert_eq!(classic.battery, Some(100));
}
