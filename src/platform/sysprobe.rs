//! The narrow system reads behind C-class widgets: the process table, the port table, the saved
//! WiFi profiles, and the one system write we allow (starting the screensaver).
//!
//! Each of these is a purpose-built call rather than a `system.exec`: nothing here takes a
//! command line, a path or a shell string from the page, so there is no way to smuggle an
//! argument into `ipconfig`, `netsh` or `taskkill`. The Win32 entry points are declared here
//! beside the rest of the hand-written Win32 layer.

use serde_json::{json, Value};
use std::ffi::c_void;

// ── processes ────────────────────────────────────────────────────────────────

/// The process table, already sorted. `expose_path` decides whether `exe` may leave the host;
/// it is true only when the caller also holds `shell.info`, so a widget cannot read every
/// program path on the machine just by listing processes.
pub fn processes(sort: &str, limit: usize, expose_path: bool) -> Value {
    use sysinfo::{ProcessesToUpdate, System};
    let mut sys = match System::new() {
        Ok(s) => s,
        Err(_) => return json!({ "total": 0, "items": [] }),
    };
    sys.refresh_processes(ProcessesToUpdate::All, true);
    // CPU percentages need two readings a minimum interval apart. This runs on a worker thread,
    // so the sleep costs nobody a frame.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut items: Vec<Value> = Vec::new();
    for (pid, p) in sys.processes() {
        let mut row = serde_json::Map::new();
        row.insert("pid".into(), json!(pid.as_u32()));
        row.insert("name".into(), json!(p.name().to_string_lossy()));
        row.insert("cpu".into(), json!(round1(p.cpu_usage() as f64)));
        row.insert("memory".into(), json!(p.memory()));
        row.insert("started".into(), json!(p.start_time()));
        if expose_path {
            if let Some(exe) = p.exe() {
                row.insert("path".into(), json!(exe.to_string_lossy()));
            }
        }
        items.push(Value::Object(row));
    }

    let key = |v: &Value, k: &str| -> f64 {
        v.get(k)
            .and_then(Value::as_f64)
            .or_else(|| v.get(k).and_then(Value::as_i64).map(|n| n as f64))
            .unwrap_or(0.0)
    };
    match sort {
        "name" => items.sort_by(|a, b| {
            let an = a.get("name").and_then(Value::as_str).unwrap_or("");
            let bn = b.get("name").and_then(Value::as_str).unwrap_or("");
            an.to_lowercase().cmp(&bn.to_lowercase())
        }),
        "memory" => items.sort_by(|a, b| key(b, "memory").total_cmp(&key(a, "memory"))),
        _ => items.sort_by(|a, b| key(b, "cpu").total_cmp(&key(a, "cpu"))),
    }
    let total = items.len();
    items.truncate(limit);
    json!({ "total": total, "items": items })
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

// ── ports ────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Tcp4Row {
    state: u32,
    local_addr: u32,
    local_port: u32,
    remote_addr: u32,
    remote_port: u32,
    pid: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Udp4Row {
    local_addr: u32,
    local_port: u32,
    pid: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Tcp6Row {
    local_addr: [u8; 16],
    local_scope: u32,
    local_port: u32,
    remote_addr: [u8; 16],
    remote_scope: u32,
    remote_port: u32,
    state: u32,
    pid: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Udp6Row {
    local_addr: [u8; 16],
    local_scope: u32,
    local_port: u32,
    pid: u32,
}

#[link(name = "iphlpapi")]
extern "system" {
    fn GetExtendedTcpTable(
        table: *mut c_void,
        size: *mut u32,
        order: i32,
        af: u32,
        class: u32,
        reserved: u32,
    ) -> u32;
    fn GetExtendedUdpTable(
        table: *mut c_void,
        size: *mut u32,
        order: i32,
        af: u32,
        class: u32,
        reserved: u32,
    ) -> u32;
}

const AF_INET: u32 = 2;
const AF_INET6: u32 = 23;
const TCP_TABLE_OWNER_PID_ALL: u32 = 5;
const UDP_TABLE_OWNER_PID: u32 = 1;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

/// Runs one `GetExtended*Table` call and returns the row count and the raw buffer.
fn table_bytes(
    tcp: bool,
    af: u32,
    class: u32,
) -> Option<(usize, Vec<u8>)> {
    let mut size: u32 = 0;
    let mut data: Vec<u8>;
    unsafe {
        let first = if tcp {
            GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, af, class, 0)
        } else {
            GetExtendedUdpTable(std::ptr::null_mut(), &mut size, 0, af, class, 0)
        };
        if first != ERROR_INSUFFICIENT_BUFFER || size == 0 {
            return None;
        }
        data = vec![0u8; size as usize];
        let second = if tcp {
            GetExtendedTcpTable(data.as_mut_ptr() as *mut c_void, &mut size, 0, af, class, 0)
        } else {
            GetExtendedUdpTable(data.as_mut_ptr() as *mut c_void, &mut size, 0, af, class, 0)
        };
        if second != 0 {
            return None;
        }
        let count = *(data.as_ptr() as *const u32) as usize;
        Some((count, data))
    }
}

fn copies<T: Copy>(data: &[u8], count: usize, offset: usize) -> Vec<T> {
    let mut out = Vec::with_capacity(count);
    let base = data.as_ptr() as usize + offset;
    for i in 0..count {
        let at = base + i * std::mem::size_of::<T>();
        out.push(unsafe { *(at as *const T) });
    }
    out
}

fn v4(addr: u32) -> String {
    let b = addr.to_le_bytes();
    format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3])
}

