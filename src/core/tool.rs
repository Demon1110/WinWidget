//! Third-party command-line tools for widgets.
//!
//! A widget lists a tool in `widget.json` under `tools`:
//!
//! ```json
//! "tools": [{
//!   "name": "ocr",
//!   "url": "https://example.com/ocr.exe",
//!   "sha256": "…optional 64 hex characters…",
//!   "filename": "ocr.exe"
//! }],
//! "permissions": ["tool.exec", "network:example.com"]
//! ```
//!
//! The host downloads it once into `<widget folder>\bin`, verifies the SHA-256 when the
//! declaration includes one, and remembers the result in a small sidecar file. Later runs use the
//! cached file. Execution never goes through a shell: the widget supplies an argument array, and
//! the host captures stdout, stderr and the exit code with a timeout.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::model::manifest::ToolSpec;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

const OWNS: &[&str] = &[
    "tool.list",
    "tool.status",
    "tool.ensure",
    "tool.run",
    "tool.remove",
];

const MAX_BIN_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_STDIN: usize = 1024 * 1024;
const MAX_ARGS: usize = 64;
const MAX_ARG_LEN: usize = 8192;
const MAX_REDIRECTS: usize = 6;
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    let dir = ctx.manifest.dir.clone();
    let id = ctx.manifest.id.clone();
    let tools = ctx.manifest.tools.clone();
    let allowed = ctx.allowed.clone();
    match method {
        "tool.list" => {
            ctx.require("tool.exec")?;
            Ok(Reply::Now(Value::Array(
                tools
                    .iter()
                    .map(|spec| status_value(&dir, &id, spec))
                    .collect(),
            )))
        }
        "tool.status" => {
            ctx.require("tool.exec")?;
            let name = req_str(p, "name")?;
            let spec = find_spec(&tools, &name)?;
            Ok(Reply::Now(status_value(&dir, &id, spec)))
        }
        "tool.ensure" => {
            ctx.require("tool.exec")?;
            let name = req_str(p, "name")?;
            let force = jbool(p, "force").unwrap_or(false);
            let spec = find_spec(&tools, &name)?.clone();
            let dir = dir.clone();
            let id = id.clone();
            let allowed = allowed.clone();
            ctx.spawn_reply(move || {
                let prepared = ensure_tool(&dir, &id, &allowed, &spec, force)?;
                Ok(json!({
                    "name": spec.name,
                    "path": prepared.path.to_string_lossy(),
                    "downloaded": prepared.downloaded,
                    "size": file_len(&prepared.path),
                }))
            });
            Ok(Reply::Later)
        }
        "tool.run" => {
            ctx.require("tool.exec")?;
            let name = req_str(p, "name")?;
            let spec = find_spec(&tools, &name)?.clone();
            let dir = dir.clone();
            let id = id.clone();
            let allowed = allowed.clone();
            let args = run_args(p)?;
            let stdin = jstr(p, "stdin");
            if stdin.as_ref().map(|s| s.len() > MAX_STDIN).unwrap_or(false) {
                return Err(BridgeError::new("stdin is limited to 1 MB"));
            }
            let timeout = jnum(p, "timeout")
                .map(|n| n as u64)
                .unwrap_or_else(|| spec.timeout_ms())
                .clamp(1_000, 300_000);
            let cwd = jstr(p, "cwd");
            ctx.spawn_reply(move || {
                let prepared = ensure_tool(&dir, &id, &allowed, &spec, false)?;
                let work_dir = work_dir(&dir, &id, cwd.as_deref())?;
                let mut result =
                    execute(&prepared.path, &args, stdin.as_deref(), &work_dir, timeout)?;
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("name".into(), Value::String(spec.name.clone()));
                    obj.insert(
                        "path".into(),
                        Value::String(prepared.path.to_string_lossy().to_string()),
                    );
                    obj.insert("downloaded".into(), Value::Bool(prepared.downloaded));
                }
                Ok(result)
            });
            Ok(Reply::Later)
        }
        "tool.remove" => {
            ctx.require("tool.exec")?;
            let name = req_str(p, "name")?;
            let spec = find_spec(&tools, &name)?.clone();
            let dir = dir.clone();
            let id = id.clone();
            ctx.spawn_reply(move || {
                let path = tool_dir(&dir, &id).join(spec.file_name()?);
                let _ = std::fs::remove_file(&path);
                let _ = std::fs::remove_file(meta_path(&path));
                Ok(json!({ "name": spec.name, "removed": !path.exists() }))
            });
            Ok(Reply::Later)
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

pub struct Prepared {
    pub path: PathBuf,
    pub downloaded: bool,
}

fn find_spec<'a>(tools: &'a [ToolSpec], name: &str) -> BridgeResult<&'a ToolSpec> {
    tools
        .iter()
        .find(|t| t.name.eq_ignore_ascii_case(name.trim()))
        .ok_or_else(|| {
            BridgeError::new(format!(
                "the widget does not declare a tool called \"{name}\""
            ))
        })
}

