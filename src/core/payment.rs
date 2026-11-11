//! 支付 category — reserved, deliberately not implemented.
//!
//! uTools' payment APIs need a signed merchant account and the uTools account system. Neither
//! exists here, so every method refuses explicitly rather than returning a fake order.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{BridgeError, BridgeResult};
use serde_json::Value;

pub const METHODS: &[&str] = &["payment.create", "payment.query", "payment.cancel"];
pub const REASON: &str =
    "payment needs a signed merchant account and the uTools account system; this build has neither";

pub fn call(_ctx: &mut Ctx, method: &str, _p: &Value) -> Option<BridgeResult<Reply>> {
    if !METHODS.contains(&method) {
        return None;
    }
    Some(Err(BridgeError::new(format!(
        "{method}: reserved in the payment category — {REASON}"
    ))))
}