/// Port numbers come back in network byte order, so the two halves have to be swapped.
fn port(v: u32) -> u32 {
    ((v & 0xFF) << 8) | ((v >> 8) & 0xFF)
}

fn v6(addr: &[u8; 16]) -> String {
    let mut bytes = [0u8; 16];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = addr.get(i).copied().unwrap_or(0);
    }
    std::net::Ipv6Addr::from(bytes).to_string()
}

fn tcp_state(state: u32) -> &'static str {
    match state {
        1 => "closed",
        2 => "listen",
        3 => "syn_sent",
        4 => "syn_recv",
        5 => "established",
        6 => "fin_wait1",
        7 => "fin_wait2",
        8 => "close_wait",
        9 => "closing",
        10 => "last_ack",
        11 => "time_wait",
        _ => "delete",
    }
}

/// The listening sockets, and optionally every established one. Only table reads: nothing here
/// can close a connection, which is why this stays under `system.read`.
pub fn ports(protocol: &str, listening: bool, include_remote: bool) -> Value {
    let want_tcp = protocol != "udp";
    let want_udp = protocol != "tcp";
    let mut items: Vec<Value> = Vec::new();

    let mut push = |proto: &str, local: String, lport: u32, remote: String, rport: u32, state: &str, pid: u32| {
        if listening && state != "listen" {
            return;
        }
        if !listening && state == "listen" && !include_remote {
            // With `listening: false` the caller asked for "who is connected where"; a listener
            // has no peer, so it only shows up when remote detail was asked for.
            return;
        }
        let mut row = serde_json::Map::new();
        row.insert("proto".into(), json!(proto));
        row.insert("local".into(), json!(local));
        row.insert("localPort".into(), json!(lport));
        row.insert("remote".into(), json!(remote));
        row.insert("remotePort".into(), json!(rport));
        row.insert("state".into(), json!(state));
        row.insert("pid".into(), json!(pid));
        items.push(Value::Object(row));
    };

    if want_tcp {
        if let Some((count, data)) = table_bytes(true, AF_INET, TCP_TABLE_OWNER_PID_ALL) {
            for row in copies::<Tcp4Row>(&data, count, 4) {
                push(
                    "tcp",
                    v4(row.local_addr),
                    port(row.local_port),
                    v4(row.remote_addr),
                    port(row.remote_port),
                    tcp_state(row.state),
                    row.pid,
                );
            }
        }
        if let Some((count, data)) = table_bytes(true, AF_INET6, TCP_TABLE_OWNER_PID_ALL) {
            for row in copies::<Tcp6Row>(&data, count, 4) {
                push(
                    "tcp6",
                    v6(&row.local_addr),
                    port(row.local_port),
                    v6(&row.remote_addr),
                    port(row.remote_port),
                    tcp_state(row.state),
                    row.pid,
                );
            }
        }
    }
    if want_udp {
        if let Some((count, data)) = table_bytes(false, AF_INET, UDP_TABLE_OWNER_PID) {
            for row in copies::<Udp4Row>(&data, count, 4) {
                push("udp", v4(row.local_addr), port(row.local_port), String::new(), 0, "listen", row.pid);
            }
        }
        if let Some((count, data)) = table_bytes(false, AF_INET6, UDP_TABLE_OWNER_PID) {
            for row in copies::<Udp6Row>(&data, count, 4) {
                push("udp6", v6(&row.local_addr), port(row.local_port), String::new(), 0, "listen", row.pid);
            }
        }
    }

    drop(push);
    items.sort_by(|a, b| {
        let ap = a.get("localPort").and_then(Value::as_u64).unwrap_or(0);
        let bp = b.get("localPort").and_then(Value::as_u64).unwrap_or(0);
        ap.cmp(&bp)
    });
    json!({ "items": items })
}