fn tool_dir(dir: &Path, id: &str) -> PathBuf {
    if !crate::core::assets::is_virtual(dir) {
        dir.join("bin")
    } else {
        // Built-in widgets live in the exe and have no writable folder; keep their tools in the
        // data folder instead. Normal installed widgets never take this branch.
        crate::core::paths::get().db_dir().join("tools").join(id)
    }
}

fn status_value(dir: &Path, id: &str, spec: &ToolSpec) -> Value {
    let file_name = spec.file_name().unwrap_or_default();
    let path = tool_dir(dir, id).join(&file_name);
    let cached = cache_is_fresh(&path, spec).unwrap_or(false);
    json!({
        "name": spec.name,
        "filename": file_name,
        "url": spec.url,
        "sha256": spec.sha256.as_ref().map(|s| s.to_lowercase()),
        "size": spec.size,
        "path": path.to_string_lossy(),
        "cached": cached,
        "downloaded": path.is_file(),
        "bytes": file_len(&path),
    })
}

pub fn ensure_tool(
    dir: &Path,
    id: &str,
    allowed: &[String],
    spec: &ToolSpec,
    force: bool,
) -> Result<Prepared, String> {
    let dir = tool_dir(dir, id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = dir.join(spec.file_name()?);
    let meta = meta_path(&path);

    if !force {
        if let Some(prepared) = cached_tool(&path, &meta, spec)? {
            return Ok(prepared);
        }
    }

    // Two cards asking for the same tool at once should not write the same .part file. A global
    // lock is cheap here because downloads are rare and never on the UI thread.
    let _guard = download_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !force {
        if let Some(prepared) = cached_tool(&path, &meta, spec)? {
            return Ok(prepared);
        }
    }

    let part = dir.join(format!("{}.part", spec.file_name()?));
    let _ = std::fs::remove_file(&part);
    let (downloaded, actual) = match download_to(spec, allowed, &part) {
        Ok(pair) => pair,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    };

    if let Some(expected) = spec.size {
        if downloaded != expected {
            let _ = std::fs::remove_file(&part);
            return Err(format!(
                "tool \"{}\" is {downloaded} bytes, expected {expected}",
                spec.name
            ));
        }
    }
    if let Some(expected) = &spec.sha256 {
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&part);
            return Err(format!(
                "tool \"{}\" failed its SHA-256 check (got {actual})",
                spec.name
            ));
        }
    }

    // Windows refuses a rename over an existing file. The verified .part is complete at this point,
    // so replacing the old copy is safe.
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&part, &path)
        .map_err(|e| format!("could not install {}: {e}", path.display()))?;
    let _ = write_meta(&path, spec);
    Ok(Prepared {
        path,
        downloaded: true,
    })
}

fn cached_tool(path: &Path, meta: &Path, spec: &ToolSpec) -> Result<Option<Prepared>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    if cache_is_fresh(path, spec)? {
        return Ok(Some(Prepared {
            path: path.to_path_buf(),
            downloaded: false,
        }));
    }

    // No sidecar, or the file changed since we verified it. When a hash is declared, hash the
    // existing file before deciding to download again; without one there is nothing to compare.
    let size = file_len(path);
    let size_matches = spec.size.map(|n| n == size).unwrap_or(true);
    let hash_matches = match &spec.sha256 {
        Some(expected) => sha256_file(path)?.eq_ignore_ascii_case(expected),
        None => true,
    };
    if size_matches && hash_matches {
        let _ = write_meta(path, spec);
        return Ok(Some(Prepared {
            path: path.to_path_buf(),
            downloaded: false,
        }));
    }
    let _ = std::fs::remove_file(meta);
    Ok(None)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedMeta {
    url: String,
    sha256: Option<String>,
    size: u64,
    mtime: u64,
}

fn meta_path(path: &Path) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(".json");
    PathBuf::from(os)
}

