//! Bluetooth devices Windows already has paired, with the class Windows reports (audio, phone,
//! keyboard …) and the battery level when the device exposes the standard GATT battery service.
//!
//! WinRT completions have to be pumped: every call here runs on a worker thread that entered an
//! MTA apartment (`co_initialize_mta`), never on the event loop's STA.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::core::{HSTRING, GUID};
use windows::Devices::Bluetooth::GenericAttributeProfile::GattCommunicationStatus;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Devices::Radios::{Radio, RadioKind, RadioState};
use windows::Storage::Streams::DataReader;

/// Bluetooth SIG's Battery Service (0x180F) and Battery Level characteristic (0x2A19).
const BATTERY_SERVICE: GUID = GUID::from_u128(0x0000_180f_0000_1000_8000_0080_5f9b_34fb);
const BATTERY_LEVEL: GUID = GUID::from_u128(0x0000_2a19_0000_1000_8000_0080_5f9b_34fb);

/// The whole list is reused for a few seconds: a card polling every 30 s still sees fresh data,
/// two cards asking at once do not enumerate twice.
const LIST_TTL: Duration = Duration::from_secs(12);
/// GATT reads take a second or more on some earbuds; one reading a minute is plenty.
const BATTERY_TTL: Duration = Duration::from_secs(60);

/// Cached battery readings: device address -> (level, time it was taken).
type BatteryCache = HashMap<String, (Option<u8>, Instant)>;

static LIST: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
static BATTERY: Mutex<Option<BatteryCache>> = Mutex::new(None);
static BUSY: Mutex<()> = Mutex::new(());

/// Paired devices, newest state first. `refresh` ignores the short list cache; `battery` skips the
/// (slow) GATT reads when the caller only wants names.
pub fn list(with_battery: bool, refresh: bool) -> Value {
    if !refresh {
        if let Ok(guard) = LIST.lock() {
            if let Some((at, value)) = guard.as_ref() {
                if at.elapsed() < LIST_TTL {
                    return value.clone();
                }
            }
        }
    }
    // Two cards asking together should not open GATT sessions at the same time.
    let _busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let value = build(with_battery);
    if let Ok(mut guard) = LIST.lock() {
        *guard = Some((Instant::now(), value.clone()));
    }
    value
}

fn build(with_battery: bool) -> Value {
    if !crate::platform::win32::co_initialize_mta() {
        crate::core::logging::warn("Bluetooth: worker could not enter an MTA apartment");
    }
    let (supported, adapter) = radio_state();
    let mut devices: Vec<Device> = Vec::new();
    let mut error: Option<String> = None;
    match enumerate() {
        Ok(found) => {
            for (info, le) in &found {
                let incoming = describe(info, *le, with_battery);
                if let Some(existing) = devices.iter_mut().find(|d| d.same_as(&incoming)) {
                    existing.absorb(incoming);
                } else {
                    devices.push(incoming);
                }
            }
        }
        Err(message) => {
            crate::core::logging::warn(&format!("Bluetooth: {message}"));
            error = Some(message);
        }
    }
    // Connected first, then by name, so the card's list is stable before its own sort runs.
    devices.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let list: Vec<Value> = devices.iter().map(Device::json).collect();
    json!({
        "supported": supported,
        "adapter": adapter,
        "devices": list,
        "updated": now(),
        "error": error,
    })
}

/// Windows keeps classic Bluetooth and Bluetooth LE in separate AEP protocols, each with its own
/// pairing selector. Querying only the classic one (the old behaviour) silently drops LE mice,
/// keyboards and earbuds that Windows Settings still lists as connected.
fn enumerate() -> Result<Vec<(DeviceInformation, bool)>, String> {
    let queries = [
        (BluetoothDevice::GetDeviceSelectorFromPairingState(true), false),
        (BluetoothLEDevice::GetDeviceSelectorFromPairingState(true), true),
    ];
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut failures: Vec<String> = Vec::new();
    for (selector, le) in queries {
        let selector = match selector {
            Ok(selector) => selector,
            Err(e) => {
                failures.push(format!("bluetooth selector: {e}"));
                continue;
            }
        };
        let operation = match DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            Ok(operation) => operation,
            Err(e) => {
                failures.push(format!("bluetooth query: {e}"));
                continue;
            }
        };
        let found = match operation.get() {
            Ok(found) => found,
            Err(e) => {
                failures.push(format!("bluetooth query: {e}"));
                continue;
            }
        };
        let size = match found.Size() {
            Ok(size) => size,
            Err(e) => {
                failures.push(format!("bluetooth query: {e}"));
                continue;
            }
        };
        for i in 0..size {
            let Ok(info) = found.GetAt(i) else { continue };
            let key = info.Id().map(|id| id.to_string()).unwrap_or_default();
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            out.push((info, le));
        }
    }
    if out.is_empty() && !failures.is_empty() {
        return Err(failures.join(" · "));
    }
    for failure in &failures {
        crate::core::logging::warn(&format!("Bluetooth: {failure}"));
    }
    Ok(out)
}