// ── WiFi profiles ────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WlanInterfaceInfo {
    guid: Guid,
    description: [u16; 256],
    state: u32,
}

#[repr(C)]
struct WlanInterfaceInfoList {
    count: u32,
    index: u32,
    // The list is `count` entries long; the array here only reserves the first one.
    first: WlanInterfaceInfo,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WlanProfileInfo {
    name: [u16; 256],
    flags: u32,
}

#[repr(C)]
struct WlanProfileInfoList {
    count: u32,
    index: u32,
    first: WlanProfileInfo,
}

#[link(name = "wlanapi")]
extern "system" {
    fn WlanOpenHandle(version: u32, reserved: *mut c_void, negotiated: *mut u32, handle: *mut *mut c_void) -> u32;
    fn WlanCloseHandle(handle: *mut c_void, reserved: *mut c_void) -> u32;
    fn WlanFreeMemory(ptr: *mut c_void);
    fn WlanEnumInterfaces(handle: *mut c_void, reserved: *mut c_void, list: *mut *mut WlanInterfaceInfoList) -> u32;
    fn WlanGetProfileList(
        handle: *mut c_void,
        guid: *const Guid,
        reserved: *mut c_void,
        list: *mut *mut WlanProfileInfoList,
    ) -> u32;
    fn WlanGetProfile(
        handle: *mut c_void,
        guid: *const Guid,
        name: *const u16,
        reserved: *mut c_void,
        xml: *mut *mut u16,
        flags: *mut u32,
        granted: *mut u32,
    ) -> u32;
}

const WLAN_PROFILE_GET_PLAINTEXT_KEY: u32 = 4;

fn wide_field(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// The saved WiFi profiles. `keyMaterial` is only read when `want_keys` is true, and the page
/// only gets there by holding `system.write` on top of `system.read`.
pub fn wifi_profiles(want_keys: bool) -> Value {
    let mut handle: *mut c_void = std::ptr::null_mut();
    let mut negotiated: u32 = 0;
    let mut items: Vec<Value> = Vec::new();
    unsafe {
        if WlanOpenHandle(2, std::ptr::null_mut(), &mut negotiated, &mut handle) != 0 || handle.is_null() {
            return json!({ "items": items, "supported": false });
        }
        let mut list: *mut WlanInterfaceInfoList = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, std::ptr::null_mut(), &mut list) == 0 && !list.is_null() {
            let count = (*list).count as usize;
            let base = list as usize + 8; // count + index
            for i in 0..count {
                let info = &*((base + i * std::mem::size_of::<WlanInterfaceInfo>()) as *const WlanInterfaceInfo);
                let mut profiles: *mut WlanProfileInfoList = std::ptr::null_mut();
                if WlanGetProfileList(handle, &info.guid, std::ptr::null_mut(), &mut profiles) != 0
                    || profiles.is_null()
                {
                    continue;
                }
                let pcount = (*profiles).count as usize;
                let pbase = profiles as usize + 8;
                for j in 0..pcount {
                    let pinfo =
                        &*((pbase + j * std::mem::size_of::<WlanProfileInfo>()) as *const WlanProfileInfo);
                    let ssid = wide_field(&pinfo.name);
                    if items.iter().any(|v| v.get("ssid").and_then(Value::as_str) == Some(ssid.as_str())) {
                        continue;
                    }
                    let name = pinfo.name;
                    let mut xml: *mut u16 = std::ptr::null_mut();
                    let mut flags: u32 = if want_keys { WLAN_PROFILE_GET_PLAINTEXT_KEY } else { 0 };
                    let mut granted: u32 = 0;
                    let ok = WlanGetProfile(
                        handle,
                        &info.guid,
                        name.as_ptr(),
                        std::ptr::null_mut(),
                        &mut xml,
                        &mut flags,
                        &mut granted,
                    ) == 0
                        && !xml.is_null();
                    if !ok {
                        continue;
                    }
                    let mut len = 0usize;
                    while *xml.add(len) != 0 {
                        len += 1;
                    }
                    let text = String::from_utf16_lossy(std::slice::from_raw_parts(xml, len));
                    let auth = xml_tag(&text, "authentication");
                    let cipher = xml_tag(&text, "encryption");
                    let key = if want_keys { xml_tag(&text, "keyMaterial") } else { String::new() };
                    let mut row = serde_json::Map::new();
                    row.insert("ssid".into(), json!(ssid));
                    row.insert("auth".into(), json!(auth));
                    row.insert("cipher".into(), json!(cipher));
                    row.insert("hasKey".into(), json!(!key.is_empty()));
                    if want_keys {
                        row.insert("key".into(), json!(key));
                        row.insert("revealed".into(), json!(true));
                    }
                    items.push(Value::Object(row));
                    WlanFreeMemory(xml as *mut c_void);
                }
                WlanFreeMemory(profiles as *mut c_void);
            }
            WlanFreeMemory(list as *mut c_void);
        }
        WlanCloseHandle(handle, std::ptr::null_mut());
    }
    json!({ "items": items, "supported": true })
}

/// The text inside the first `<tag>…</tag>` of a WLAN profile XML.
fn xml_tag(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let Some(start) = xml.find(&open) else {
        return String::new();
    };
    let from = start + open.len();
    let Some(end) = xml[from..].find(&close) else {
        return String::new();
    };
    xml[from..from + end].trim().to_string()
}

// ── screensaver ──────────────────────────────────────────────────────────────

#[link(name = "user32")]
extern "system" {
    fn SendMessageTimeoutW(
        hwnd: isize,
        msg: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
}

const HWND_BROADCAST: isize = 0xFFFF;
const WM_SYSCOMMAND: u32 = 0x0112;
const SC_SCREENSAVE: usize = 0xF140;
const SMTO_ABORTIFHUNG: u32 = 0x0002;

/// Starts the screensaver, or opens Windows' own screensaver page. Deliberately nothing else:
/// disabling the screensaver or the lock screen is a security decision, not a widget feature.
pub fn screensaver(action: &str) -> Result<Value, String> {
    match action {
        "start" => {
            let mut result: usize = 0;
            unsafe {
                SendMessageTimeoutW(HWND_BROADCAST, WM_SYSCOMMAND, SC_SCREENSAVE, 0, SMTO_ABORTIFHUNG, 1000, &mut result);
            }
            Ok(json!({ "ok": true }))
        }
        "settings" => {
            std::process::Command::new("control")
                .arg("desk.cpl,,@screensaver")
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        other => Err(format!("unknown screensaver action '{other}'")),
    }
}

