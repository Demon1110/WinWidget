//! uTools `.upx` 包：gzip 包着「`4、h1、h2、jsonLen` 四个 u32 头 + JSON 目录 + 1 字节 + 数据区」。
//!
//! uTools 的插件是 `plugin.json`（`pluginName` / `main` / `logo` / `features`），而 WinWidget 的
//! 组件是 `widget.json`。这里只做一件事：把 `.upx` 摊成 WinWidget 能认的目录（文件原样写出，另外
//! 生成一份 `widget.json`），之后走的就是普通的「按文件夹安装」流程。页面里的 `utools` 由宿主注入
//! （见 `ui/server.rs` 的 `inject_page`），所以不用改插件自己的 HTML。

use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;

/// `.upx` 解出来的信息，形状和 `packages::Staged` 需要的字段一致。
pub struct Summary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    /// `plugin.json` 里有 `preload`：需要 Node.js，这个宿主给不了。
    pub node: bool,
}

const HEADER_BYTES: usize = 16;
const MAX_TOTAL: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 4000;

/// 是不是 uTools 包：后缀叫 `.upx`，或者内容是 gzip（有些站点下载时会改后缀）。
pub fn is_upx(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("upx"))
        .unwrap_or(false)
    {
        return true;
    }
    match std::fs::read(path) {
        Ok(bytes) => bytes.len() > 3 && bytes[0] == 0x1f && bytes[1] == 0x8b,
        Err(_) => false,
    }
}

/// 把 `.upx` 写进 `dir`，顺带生成 `widget.json`。
pub fn unpack(path: &Path, dir: &Path) -> Result<Summary, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("the file could not be read: {e}"))?;
    if bytes.len() < HEADER_BYTES + 2 || bytes[0] != 0x1f || bytes[1] != 0x8b {
        return Err("this is not a uTools .upx package".into());
    }
    let mut raw = Vec::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_end(&mut raw)
        .map_err(|e| format!("the .upx body could not be inflated: {e}"))?;

    let json_end = json_end(&raw).ok_or_else(|| "the .upx directory is not valid JSON".to_string())?;
    let text = std::str::from_utf8(&raw[HEADER_BYTES..json_end])
        .map_err(|e| format!("the .upx directory is not text: {e}"))?;
    let tree: Value =
        serde_json::from_str(text).map_err(|e| format!("the .upx directory is not valid JSON: {e}"))?;
    // 目录后面补到 4 字节边界，数据区的偏移都从这个字节之后算起。
    let base = (json_end + 3) & !3;

    let mut entries: Vec<(String, usize, usize)> = Vec::new();
    walk(&tree, "", &mut entries);
    if entries.is_empty() {
        return Err("the .upx package has no files".into());
    }
    if entries.len() > MAX_ENTRIES {
        return Err("the package has too many files".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("staging folder: {e}"))?;

    let mut total: u64 = 0;
    for (rel, offset, size) in &entries {
        let name = rel.rsplit('/').next().unwrap_or(rel);
        if skip_file(name) {
            continue;
        }
        let end = base
            .checked_add(*offset)
            .and_then(|s| s.checked_add(*size))
            .ok_or_else(|| format!("the .upx offset of \"{rel}\" is out of range"))?;
        if end > raw.len() {
            return Err(format!("the .upx offset of \"{rel}\" is out of range"));
        }
        total += *size as u64;
        if total > MAX_TOTAL {
            return Err("the package is larger than 64 MB".into());
        }
        write_entry(dir, rel, &raw[base + *offset..end])?;
    }

    synthesize(dir)
}

/// `.upxs` 是 uTools 自 v5.0.0 起的新市场安装包：加密 + 开发者签名。宿主没有密钥，读不出内容。
pub const UPXS_HINT: &str = "this is a uTools UPXS package (encrypted and signed since uTools 5.0). \
WinWidget has no key for it, so the files cannot be read here. Install it in uTools first, then \
import the plugin from %APPDATA%\\uTools\\plugins\\<hash>.asar";

/// 后缀是 `.upxs`（内容是整块密文，没有可识别的明文头）。
pub fn is_upxs(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("upxs"))
        .unwrap_or(false)
}

/// 是不是 Electron 的 `.asar`：uTools 把装好的插件以这种未加密的归档放在 `plugins\` 下。
pub fn is_asar(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("asar"))
        .unwrap_or(false)
}