#[derive(Clone, Debug)]
struct Device {
    id: String,
    name: String,
    address: Option<String>,
    kind: &'static str,
    connected: bool,
    le: bool,
    major: i32,
    minor: i32,
    battery: Option<u8>,
}

impl Device {
    /// Classic and LE endpoints of one physical device share a Bluetooth address; keep one row.
    fn same_as(&self, other: &Device) -> bool {
        match (&self.address, &other.address) {
            (Some(a), Some(b)) => a == b,
            _ => self.id == other.id,
        }
    }

    fn absorb(&mut self, other: Device) {
        if self.name.is_empty() {
            self.name = other.name;
        }
        if self.address.is_none() {
            self.address = other.address;
        }
        if other.connected && !self.connected {
            self.connected = true;
            self.id = other.id;
        }
        self.le |= other.le;
        if self.kind == "other" && other.kind != "other" {
            self.kind = other.kind;
        }
        if self.major == 0 && other.major != 0 {
            self.major = other.major;
            self.minor = other.minor;
        }
        if self.battery.is_none() {
            self.battery = other.battery;
        }
    }

    fn json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "address": self.address,
            "kind": self.kind,
            "connected": self.connected,
            "paired": true,
            "le": self.le,
            "major": self.major,
            "minor": self.minor,
            "battery": self.battery,
        })
    }
}

fn describe(info: &DeviceInformation, le: bool, with_battery: bool) -> Device {
    let id_text = info.Id().map(|id| id.to_string()).unwrap_or_default();
    let name = info
        .Name()
        .map(|n| n.to_string())
        .unwrap_or_default()
        .trim()
        .to_string();
    let id = HSTRING::from(id_text.as_str());
    let (connected, address, major, minor) = if le {
        let device = BluetoothLEDevice::FromIdAsync(&id)
            .ok()
            .and_then(|operation| operation.get().ok());
        let connected = device
            .as_ref()
            .and_then(|d| d.ConnectionStatus().ok())
            .map(|s| s.0 == BluetoothConnectionStatus::Connected.0)
            .unwrap_or(false);
        let address = device
            .as_ref()
            .and_then(|d| d.BluetoothAddress().ok())
            .map(format_address);
        (connected, address, 0, 0)
    } else {
        let device = BluetoothDevice::FromIdAsync(&id)
            .ok()
            .and_then(|operation| operation.get().ok());
        let connected = device
            .as_ref()
            .and_then(|d| d.ConnectionStatus().ok())
            .map(|s| s.0 == BluetoothConnectionStatus::Connected.0)
            .unwrap_or(false);
        let (major, minor) = device
            .as_ref()
            .and_then(|d| d.ClassOfDevice().ok())
            .map(|class| {
                (
                    class.MajorClass().map(|m| m.0).unwrap_or(0),
                    class.MinorClass().map(|m| m.0).unwrap_or(0),
                )
            })
            .unwrap_or((0, 0));
        let address = device
            .as_ref()
            .and_then(|d| d.BluetoothAddress().ok())
            .map(format_address);
        (connected, address, major, minor)
    };
    let address = address.or_else(|| address_from_id(&id_text).map(format_address));
    let kind = kind_of(major, minor, &name);
    let battery = if with_battery && connected && le {
        battery_level(&id_text)
    } else {
        None
    };
    Device {
        id: id_text,
        name,
        address,
        kind,
        connected,
        le,
        major,
        minor,
        battery,
    }
}

/// AA:BB:CC:DD:EE:FF from the 48-bit address Windows reports.
fn format_address(address: u64) -> String {
    let hex = format!("{address:012X}");
    hex.as_bytes()
        .chunks(2)
        .map(|pair| String::from_utf8_lossy(pair).to_string())
        .collect::<Vec<_>>()
        .join(":")
}

