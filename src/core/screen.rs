//! 屏幕 category: displays, coordinates and screen pictures.
//!
//! The one thing to keep straight here is that uTools speaks **DIP** (logical points) in every
//! `Display` and `Point`, while Windows hands back physical pixels. Every conversion therefore goes
//! through the display's own `scaleFactor`, never a global one.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jnum, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Value};

const OWNS: &[&str] = &[
    "screen.capture",
    "screen.displays",
    "screen.primary",
    "screen.nearest",
    "screen.matching",
    "screen.cursor",
    "screen.toDip",
    "screen.toScreen",
    "screen.captureDisplay",
    "screen.colorPick",
    "screen.captureInteractive",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    match method {
        // ── pictures ─────────────────────────────────────────────────────────────────────────
        "screen.capture" => {
            ctx.require("screen")?;
            // Grabbing a 4K desktop and encoding it takes ~40 ms; a card must not wait for that on
            // the UI thread.
            ctx.spawn_value(|| match w::capture_screen_png() {
                Some(png) => Value::String(format!("data:image/png;base64,{}", w::base64(&png))),
                None => Value::Null,
            });
            Ok(Reply::Later)
        }
        "screen.captureDisplay" => {
            ctx.require("screen")?;
            let index = jnum(p, "display").unwrap_or(0.0) as usize;
            let rect = w::monitors()
                .into_iter()
                .nth(index)
                .map(|(rect, _)| rect)
                .ok_or_else(|| BridgeError::new("no such display"))?;
            ctx.spawn_value(move || match w::capture_rect_png(&rect) {
                Some(png) => Value::String(format!("data:image/png;base64,{}", w::base64(&png))),
                None => Value::Null,
            });
            Ok(Reply::Later)
        }
        "screen.colorPick" => {
            ctx.require("screen")?;
            // uTools puts a magnifier on the cursor and waits for a click; that overlay does not
            // exist here, so the answer is the pixel under the cursor right now.
            let point = w::cursor_pos();
            let hex = w::pixel_hex(point.x, point.y).ok_or_else(|| {
                BridgeError::new("could not read the pixel under the cursor")
            })?;
            let rgb = hex_to_rgb(&hex);
            Ok(Reply::Now(json!({
                "hex": hex,
                "rgb": format!("rgb({}, {}, {})", rgb.0, rgb.1, rgb.2),
            })))
        }
        // uTools draws its own selection overlay; WinWidget hands the job to Windows' snipping
        // tool (`ms-screenclip:`), waits for the clipboard to change, and answers the new picture.
        "screen.captureInteractive" => {
            ctx.require("screen")?;
            let timeout = jnum(p, "timeout").unwrap_or(45_000.0) as u64;
            ctx.spawn_value(move || match w::capture_interactive_png(timeout) {
                Some(png) => Value::String(format!("data:image/png;base64,{}", w::base64(&png))),
                None => Value::Null,
            });
            Ok(Reply::Later)
        }

        // ── displays ─────────────────────────────────────────────────────────────────────────
        "screen.displays" => {
            ctx.require("screen")?;
            Ok(Reply::Now(Value::Array(displays())))
        }
        "screen.primary" => {
            ctx.require("screen")?;
            let list = displays();
            let primary = list
                .iter()
                .find(|d| d.get("primary").and_then(|v| v.as_bool()).unwrap_or(false))
                .cloned()
                .or_else(|| list.first().cloned())
                .ok_or_else(|| BridgeError::new("no display"))?;
            Ok(Reply::Now(primary))
        }
        "screen.nearest" => {
            ctx.require("screen")?;
            let x = jnum(p, "x").unwrap_or(0.0);
            let y = jnum(p, "y").unwrap_or(0.0);
            Ok(Reply::Now(nearest_display(x, y)))
        }
        "screen.matching" => {
            ctx.require("screen")?;
            let left = jnum(p, "left").unwrap_or(0.0) as i32;
            let top = jnum(p, "top").unwrap_or(0.0) as i32;
            let width = jnum(p, "width").unwrap_or(0.0) as i32;
            let height = jnum(p, "height").unwrap_or(0.0) as i32;
            let rect = w::RECT {
                left,
                top,
                right: left + width.max(1),
                bottom: top + height.max(1),
            };
            Ok(Reply::Now(nearest_display(
                f64::from((rect.left + rect.right) / 2),
                f64::from((rect.top + rect.bottom) / 2),
            )))
        }

        // ── coordinates ──────────────────────────────────────────────────────────────────────
        "screen.cursor" => {
            let point = w::cursor_pos();
            let scale = scale_at(point.x, point.y);
            Ok(Reply::Now(json!({
                "x": f64::from(point.x) / scale,
                "y": f64::from(point.y) / scale,
            })))
        }
        "screen.toDip" => Ok(Reply::Now(convert(p, true))),
        "screen.toScreen" => Ok(Reply::Now(convert(p, false))),

        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// All displays, uTools shaped (`Display`). `rotation` is always 0: a monitor turned sideways is
/// reported that way by Windows itself, so there is nothing to add.
fn displays() -> Vec<Value> {
    let mut out = Vec::new();
    for (index, (rect, primary)) in w::monitors().into_iter().enumerate() {
        let (work, _full) = w::monitor_work_area(&rect);
        let scale = w::monitor_dpi(&rect);
        out.push(json!({
            "id": index as i64,
            "label": format!("Display {}", index + 1),
            "primary": primary,
            "bounds": {
                "x": f64::from(rect.left) / scale,
                "y": f64::from(rect.top) / scale,
                "width": f64::from(rect.width()) / scale,
                "height": f64::from(rect.height()) / scale,
            },
            "workArea": {
                "x": f64::from(work.left) / scale,
                "y": f64::from(work.top) / scale,
                "width": f64::from(work.width()) / scale,
                "height": f64::from(work.height()) / scale,
            },
            "workAreaSize": {
                "width": f64::from(work.width()) / scale,
                "height": f64::from(work.height()) / scale,
            },
            "scaleFactor": scale,
            "rotation": 0,
            "size": {
                "width": f64::from(rect.width()) / scale,
                "height": f64::from(rect.height()) / scale,
            },
        }));
    }
    out
}

fn nearest_display(x: f64, y: f64) -> Value {
    let (rect, _) = {
        let physical = w::RECT {
            left: x as i32,
            top: y as i32,
            right: x as i32 + 1,
            bottom: y as i32 + 1,
        };
        let monitor = unsafe { w::MonitorFromRect(&physical, 2) };
        let mut info = w::MONITORINFO {
            cbSize: std::mem::size_of::<w::MONITORINFO>() as u32,
            ..Default::default()
        };
        unsafe {
            w::GetMonitorInfoW(monitor, &mut info);
        }
        (info.rcMonitor, ())
    };
    let scale = w::monitor_dpi(&rect);
    let (work, _full) = w::monitor_work_area(&rect);
    let index = w::monitors()
        .into_iter()
        .position(|(r, _)| {
            r.left == rect.left && r.top == rect.top && r.right == rect.right && r.bottom == rect.bottom
        })
        .unwrap_or(0);
    json!({
        "id": index as i64,
        "label": format!("Display {}", index + 1),
        "bounds": {
            "x": f64::from(rect.left) / scale,
            "y": f64::from(rect.top) / scale,
            "width": f64::from(rect.width()) / scale,
            "height": f64::from(rect.height()) / scale,
        },
        "workArea": {
            "x": f64::from(work.left) / scale,
            "y": f64::from(work.top) / scale,
            "width": f64::from(work.width()) / scale,
            "height": f64::from(work.height()) / scale,
        },
        "workAreaSize": {
            "width": f64::from(work.width()) / scale,
            "height": f64::from(work.height()) / scale,
        },
        "scaleFactor": scale,
        "rotation": 0,
    })
}

fn scale_at(x: i32, y: i32) -> f64 {
    let rect = w::RECT {
        left: x,
        top: y,
        right: x + 1,
        bottom: y + 1,
    };
    w::monitor_dpi(&rect)
}

/// `Point` or `Rectangle` in one direction or the other, scaled by the display the shape is on.
fn convert(p: &Value, to_dip: bool) -> Value {
    let has_rect = jnum(p, "width").is_some() || jnum(p, "height").is_some();
    let x = jnum(p, "x").or_else(|| jnum(p, "left")).unwrap_or(0.0);
    let y = jnum(p, "y").or_else(|| jnum(p, "top")).unwrap_or(0.0);
    let scale = scale_at(x as i32, y as i32);
    let k = if to_dip { 1.0 / scale } else { scale };
    if has_rect {
        json!({
            "x": x * k,
            "y": y * k,
            "width": jnum(p, "width").unwrap_or(0.0) * k,
            "height": jnum(p, "height").unwrap_or(0.0) * k,
        })
    } else {
        json!({ "x": x * k, "y": y * k })
    }
}

/// `#RRGGBB` to its three channels.
fn hex_to_rgb(hex: &str) -> (u8, u8, u8) {
    let s = hex.trim_start_matches('#');
    let parse = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or(0);
    (parse(0), parse(2), parse(4))
}
