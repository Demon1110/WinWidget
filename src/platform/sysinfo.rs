//! System data behind `widget.system.*`: CPU/memory/network/disk/battery, the machine's own
//! specs, network adapters, a TCP reachability probe and a 15-minute history.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::TcpStream;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};

pub const TOPICS: [&str; 5] = ["cpu", "memory", "disk", "network", "battery"];
const HISTORY_MINUTES: i64 = 15;

pub struct Sampler {
    sys: Option<System>,
    disks: Option<Disks>,
    nets: Option<Networks>,
    last_rx: u64,
    last_tx: u64,
    last_at: Instant,
    history: VecDeque<[f64; 5]>,
}

impl Sampler {
    pub fn new() -> Sampler {
        let mut sys = System::new().ok();
        if let Some(s) = &mut sys {
            s.refresh_cpu_usage();
            s.refresh_memory();
        }
        let disks = Disks::new_with_refreshed_list().ok();
        let nets = Networks::new_with_refreshed_list().ok();
        let (rx, tx) = nets.as_ref().map(totals).unwrap_or((0, 0));
        Sampler {
            sys,
            disks,
            nets,
            last_rx: rx,
            last_tx: tx,
            last_at: Instant::now(),
            history: VecDeque::new(),
        }
    }

    /// One reading. `topics` picks what to include; "cpu"/"memory" are cheapest.
    pub fn sample(&mut self, topics: &[String]) -> Value {
        let wants = |t: &str| topics.is_empty() || topics.iter().any(|x| x.eq_ignore_ascii_case(t));
        let mut out = serde_json::Map::new();
        let mut point = [0f64; 5];

        if wants("cpu") {
            if let Some(sys) = &mut self.sys {
                sys.refresh_cpu_usage();
                let usage = sys.global_cpu_usage() as f64;
                point[0] = usage;
                out.insert("cpu".into(), json!({ "usage": round1(usage) }));
            }
        }
        if wants("memory") {
            if let Some(sys) = &mut self.sys {
                sys.refresh_memory();
                let total = sys.total_memory() as f64;
                let used = sys.used_memory() as f64;
                let usage = if total > 0.0 {
                    (used / total) * 100.0
                } else {
                    0.0
                };
                point[1] = usage;
                out.insert(
                    "memory".into(),
                    json!({
                        "usage": round1(usage),
                        "used": used as u64,
                        "total": total as u64,
                    }),
                );
            }
        }
        if wants("disk") {
            if let Some(disks) = &mut self.disks {
                disks.refresh(false);
                let list: Vec<Value> = disks
                    .iter()
                    .filter(|d| d.total_space() > 0)
                    .map(|d| {
                        let total = d.total_space() as f64;
                        let free = d.available_space() as f64;
                        let usage = if total > 0.0 {
                            ((total - free) / total) * 100.0
                        } else {
                            0.0
                        };
                        let mount = d.mount_point().to_string_lossy().to_string();
                        let name = mount.trim_end_matches(['\\', '/']).to_string();
                        json!({
                            "name": name,
                            "label": d.name().to_string_lossy().to_string(),
                            "usage": round1(usage),
                            "free": free as u64,
                            "total": total as u64,
                            "type": if d.is_removable() { "removable" } else { "fixed" },
                            "fileSystem": d.file_system().to_string_lossy().to_string(),
                        })
                    })
                    .collect();
                out.insert("disk".into(), Value::Array(list));
            }
        }
        if wants("network") {
            if let Some(nets) = &mut self.nets {
                nets.refresh(true);
                let (rx, tx) = totals(nets);
                let dt = self.last_at.elapsed().as_secs_f64().max(0.2);
                let down = (rx.saturating_sub(self.last_rx)) as f64 / dt;
                let up = (tx.saturating_sub(self.last_tx)) as f64 / dt;
                self.last_rx = rx;
                self.last_tx = tx;
                self.last_at = Instant::now();
                point[2] = down;
                point[3] = up;
                out.insert(
                    "network".into(),
                    json!({
                        "down": down as u64,
                        "up": up as u64,
                        // Since the machine started, which is what the net-speed card labels these.
                        "totalDown": rx,
                        "totalUp": tx,
                    }),
                );
            }
        }
        if wants("battery") {
            let b = battery();
            point[4] = b.percent;
            out.insert("battery".into(), b.value);
        }

        point[0] = point[0].max(0.0);
        self.history.push_back(point);
        // Fifteen minutes at one reading a second is the longest history any card asks for; the real
        // spacing is applied when the points are read back.
        let keep = (HISTORY_MINUTES * 60) as usize;
        while self.history.len() > keep {
            self.history.pop_front();
        }
        out.into()
    }