/// 把 uTools 已安装插件目录里的 `.asar` 摊进 `dir`，顺带生成 `widget.json`。
///
/// 布局跟 `.upx` 很像，但头不一样：`[u32 4][u32 pickle][u32 ...][u32 jsonLen]` 之后是 JSON 目录，
/// 目录项是 `{size, offset:"…", unpacked?, link?}`，数据区起点 = `8 + pickle`。
pub fn unpack_asar(path: &Path, dir: &Path) -> Result<Summary, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("the file could not be read: {e}"))?;
    if bytes.len() < HEADER_BYTES + 2 {
        return Err("this is not an Electron .asar archive".into());
    }
    let header = u32_at(&bytes, 4).ok_or_else(|| "the .asar header is truncated".to_string())?;
    let data_start = 8usize
        .checked_add(header as usize)
        .filter(|s| *s <= bytes.len())
        .ok_or_else(|| "the .asar header is larger than the file".to_string())?;
    let json_end = json_end(&bytes).ok_or_else(|| "the .asar directory is not valid JSON".to_string())?;
    if json_end > data_start {
        return Err("the .asar directory overlaps its payload".into());
    }
    let text = std::str::from_utf8(&bytes[HEADER_BYTES..json_end])
        .map_err(|e| format!("the .asar directory is not text: {e}"))?;
    let tree: Value =
        serde_json::from_str(text).map_err(|e| format!("the .asar directory is not valid JSON: {e}"))?;

    let mut entries: Vec<AsarEntry> = Vec::new();
    walk_asar(&tree, "", &mut entries);
    if entries.is_empty() {
        return Err("the .asar archive has no files".into());
    }
    if entries.len() > MAX_ENTRIES {
        return Err("the package has too many files".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("staging folder: {e}"))?;

    // 被 `unpacked` 标记的文件放在旁边的 `<name>.asar.unpacked\` 目录里。
    let unpacked_root = path
        .parent()
        .map(|p| {
            p.join(format!(
                "{}.unpacked",
                path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            ))
        })
        .unwrap_or_default();

    let mut total: u64 = 0;
    for entry in &entries {
        if skip_file(entry.rel.rsplit('/').next().unwrap_or(&entry.rel)) {
            continue;
        }
        total += entry.size as u64;
        if total > MAX_TOTAL {
            return Err("the package is larger than 64 MB".into());
        }
        if entry.unpacked {
            let src = unpacked_root.join(entry.rel.replace('/', std::path::MAIN_SEPARATOR_STR));
            let body = std::fs::read(&src)
                .map_err(|e| format!("the unpacked file \"{}\" is missing: {e}", entry.rel))?;
            write_entry(dir, &entry.rel, &body)?;
            continue;
        }
        let end = data_start
            .checked_add(entry.offset)
            .and_then(|s| s.checked_add(entry.size))
            .ok_or_else(|| format!("the .asar offset of \"{}\" is out of range", entry.rel))?;
        if end > bytes.len() {
            return Err(format!("the .asar offset of \"{}\" is out of range", entry.rel));
        }
        write_entry(dir, &entry.rel, &bytes[data_start + entry.offset..end])?;
    }

    synthesize(dir)
}

/// 读 `plugin.json`，写一份 `widget.json`，返回给 `packages` 看的摘要。
fn synthesize(dir: &Path) -> Result<Summary, String> {
    let plugin = crate::core::util::read_text(&dir.join("plugin.json"))
        .map_err(|e| format!("the package has no plugin.json: {e}"))?;
    let plugin: Value =
        serde_json::from_str(plugin.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("plugin.json is not valid JSON: {e}"))?;

    let plugin_name = str_of(&plugin, "pluginName", &str_of(&plugin, "name", "uTools plugin"));
    // uTools 用 `name` 当插件 id（一串小写字母数字）；不合格或缺失时按插件名散列一个稳定的 id。
    let id = str_of(&plugin, "name", "")
        .to_lowercase()
        .trim()
        .to_string();
    let id = if valid_id(&id) {
        id
    } else {
        format!("uplugin-{}", hash(&plugin_name))
    };

    let entry = pick_entry(dir, &str_of(&plugin, "main", "index.html"));
    let icon = {
        let logo = str_of(&plugin, "logo", "");
        if !logo.is_empty() && dir.join(&logo).is_file() {
            Value::String(logo)
        } else {
            Value::Null
        }
    };
    let preload = str_of(&plugin, "preload", "");
    let permissions = infer_permissions(dir);

    let mut manifest = json!({
        "id": id,
        "name": plugin_name,
        "description": str_of(&plugin, "description", ""),
        "version": str_of(&plugin, "version", "0.0.0"),
        "author": str_of(&plugin, "author", ""),
        "entry": entry,
        "category": "productivity",
        "size": {
            "width": 900.0, "height": 620.0,
            "minWidth": 360.0, "minHeight": 240.0,
            "maxWidth": 2000.0, "maxHeight": 2000.0,
            "resizable": true, "grow": 0.0
        },
        "permissions": permissions,
        // 留个痕：这是从 uTools 包转过来的，以及它原本声明了什么。
        "utools": {
            "pluginName": plugin_name,
            "preload": if preload.is_empty() { Value::Null } else { Value::String(preload.clone()) },
            "features": plugin.get("features").cloned().unwrap_or(Value::Null),
        },
    });
    if !icon.is_null() {
        if let Some(obj) = manifest.as_object_mut() {
            obj.insert("icon".into(), icon);
        }
    }
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("widget.json"), text).map_err(|e| format!("widget.json: {e}"))?;

    if !preload.is_empty() {
        crate::core::logging::info(&format!(
            "upx: \"{plugin_name}\" declares preload.js — Node.js is not available in this host"
        ));
    }

    Ok(Summary {
        id: manifest["id"].as_str().unwrap_or_default().to_string(),
        name: manifest["name"].as_str().unwrap_or_default().to_string(),
        version: manifest["version"].as_str().unwrap_or_default().to_string(),
        author: manifest["author"].as_str().unwrap_or_default().to_string(),
        description: manifest["description"].as_str().unwrap_or_default().to_string(),
        permissions: manifest["permissions"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        node: !preload.is_empty(),
    })
}