fn cache_is_fresh(path: &Path, spec: &ToolSpec) -> Result<bool, String> {
    let meta = match std::fs::read(meta_path(path)) {
        Ok(bytes) => match serde_json::from_slice::<CachedMeta>(&bytes) {
            Ok(meta) => meta,
            Err(_) => return Ok(false),
        },
        Err(_) => return Ok(false),
    };
    let file = match std::fs::metadata(path) {
        Ok(file) => file,
        Err(_) => return Ok(false),
    };
    let size = file.len();
    let hash_matches = match (&meta.sha256, &spec.sha256) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        (None, None) => true,
        _ => false,
    };
    let stale = !meta.url.eq_ignore_ascii_case(&spec.url)
        || !hash_matches
        || meta.size != size
        || meta.mtime != mtime_stamp(&file)
        || spec.size.map(|n| n != size).unwrap_or(false);
    Ok(!stale)
}

fn write_meta(path: &Path, spec: &ToolSpec) -> Result<(), String> {
    let file = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let meta = CachedMeta {
        url: spec.url.clone(),
        sha256: spec.sha256.as_ref().map(|s| s.to_lowercase()),
        size: file.len(),
        mtime: mtime_stamp(&file),
    };
    let bytes = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(meta_path(path), bytes).map_err(|e| e.to_string())
}

fn mtime_stamp(meta: &std::fs::Metadata) -> u64 {
    // Nanoseconds since 1970. Storing whole seconds would let a same-size replacement within the
    // same second keep the old sidecar; nanoseconds make that vanishingly unlikely.
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

pub fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn download_to(spec: &ToolSpec, allowed: &[String], part: &Path) -> Result<(u64, String), String> {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .redirects(0);
    if let Some(address) = crate::core::net::system_proxy() {
        match ureq::Proxy::new(&address) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(e) => crate::core::logging::warn(&format!("ignoring proxy {address}: {e}")),
        }
    }
    let agent = builder.build();
    let mut url = spec.url.clone();

    for _ in 0..=MAX_REDIRECTS {
        let (scheme, host) = crate::core::net::split_url(&url)?;
        if scheme != "https" {
            return Err("tools can only be downloaded over https".into());
        }
        if !crate::core::net::allows_host(allowed, &host) {
            return Err(format!(
                "\"{host}\" is not allowed: add \"network:{host}\" to permissions in widget.json and allow it in the control center"
            ));
        }

        let response = match agent
            .request("GET", &url)
            .set("User-Agent", &format!("WinWidget/{}", crate::APP_VERSION))
            .set("Accept", "application/octet-stream")
            .call()
        {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                if matches!(code, 301 | 302 | 303 | 307 | 308) {
                    let next = r
                        .header("Location")
                        .ok_or_else(|| format!("HTTP {code} from {url} has no Location"))?;
                    url = crate::core::net::join_url(&url, next);
                    continue;
                }
                return Err(format!("download failed: HTTP {code} from {url}"));
            }
            Err(ureq::Error::Transport(e)) => return Err(format!("download failed: {e}")),
        };

        let status = response.status();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            let next = response
                .header("Location")
                .ok_or_else(|| format!("HTTP {status} from {url} has no Location"))?;
            url = crate::core::net::join_url(&url, next);
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(format!("download failed: HTTP {status} from {url}"));
        }
        if let Some(length) = response
            .header("Content-Length")
            .and_then(|s| s.parse::<u64>().ok())
        {
            if length > MAX_BIN_BYTES {
                return Err(format!(
                    "tool \"{}\" is {length} bytes, larger than the 512 MB limit",
                    spec.name
                ));
            }
            if let Some(expected) = spec.size {
                if length != expected {
                    return Err(format!(
                        "tool \"{}\" is {length} bytes, expected {expected}",
                        spec.name
                    ));
                }
            }
        }

        let mut file = std::fs::File::create(part)
            .map_err(|e| format!("could not write {}: {e}", part.display()))?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut reader = response.into_reader();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("download failed while reading: {e}"))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_BIN_BYTES {
                return Err("tool is larger than the 512 MB limit".into());
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n])
                .map_err(|e| format!("could not write {}: {e}", part.display()))?;
        }
        file.flush().map_err(|e| e.to_string())?;
        // The bytes were hashed as they arrived, so there is no need to read a possibly 512 MB
        // file a second time just to verify it.
        return Ok((total, hex(&hasher.finish())));
    }
    Err("too many redirects while downloading the tool".into())
}

