//! Master volume through the Core Audio API (the same endpoint the Windows volume flyout uses).

use serde_json::{json, Value};
use std::sync::Mutex;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};

static INIT: Mutex<bool> = Mutex::new(false);

fn init_com() {
    let mut done = INIT.lock().unwrap();
    if *done {
        return;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    *done = true;
}

fn endpoint() -> Option<IAudioEndpointVolume> {
    init_com();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .ok()?;
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
        Some(volume)
    }
}

pub fn state() -> Value {
    let Some(volume) = endpoint() else {
        return json!({ "available": false, "volume": 0, "muted": false, "device": Value::Null });
    };
    unsafe {
        let level = volume.GetMasterVolumeLevelScalar().unwrap_or(0.0);
        let muted = volume.GetMute().map(|b| b.as_bool()).unwrap_or(false);
        json!({
            "available": true,
            "volume": (level * 100.0).round(),
            "muted": muted,
            "device": Value::Null,
        })
    }
}

pub fn apply(p: &Value) -> Value {
    let Some(volume) = endpoint() else {
        return json!({ "available": false, "volume": 0, "muted": false, "device": Value::Null });
    };
    unsafe {
        if let Some(v) = p.get("volume").and_then(|v| v.as_f64()) {
            let level = (v / 100.0).clamp(0.0, 1.0) as f32;
            let _ = volume.SetMasterVolumeLevelScalar(level, std::ptr::null());
        }
        if let Some(m) = p.get("muted").and_then(|v| v.as_bool()) {
            let _ = volume.SetMute(m, std::ptr::null());
        }
    }
    state()
}
