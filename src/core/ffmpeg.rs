//! FFmpeg 音视频处理 category — reserved, deliberately not implemented.
//!
//! uTools bundles an FFmpeg binary and calls it with `runFFmpeg(args, onProgress)`. A media
//! converter is not part of this build (it would add tens of megabytes to the single executable),
//! so the category answers with one clear refusal and keeps its file for a later implementation.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{BridgeError, BridgeResult};
use serde_json::Value;

pub const METHODS: &[&str] = &["ffmpeg.run"];
pub const REASON: &str =
    "no FFmpeg binary is bundled; shipping one would add tens of megabytes to the executable";

pub fn call(_ctx: &mut Ctx, method: &str, _p: &Value) -> Option<BridgeResult<Reply>> {
    if !METHODS.contains(&method) {
        return None;
    }
    Some(Err(BridgeError::new(format!(
        "{method}: reserved in the FFmpeg category — {REASON}"
    ))))
}