fn run_args(p: &Value) -> BridgeResult<Vec<String>> {
    let Some(value) = p.get("args") else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(BridgeError::new("args must be an array of strings"));
    };
    if items.len() > MAX_ARGS {
        return Err(BridgeError::new(format!(
            "at most {MAX_ARGS} arguments are allowed"
        )));
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let text = item
            .as_str()
            .ok_or_else(|| BridgeError::new("every argument must be a string"))?;
        if text.len() > MAX_ARG_LEN || text.contains('\0') {
            return Err(BridgeError::new(format!(
                "an argument is longer than {MAX_ARG_LEN} bytes or contains a NUL"
            )));
        }
        out.push(text.to_string());
    }
    Ok(out)
}

fn work_dir(dir: &Path, id: &str, requested: Option<&str>) -> Result<PathBuf, String> {
    if crate::core::assets::is_virtual(dir) {
        return Ok(tool_dir(dir, id));
    }
    match requested {
        Some(rel) if !rel.trim().is_empty() => crate::core::paths::resolve_inside(dir, rel)
            .ok_or_else(|| format!("cwd \"{rel}\" is not a folder inside the widget")),
        _ => Ok(dir.to_path_buf()),
    }
}

pub fn execute(
    program: &Path,
    args: &[String],
    stdin: Option<&str>,
    cwd: &Path,
    timeout_ms: u64,
) -> Result<Value, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", program.display()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_reader = stdout.map(|r| std::thread::spawn(move || read_limited(r)));
    let err_reader = stderr.map(|r| std::thread::spawn(move || read_limited(r)));
    let writer = stdin.map(|text| {
        let mut pipe = child.stdin.take().expect("piped stdin");
        let text = text.to_string();
        std::thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
        })
    });

    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("could not wait for {}: {e}", program.display())),
        }
    };
    let _ = writer.map(|w| w.join());

    let (stdout, stdout_truncated) = out_reader
        .and_then(|r| r.join().ok())
        .unwrap_or_else(|| (Vec::new(), false));
    let (stderr, stderr_truncated) = err_reader
        .and_then(|r| r.join().ok())
        .unwrap_or_else(|| (Vec::new(), false));

    Ok(json!({
        "code": status.and_then(|s| s.code()).unwrap_or(-1),
        "ok": !timed_out && status.map(|s| s.success()).unwrap_or(false),
        "timedOut": timed_out,
        "durationMs": started.elapsed().as_millis() as u64,
        "stdout": String::from_utf8_lossy(&stdout),
        "stderr": String::from_utf8_lossy(&stderr),
        "stdoutTruncated": stdout_truncated,
        "stderrTruncated": stderr_truncated,
    }))
}

fn read_limited<R: Read + Send + 'static>(reader: R) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let _ = reader.take(MAX_OUTPUT as u64 + 1).read_to_end(&mut out);
    let truncated = out.len() > MAX_OUTPUT;
    if truncated {
        out.truncate(MAX_OUTPUT);
    }
    (out, truncated)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finish()))
}

pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// A small SHA-256 implementation so the host does not need another dependency just to verify a
/// downloaded executable. The unit tests cover the standard vectors.
pub struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffered: usize,
    length: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    pub fn new() -> Self {
        Sha256 {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
                0x5be0cd19,
            ],
            buffer: [0; 64],
            buffered: 0,
            length: 0,
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.length = self.length.wrapping_add(data.len() as u64);
        if self.buffered > 0 {
            let take = (64 - self.buffered).min(data.len());
            self.buffer[self.buffered..self.buffered + take].copy_from_slice(&data[..take]);
            self.buffered += take;
            data = &data[take..];
            if self.buffered == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffered = 0;
            }
        }
        while data.len() >= 64 {
            let mut block = [0u8; 64];
            block.copy_from_slice(&data[..64]);
            self.compress(&block);
            data = &data[64..];
        }
        if !data.is_empty() {
            self.buffer[..data.len()].copy_from_slice(data);
            self.buffered = data.len();
        }
    }

    pub fn finish(mut self) -> [u8; 32] {
        let bit_len = self.length.wrapping_mul(8);
        // 0x80, zeros until the block has 56 bytes, then the 64-bit length. Appending exactly
        // 64 bytes after the 56-byte point lets `update` compress the final block.
        let mut tail = Vec::with_capacity(72);
        tail.push(0x80);
        while (self.buffered + tail.len()) % 64 != 56 {
            tail.push(0);
        }
        tail.extend_from_slice(&bit_len.to_be_bytes());
        self.update(&tail);
        let mut out = [0u8; 32];
        for (i, word) in self.state.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }
        out
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }
}

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
