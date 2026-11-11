//! 模拟操作 category: keyboard taps and mouse gestures injected into Windows.
//!
//! Coordinates are **physical pixels**, exactly as uTools documents them, so nothing is scaled here.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jnum, jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::Value;

const OWNS: &[&str] = &[
    "simulate.keyboardTap",
    "simulate.mouseMove",
    "simulate.mouseClick",
    "simulate.mouseDoubleClick",
    "simulate.mouseRightClick",
];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    ctx.require("input")?;
    match method {
        "simulate.keyboardTap" => {
            let key = jstr(p, "key").unwrap_or_default();
            if key.is_empty() {
                return Err(BridgeError::new("key is required"));
            }
            let mods: Vec<String> = p
                .get("modifiers")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_lowercase()))
                        .collect()
                })
                .unwrap_or_default();
            w::key_tap(&key, &mods).map_err(BridgeError::new)?;
            Ok(Reply::Now(Value::Null))
        }
        "simulate.mouseMove" => {
            w::mouse_move(point(p)?);
            Ok(Reply::Now(Value::Null))
        }
        "simulate.mouseClick" => {
            w::mouse_move(point(p)?);
            w::mouse_button(1, 1);
            Ok(Reply::Now(Value::Null))
        }
        "simulate.mouseDoubleClick" => {
            w::mouse_move(point(p)?);
            w::mouse_button(1, 2);
            Ok(Reply::Now(Value::Null))
        }
        "simulate.mouseRightClick" => {
            w::mouse_move(point(p)?);
            w::mouse_button(2, 1);
            Ok(Reply::Now(Value::Null))
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// `{ x, y }`, or the first two numbers when a caller passes them positionally.
fn point(p: &Value) -> BridgeResult<(i32, i32)> {
    let x = jnum(p, "x").ok_or_else(|| BridgeError::new("x is required"))?;
    let y = jnum(p, "y").ok_or_else(|| BridgeError::new("y is required"))?;
    Ok((x as i32, y as i32))
}
