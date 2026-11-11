//! AI 能力 category — reserved, deliberately not implemented.
//!
//! uTools answers `registerTool`, `ai(options)` and `allAiModels()`. Those need a model account, a
//! tool runtime and a streaming transport; none of that exists in this build, so every method in
//! this category is answered with the same explicit refusal instead of an empty promise. The file
//! exists so the category list is complete and so a later implementation has its place.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{BridgeError, BridgeResult};
use serde_json::Value;

pub const METHODS: &[&str] = &["ai.registerTool", "ai.chat", "ai.models"];
pub const REASON: &str =
    "AI needs a model account, a tool runtime and a streaming transport; this build has none of them";

pub fn call(_ctx: &mut Ctx, method: &str, _p: &Value) -> Option<BridgeResult<Reply>> {
    if !METHODS.contains(&method) {
        return None;
    }
    Some(Err(BridgeError::new(format!(
        "{method}: reserved in the AI category — {REASON}"
    ))))
}