    /// `{ now, points: [[time, cpu%, mem%, down, up], ...] }` over the last 15 minutes.
    pub fn history(&self, interval_ms: i64) -> Value {
        let now = crate::core::util::now_ms();
        let count = self.history.len() as i64;
        let points: Vec<Value> = self
            .history
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let t = now - (count - 1 - i as i64) * interval_ms;
                json!([t, round1(p[0]), round1(p[1]), p[2] as u64, p[3] as u64])
            })
            .collect();
        json!({ "now": now, "points": points })
    }
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Battery {
    pub percent: f64,
    pub charging: bool,
    pub plugged_in: bool,
    pub present: bool,
    pub value: Value,
}

pub fn battery() -> Battery {
    let mut status = crate::platform::win32::SYSTEM_POWER_STATUS::default();
    let ok = unsafe { crate::platform::win32::GetSystemPowerStatus(&mut status) } != 0;
    let present = ok && status.BatteryFlag != 128; // 128 = no system battery
    let percent = if status.BatteryLifePercent == 255 {
        Value::Null
    } else {
        json!(status.BatteryLifePercent as f64)
    };
    let plugged_in = ok && status.ACLineStatus == 1;
    let charging = ok && (status.BatteryFlag as u32 & 8) != 0;
    let value = json!({
        "present": present,
        "percent": percent,
        "charging": charging,
        "pluggedIn": plugged_in,
        "saver": false,
        "remainingMinutes": Value::Null,
    });
    Battery {
        percent: status.BatteryLifePercent as f64,
        charging,
        plugged_in,
        present,
        value,
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn totals(nets: &Networks) -> (u64, u64) {
    let mut rx = 0u64;
    let mut tx = 0u64;
    for data in nets.values() {
        rx += data.total_received();
        tx += data.total_transmitted();
    }
    (rx, tx)
}

// ── machine specs (the `pcinfo` widget) ─────────────────────────────────────

pub fn info(monitors: &[(i32, i32, bool)]) -> Value {
    let mut sys = System::new().ok();
    if let Some(s) = &mut sys {
        s.refresh_cpu_all();
        s.refresh_memory();
    }

    let cpu_name = sys
        .as_ref()
        .and_then(|s| s.cpus().first().map(|c| c.brand().to_string()))
        .unwrap_or_default();
    let threads = sys.as_ref().map(|s| s.cpus().len()).unwrap_or(0);
    let cores = System::physical_core_count().unwrap_or(threads);
    let installed = sys.as_ref().map(|s| s.total_memory()).unwrap_or(0);
    let boot = System::boot_time().map(|b| b as i64 * 1000).unwrap_or(0);

    let (os_name, os_version, os_build, edition) = windows_version();
    let screens: Vec<Value> = monitors
        .iter()
        .map(|(w, h, primary)| json!({ "width": w, "height": h, "primary": primary }))
        .collect();

    json!({
        "os": {
            "name": os_name,
            "version": os_version,
            "build": os_build,
            "edition": edition,
        },
        "cpu": { "name": cpu_name, "cores": cores, "threads": threads },
        "memory": { "installed": installed },
        "gpus": gpus(),
        "computer": std::env::var("COMPUTERNAME").unwrap_or_default(),
        "bootTime": boot,
        "screens": screens,
    })
}

fn windows_version() -> (String, String, String, String) {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok();
    let get = |name: &str| -> String {
        key.as_ref()
            .and_then(|k| k.get_value::<String, _>(name).ok())
            .unwrap_or_default()
    };
    let product = get("ProductName");
    let build = get("CurrentBuildNumber");
    let mut display = get("DisplayVersion");
    if display.is_empty() {
        display = get("ReleaseId");
    }
    let edition_id = get("EditionID");
    let name = if product.is_empty() {
        format!("Windows {}", build)
    } else {
        format!("{product} {display}").trim().to_string()
    };
    (name, display, build, edition_id)
}

fn gpus() -> Vec<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let mut out = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(class) = hklm.open_subkey(
        r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}",
    ) {
        for item in class.enum_keys().flatten() {
            if !item.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            if let Ok(sub) = class.open_subkey(&item) {
                if let Ok(desc) = sub.get_value::<String, _>("DriverDesc") {
                    if !desc.is_empty() {
                        out.push(desc);
                    }
                }
            }
        }
    }
    out
}