/// The AEP id ends in the device's address (`…-13:08:AC:00:04:53`), which still identifies the
/// device when `FromIdAsync` refuses because it is out of range.
fn address_from_id(id: &str) -> Option<u64> {
    let tail = id.rsplit('-').next()?;
    let hex: String = tail.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return None;
    }
    u64::from_str_radix(&hex, 16).ok()
}

fn kind_of(major: i32, minor: i32, name: &str) -> &'static str {
    match major {
        1 => "computer",
        2 => "phone",
        3 => "network",
        4 => "audio",
        5 => match minor {
            0x40 => "keyboard",
            0x80 => "mouse",
            0xc0 => "keyboard",
            _ => "peripheral",
        },
        6 => "imaging",
        7 => "wearable",
        8 => "toy",
        9 => "health",
        _ => guess_kind(name),
    }
}

/// Some devices report no class at all (especially BLE); the name is the only hint left.
fn guess_kind(name: &str) -> &'static str {
    let name = name.to_lowercase();
    const AUDIO: [&str; 8] = [
        "airpod", "headphone", "headset", "earbud", "buds", "speaker", "sound", "audio",
    ];
    const WEARABLE: [&str; 4] = ["watch", "band", "fit", "ring"];
    if AUDIO.iter().any(|k| name.contains(k)) {
        "audio"
    } else if name.contains("keyboard") {
        "keyboard"
    } else if name.contains("mouse") || name.contains("trackpad") {
        "mouse"
    } else if name.contains("phone") || name.contains("iphone") {
        "phone"
    } else if WEARABLE.iter().any(|k| name.contains(k)) {
        "wearable"
    } else {
        "other"
    }
}

fn battery_level(id: &str) -> Option<u8> {
    if let Ok(map) = BATTERY.lock() {
        if let Some((level, at)) = map.as_ref().and_then(|m| m.get(id)) {
            if at.elapsed() < BATTERY_TTL {
                return *level;
            }
        }
    }
    let level = read_battery(id);
    if let Ok(mut guard) = BATTERY.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(id.to_string(), (level, Instant::now()));
    }
    level
}

fn read_battery(id: &str) -> Option<u8> {
    let device = BluetoothLEDevice::FromIdAsync(&HSTRING::from(id))
        .ok()?
        .get()
        .ok()?;
    let services = device.GetGattServicesAsync().ok()?.get().ok()?;
    if services.Status().ok()?.0 != GattCommunicationStatus::Success.0 {
        return None;
    }
    let list = services.Services().ok()?;
    for i in 0..list.Size().ok()? {
        let service = list.GetAt(i).ok()?;
        if service.Uuid().ok()? != BATTERY_SERVICE {
            continue;
        }
        let chars = service.GetCharacteristicsAsync().ok()?.get().ok()?;
        if chars.Status().ok()?.0 != GattCommunicationStatus::Success.0 {
            continue;
        }
        let list = chars.Characteristics().ok()?;
        for j in 0..list.Size().ok()? {
            let characteristic = list.GetAt(j).ok()?;
            if characteristic.Uuid().ok()? != BATTERY_LEVEL {
                continue;
            }
            let read = characteristic.ReadValueAsync().ok()?.get().ok()?;
            if read.Status().ok()?.0 != GattCommunicationStatus::Success.0 {
                continue;
            }
            let value = DataReader::FromBuffer(&read.Value().ok()?).ok()?;
            let level = value.ReadByte().ok()?;
            if level <= 100 {
                return Some(level);
            }
        }
    }
    None
}

/// Is there a Bluetooth radio, and is it on? Drives the card's empty state.
fn radio_state() -> (bool, String) {
    let radios = match Radio::GetRadiosAsync().ok().and_then(|operation| operation.get().ok()) {
        Some(list) => list,
        None => return (false, "unknown".into()),
    };
    let size = radios.Size().unwrap_or(0);
    for i in 0..size {
        let Ok(radio) = radios.GetAt(i) else { continue };
        let is_bluetooth = radio
            .Kind()
            .map(|kind| kind.0 == RadioKind::Bluetooth.0)
            .unwrap_or(false);
        if !is_bluetooth {
            continue;
        }
        let state = radio.State().map(|s| s.0).unwrap_or(-1);
        let label = if state == RadioState::On.0 {
            "on"
        } else if state == RadioState::Off.0 {
            "off"
        } else if state == RadioState::Disabled.0 {
            "disabled"
        } else {
            "unknown"
        };
        return (true, label.into());
    }
    (false, "missing".into())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