/// 目录 JSON 的结束位置（含右边的 `}`），从第 16 个字节开始是 `{`。
fn json_end(raw: &[u8]) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, b) in raw.iter().enumerate().skip(HEADER_BYTES) {
        if in_string {
            if escaped {
                escaped = false;
            } else if *b == b'\\' {
                escaped = true;
            } else if *b == b'"' {
                in_string = false;
            }
            continue;
        }
        match *b {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// 把目录树摊成 `(相对路径, 偏移, 大小)`。
fn walk(node: &Value, prefix: &str, out: &mut Vec<(String, usize, usize)>) {
    let Some(files) = node.get("files").and_then(|f| f.as_object()) else {
        return;
    };
    for (name, child) in files {
        if name.contains("..") || name.starts_with('/') {
            continue;
        }
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if child.get("files").is_some() {
            walk(child, &path, out);
            continue;
        }
        let size = child.get("size").and_then(number);
        let offset = child.get("offset").and_then(number);
        if let (Some(size), Some(offset)) = (size, offset) {
            out.push((path, offset, size));
        }
    }
}

fn number(v: &Value) -> Option<usize> {
    match v {
        Value::Number(n) => n.as_u64().map(|n| n as usize),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// 系统垃圾文件，uTools 打包时也会带上，没必要装。
fn skip_file(name: &str) -> bool {
    name == ".DS_Store" || name == "Thumbs.db"
}

fn write_entry(dir: &Path, rel: &str, body: &[u8]) -> Result<(), String> {
    let target = dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&target, body).map_err(|e| format!("{}: {e}", target.display()))
}

/// `.asar` 的目录项：偏移可能没有（`unpacked` 的文件放在旁边的目录里）。
struct AsarEntry {
    rel: String,
    offset: usize,
    size: usize,
    unpacked: bool,
}

fn walk_asar(node: &Value, prefix: &str, out: &mut Vec<AsarEntry>) {
    let Some(files) = node.get("files").and_then(|f| f.as_object()) else {
        return;
    };
    for (name, child) in files {
        if name.contains("..") || name.starts_with('/') {
            continue;
        }
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if child.get("files").is_some() {
            walk_asar(child, &path, out);
            continue;
        }
        // `link` 是 Electron 的硬链接（同一个文件换个名字），没必要单独再写一份。
        if child.get("link").is_some() {
            continue;
        }
        let Some(size) = child.get("size").and_then(number) else {
            continue;
        };
        let unpacked = child
            .get("unpacked")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let offset = child.get("offset").and_then(number).unwrap_or(0);
        out.push(AsarEntry {
            rel: path,
            offset,
            size,
            unpacked,
        });
    }
}

fn str_of(v: &Value, key: &str, fallback: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// 插件名多半是中文，取不出合法 id；用固定散列保证同一个插件每次装回来还是同一个 id。
fn hash(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", (h & 0xffff_ffff) as u32)
}

fn pick_entry(dir: &Path, main: &str) -> String {
    let main = main.trim();
    if !main.is_empty() && dir.join(main).is_file() {
        return main.replace('\\', "/");
    }
    for candidate in ["index.html", "dist/index.html", "public/index.html"] {
        if dir.join(candidate).is_file() {
            return candidate.to_string();
        }
    }
    "index.html".to_string()
}

/// 摊平目录下的所有文件（相对路径，`/` 分隔）。
fn files_under(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if path.is_dir() {
            files_under(&path, &rel, out);
        } else {
            out.push(rel);
        }
    }
}

/// 扫一遍页面代码，把看得见的 uTools 接口翻成 WinWidget 的权限名。
fn infer_permissions(dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    files_under(dir, "", &mut files);
    let mut text = String::new();
    let mut budget: u64 = 4 * 1024 * 1024;
    for rel in files {
        let lower = rel.to_lowercase();
        if !(lower.ends_with(".html") || lower.ends_with(".js")) {
            continue;
        }
        let Ok(bytes) = std::fs::read(dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)))
        else {
            continue;
        };
        budget = budget.saturating_sub(bytes.len() as u64);
        text.push_str(&String::from_utf8_lossy(&bytes).to_lowercase());
        if budget == 0 {
            break;
        }
    }
    let mut out: Vec<String> = Vec::new();
    let mut want = |hit: bool, name: &str| {
        if hit && !out.iter().any(|p| p == name) {
            out.push(name.to_string());
        }
    };
    let has = |needle: &str| text.contains(needle);
    want(
        has("utools.screen.") || has("capturescreen(") || has("screencolorpick"),
        "screen",
    );
    want(
        has("copytext(") || has("copyimage(") || has("copyfile(") || has("getcopyedfiles"),
        "clipboard",
    );
    want(
        has("hidemainwindowpastetext") || has("hidemainwindowpastefile") || has("hidemainwindowpasteimage"),
        "clipboard",
    );
    want(has("hidemainwindowtypestring") || has("simulatekeyboardtap") || has("simulatemouse"), "input");
    want(has("requestschedule(") || has("getschedules(") || has("removeschedule("), "schedule");
    want(has("utools.sharp"), "sharp");
    want(has("ubrowser"), "ubrowser");
    want(
        has("shellopenpath") || has("shellopenexternal"),
        "shell.open",
    );
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Builds a `.upx` the same way uTools does: gzip(4 u32 header + JSON + 1 byte + payloads).
    fn pack(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut json = String::from("{\"files\":{");
        let mut payload = Vec::new();
        for (i, (name, body)) in files.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "\"{name}\":{{\"size\":{},\"offset\":\"{}\",\"executable\":true}}",
                body.len(),
                payload.len()
            ));
            payload.extend_from_slice(body);
        }
        json.push_str("}}");
        let mut raw = Vec::new();
        let len = json.len() as u32;
        for n in [4u32, len + 9, len + 5, len] {
            raw.extend_from_slice(&n.to_le_bytes());
        }
        raw.extend_from_slice(json.as_bytes());
        // uTools 把目录补到 4 字节边界，数据区从这里开始。
        while raw.len() % 4 != 0 {
            raw.push(0);
        }
        raw.extend_from_slice(&payload);
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&raw).unwrap();
        gz.finish().unwrap()
    }

    fn sample() -> Vec<u8> {
        let plugin = r#"{"pluginName":"插件面板","name":"abc123","main":"index.html","version":"0.0.6","author":"me","logo":"logo.png","preload":"preload.js"}"#.as_bytes();
        let html = b"<html><head></head><body><script>utools.copyText('x')</script></body></html>";
        pack(&[
            ("plugin.json", plugin),
            ("index.html", html),
            ("logo.png", b"\x89PNG"),
            ("preload.js", b"const os = require('os')"),
        ])
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wwupx-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn unpacks_and_builds_a_manifest() {
        let dir = scratch("manifest");
        let file = dir.with_extension("upx");
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(&file, sample()).unwrap();
        let summary = unpack(&file, &dir).unwrap();
        assert_eq!(summary.id, "abc123", "plugin.json name is the id");
        assert_eq!(summary.name, "插件面板");
        assert_eq!(summary.version, "0.0.6");
        assert!(summary.node, "preload.js means Node is needed");
        assert!(summary.permissions.iter().any(|p| p == "clipboard"));
        let text = std::fs::read_to_string(dir.join("widget.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["entry"], "index.html");
        assert_eq!(value["icon"], "logo.png");
        let mut m = crate::model::manifest::Manifest::load(&dir, false).unwrap();
        m.validate().unwrap();
        let html = std::fs::read_to_string(dir.join("index.html")).unwrap();
        assert!(html.contains("utools.copyText"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn falls_back_to_a_hash_id_for_a_chinese_name() {
        let dir = scratch("hash");
        let file = dir.with_extension("upx");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            &file,
            pack(&[
                (
                    "plugin.json",
                    r#"{"pluginName":"找两列差异","main":"index.html"}"#.as_bytes(),
                ),
                ("index.html", b"<html></html>"),
            ]),
        )
        .unwrap();
        let summary = unpack(&file, &dir).unwrap();
        assert!(summary.id.starts_with("uplugin-"), "id was {}", summary.id);
        assert_eq!(summary.id.len(), "uplugin-".len() + 8);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 拿真实的 uTools 包当回归样本：`WW_UPX_SAMPLES` 是 `;` 分隔的路径列表。
    #[test]
    fn real_samples_still_open() {
        let Ok(list) = std::env::var("WW_UPX_SAMPLES") else {
            return;
        };
        for (i, path) in list.split(';').filter(|p| !p.trim().is_empty()).enumerate() {
            let dir = scratch(&format!("real-{i}"));
            let summary = unpack(Path::new(path), &dir).unwrap();
            assert!(!summary.name.is_empty());
            let mut m = crate::model::manifest::Manifest::load(&dir, false).unwrap();
            m.validate().unwrap();
            println!(
                "{} -> {} {} permissions={:?} node={}",
                Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                summary.name,
                summary.id,
                summary.permissions,
                summary.node
            );
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    /// 造一个最小的 `.asar`：`[4][len+8][len+4][len]` + JSON 目录 + 数据区。
    fn pack_asar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut json = String::from("{\"files\":{");
        let mut payload = Vec::new();
        for (i, (name, body)) in files.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "\"{name}\":{{\"size\":{},\"offset\":\"{}\"}}",
                body.len(),
                payload.len()
            ));
            payload.extend_from_slice(body);
        }
        json.push_str("}}");
        let mut text = json.into_bytes();
        while text.len() % 4 != 0 {
            text.push(b' ');
        }
        let mut raw = Vec::new();
        let len = text.len() as u32;
        for n in [4u32, len + 8, len + 4, len] {
            raw.extend_from_slice(&n.to_le_bytes());
        }
        raw.extend_from_slice(&text);
        raw.extend_from_slice(&payload);
        raw
    }

    #[test]
    fn opens_an_installed_utools_plugin_asar() {
        let dir = scratch("asar");
        let file = dir.with_extension("asar");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            &file,
            pack_asar(&[
                (
                    "plugin.json",
                    r#"{"pluginName":"剪贴板","name":"clipboard","main":"index.html","version":"4.3.2","author":"uTools 团队"}"#.as_bytes(),
                ),
                ("index.html", b"<html><body></body></html>"),
                ("logo.png", b"\x89PNG"),
            ]),
        )
        .unwrap();
        let summary = unpack_asar(&file, &dir).unwrap();
        assert_eq!(summary.id, "clipboard");
        assert_eq!(summary.name, "剪贴板");
        assert_eq!(summary.version, "4.3.2");
        assert!(!summary.node, "this sample has no preload");
        let mut m = crate::model::manifest::Manifest::load(&dir, false).unwrap();
        m.validate().unwrap();
        assert!(dir.join("index.html").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn upxs_packages_are_refused_with_a_reason() {
        let dir = scratch("upxs");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("plugin.upxs");
        std::fs::write(&file, [0xc8, 0x01, 0x00, 0x00, 0x99]).unwrap();
        assert!(is_upxs(&file));
        assert!(!is_upx(&file), "an .upxs is not a gzip .upx");
        assert!(UPXS_HINT.contains("encrypted"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 拿本机 uTools 已安装的插件当回归样本：`WW_ASAR_SAMPLES` 是 `;` 分隔的路径列表。
    #[test]
    fn real_asar_samples_still_open() {
        let Ok(list) = std::env::var("WW_ASAR_SAMPLES") else {
            return;
        };
        for (i, path) in list.split(';').filter(|p| !p.trim().is_empty()).enumerate() {
            let dir = scratch(&format!("asar-real-{i}"));
            let summary = unpack_asar(Path::new(path), &dir).unwrap();
            let mut m = crate::model::manifest::Manifest::load(&dir, false).unwrap();
            m.validate().unwrap();
            println!(
                "{} -> {} {} v{} permissions={:?} node={}",
                Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                summary.name,
                summary.id,
                summary.version,
                summary.permissions,
                summary.node
            );
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }
}