/// `{ online, adapters: [{ name, type, ip, ipv4, ipv6, gateway, gateways, speed, received,
/// transmitted, up }] }` — one entry per interface, the one carrying traffic first.
pub fn adapters() -> Value {
    let Ok(mut nets) = Networks::new_with_refreshed_list() else {
        return json!({ "online": false, "adapters": Vec::<Value>::new() });
    };
    nets.refresh(true);
    let mut list: Vec<(u8, Value)> = Vec::new();
    let mut online = false;
    for (name, data) in nets.iter() {
        // Both families are kept apart: the card shows the local address and the gateway, and a
        // machines with IPv6 has one of each.
        let mut ipv4: Vec<String> = Vec::new();
        let mut ipv6: Vec<String> = Vec::new();
        for net in data.ip_networks() {
            let addr = net.addr;
            if addr.is_loopback() || addr.is_unspecified() || addr.to_string() == "0.0.0.0" {
                continue;
            }
            match addr {
                std::net::IpAddr::V4(_) => ipv4.push(addr.to_string()),
                std::net::IpAddr::V6(_) => ipv6.push(addr.to_string()),
            }
        }
        let ip = ipv4
            .first()
            .or_else(|| ipv6.first())
            .cloned()
            .unwrap_or_default();
        let up = data.operational_state() != sysinfo::InterfaceOperationalState::Down;
        let usable = up && !ip.is_empty();
        if usable {
            online = true;
        }
        let label = name.to_string_lossy().to_lowercase();
        // 0: carrying an address and up, 1: up but blank, 2: down — the first entry is then the
        // adapter the card is actually using.
        let rank = if usable {
            0
        } else if up {
            1
        } else {
            2
        };
        list.push((
            rank,
            json!({
                "name": name.to_string_lossy(),
                "type": if label.contains("wi-fi") || label.contains("wlan") || label.contains("wireless") { "wifi" } else { "ethernet" },
                "ip": ip,
                "ipv4": ipv4,
                "ipv6": ipv6,
                "gateway": Value::Null,
                "gateways": Vec::<String>::new(),
                "speed": data.receive_link_speed().unwrap_or(0),
                "received": data.total_received(),
                "transmitted": data.total_transmitted(),
                "up": up,
            }),
        ));
    }
    list.sort_by_key(|(rank, _)| *rank);
    let adapters: Vec<Value> = list.into_iter().map(|(_, value)| value).collect();
    json!({ "online": online, "adapters": adapters })
}

/// A short TCP probe: the time it takes to open a socket to the host's web port.
pub fn ping(host: &str, timeout_ms: u64) -> Value {
    use std::net::ToSocketAddrs;
    let host = host.trim();
    if host.is_empty() {
        return json!({ "ok": false, "ms": Value::Null, "status": "no host", "address": host });
    }
    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms.max(50));
    for port in [443u16, 80] {
        let addrs: Vec<std::net::SocketAddr> = format!("{host}:{port}")
            .to_socket_addrs()
            .map(|iter| iter.collect())
            .unwrap_or_default();
        for addr in addrs {
            if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                return json!({
                    "ok": true,
                    "ms": started.elapsed().as_millis() as u64,
                    "status": "ok",
                    "address": addr.ip().to_string(),
                });
            }
        }
    }
    json!({
        "ok": false,
        "ms": Value::Null,
        "status": "unreachable",
        "address": host,
    })
}
