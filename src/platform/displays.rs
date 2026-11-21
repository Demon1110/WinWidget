//! Read-only display inventory: which monitors are attached, their pixel size, refresh rate and
//! whether Windows has HDR (advanced colour) on. Nothing here changes a display setting — turning
//! HDR on or off is a system-wide visual decision and stays in Windows' own settings app.

use serde_json::{json, Value};

use crate::platform::win32 as w;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Luid {
    low: u32,
    high: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PathSource {
    adapter: Luid,
    id: u32,
    mode: u32,
    status: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rational {
    n: u32,
    d: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PathTarget {
    adapter: Luid,
    id: u32,
    mode: u32,
    technology: u32,
    rotation: u32,
    scaling: u32,
    refresh: Rational,
    scanline: u32,
    available: i32,
    status: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PathInfo {
    source: PathSource,
    target: PathTarget,
}

/// `DISPLAYCONFIG_MODE_INFO` is 64 bytes: the header (16) plus a 48-byte union. We never read the
/// union, we only have to hand the API a buffer of the right shape.
#[repr(C)]
#[derive(Clone, Copy)]
#[allow(dead_code)]
struct ModeInfo {
    info_type: u32,
    id: u32,
    adapter: Luid,
    data: [u8; 48],
}

impl Default for ModeInfo {
    fn default() -> Self {
        Self { info_type: 0, id: 0, adapter: Luid::default(), data: [0; 48] }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DeviceInfoHeader {
    kind: u32,
    size: u32,
    adapter: Luid,
    id: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SourceName {
    header: DeviceInfoHeader,
    name: [u16; 32],
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AdvancedColor {
    header: DeviceInfoHeader,
    value: u32,
    encoding: u32,
    bits: u32,
}

/// `MONITORINFOEXW`: the common block plus the `\\.\DISPLAY1` device name. `cbSize` must cover
/// the whole struct or Windows will not write the name.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MonitorInfoEx {
    common: w::MONITORINFO,
    device: [u16; 32],
}

#[link(name = "user32")]
extern "system" {
    fn DisplayConfigGetDeviceInfo(info: *mut DeviceInfoHeader) -> i32;
    fn GetDisplayConfigBufferSizes(flags: u32, paths: *mut u32, modes: *mut u32) -> i32;
    fn QueryDisplayConfig(
        flags: u32,
        paths: *mut u32,
        path_array: *mut PathInfo,
        modes: *mut u32,
        mode_array: *mut ModeInfo,
        current: *mut u32,
    ) -> i32;
}

const QDC_ONLY_ACTIVE_PATHS: u32 = 2;
const GET_SOURCE_NAME: u32 = 1;
const GET_ADVANCED_COLOR_INFO: u32 = 9;
const MONITORINFOF_PRIMARY: u32 = 1;

/// The monitor rectangles GDI knows about, keyed by the `\\.\DISPLAY1` style device name.
struct GdiMonitor {
    name: String,
    width: i32,
    height: i32,
    primary: bool,
}

extern "system" fn monitor_cb(monitor: isize, _dc: isize, _clip: *mut w::RECT, data: isize) -> i32 {
    let list = unsafe { &mut *(data as *mut Vec<GdiMonitor>) };
    let mut info = MonitorInfoEx::default();
    info.common.cbSize = std::mem::size_of::<MonitorInfoEx>() as u32;
    if unsafe { w::GetMonitorInfoW(monitor, &mut info.common) } == 0 {
        return 1;
    }
    list.push(GdiMonitor {
        name: wide(&info.device),
        width: info.common.rcMonitor.right - info.common.rcMonitor.left,
        height: info.common.rcMonitor.bottom - info.common.rcMonitor.top,
        primary: info.common.dwFlags & MONITORINFOF_PRIMARY != 0,
    });
    1
}

fn gdi_monitors() -> Vec<GdiMonitor> {
    let mut list: Vec<GdiMonitor> = Vec::new();
    unsafe {
        let _ = w::EnumDisplayMonitors(0, std::ptr::null(), monitor_cb, &mut list as *mut _ as isize);
    }
    list
}

fn wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// One row per active display path. `hdr` stays `null` when the OS refuses the advanced-colour
/// query, which is the honest answer on older builds.
pub fn displays() -> Value {
    let monitors = gdi_monitors();
    let mut items: Vec<Value> = Vec::new();

    let mut path_count: u32 = 0;
    let mut mode_count: u32 = 0;
    if unsafe { GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count) } != 0 {
        return fallback(&monitors);
    }
    let mut paths: Vec<PathInfo> = vec![PathInfo::default(); path_count.max(1) as usize];
    let mut modes: Vec<ModeInfo> = vec![ModeInfo::default(); mode_count.max(1) as usize];
    // Windows rejects a non-null `current` pointer together with ONLY_ACTIVE_PATHS.
    let ok = unsafe {
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            std::ptr::null_mut(),
        )
    };
    if ok != 0 {
        return fallback(&monitors);
    }
    paths.truncate(path_count as usize);

    for path in &paths {
        let mut source = SourceName::default();
        source.header = DeviceInfoHeader {
            kind: GET_SOURCE_NAME,
            size: std::mem::size_of::<SourceName>() as u32,
            adapter: path.source.adapter,
            id: path.source.id,
        };
        if unsafe { DisplayConfigGetDeviceInfo(&mut source.header) } != 0 {
            continue;
        }
        let gdi = wide(&source.name);
        let monitor = monitors.iter().find(|m| m.name.eq_ignore_ascii_case(&gdi));

        let mut colour = AdvancedColor::default();
        colour.header = DeviceInfoHeader {
            kind: GET_ADVANCED_COLOR_INFO,
            size: std::mem::size_of::<AdvancedColor>() as u32,
            adapter: path.target.adapter,
            id: path.target.id,
        };
        let colour_ok = unsafe { DisplayConfigGetDeviceInfo(&mut colour.header) } == 0;

        let refresh = if path.target.refresh.d > 0 {
            (path.target.refresh.n as f64 / path.target.refresh.d as f64).round() as u32
        } else {
            0
        };

        items.push(json!({
            "device": gdi,
            "width": monitor.map(|m| m.width).unwrap_or(0),
            "height": monitor.map(|m| m.height).unwrap_or(0),
            "refresh": refresh,
            "primary": monitor.map(|m| m.primary).unwrap_or(false),
            "hdrSupported": colour_ok.then(|| colour.value & 0x1 != 0),
            "hdrEnabled": colour_ok.then(|| colour.value & 0x2 != 0),
            "bitsPerColor": if colour_ok { Some(colour.bits) } else { None },
        }));
    }

    if items.is_empty() {
        return fallback(&monitors);
    }
    json!({ "items": items, "hdrReadable": items.iter().any(|v| v.get("hdrEnabled").is_some_and(|h| !h.is_null())) })
}

/// When display config fails, still show the monitors and sizes, just without HDR.
fn fallback(monitors: &[GdiMonitor]) -> Value {
    let items: Vec<Value> = monitors
        .iter()
        .map(|m| {
            json!({
                "device": m.name,
                "width": m.width,
                "height": m.height,
                "refresh": 0,
                "primary": m.primary,
                "hdrSupported": null,
                "hdrEnabled": null,
                "bitsPerColor": null,
            })
        })
        .collect();
    json!({ "items": items, "hdrReadable": false })
}
