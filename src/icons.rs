//! Widget icons and preview pictures, turned into data URLs / local URLs the control center can
//! show. Both are cached by path + modification time.

use crate::manifest::Manifest;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

static CACHE: Mutex<Option<HashMap<String, (u64, String)>>> = Mutex::new(None);
/// `preview_variants` walks the folder once per theme/language pair, so its result is cached too.
static PREVIEWS: Mutex<Option<HashMap<String, (u64, Vec<String>)>>> = Mutex::new(None);

fn mtime(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// The widget's icon as a `data:` URL, at most `size` pixels wide.
pub fn icon_data_url(manifest: &Manifest, size: u32) -> Option<String> {
    let rel = manifest.icon.as_deref()?.trim();
    if rel.is_empty() {
        return None;
    }
    let path = crate::paths::resolve_inside(&manifest.dir, rel)?;
    if !path.is_file() {
        return None;
    }
    let key = format!("icon:{}:{size}", path.to_string_lossy());
    let stamp = mtime(&path);
    {
        let mut guard = CACHE.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some((old, value)) = map.get(&key) {
            if *old == stamp {
                return Some(value.clone());
            }
        }
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let value = if ext == "svg" {
        let text = crate::util::read_text(&path).ok()?;
        format!(
            "data:image/svg+xml;base64,{}",
            crate::platform::win32::base64(text.as_bytes())
        )
    } else {
        let bytes = std::fs::read(&path).ok()?;
        let png = crate::img::thumbnail_bytes(&bytes, size).ok()?;
        format!(
            "data:image/png;base64,{}",
            crate::platform::win32::base64(&png)
        )
    };
    CACHE
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(key, (stamp, value.clone()));
    Some(value)
}

/// Where the picture in the library comes from.
pub fn preview_url(manifest: &Manifest, theme: &str, lang: &str) -> Option<String> {
    let template = manifest.preview.as_deref()?.trim();
    if template.is_empty() {
        return None;
    }
    let rel = template
        .replace("{theme}", theme)
        .replace("{lang}", lang)
        .replace('\\', "/");
    let path = crate::paths::resolve_inside(&manifest.dir, &rel)?;
    if !path.is_file() {
        return None;
    }
    let folder = manifest
        .dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let kind = if manifest.builtin { "builtin" } else { "user" };
    Some(format!(
        "/__preview/{kind}/{folder}/{rel}?v={}",
        mtime(&path)
    ))
}

/// Every preview file the widget ships, so the page can pick one that exists in its language.
pub fn preview_variants(manifest: &Manifest, themes: &[String]) -> Vec<String> {
    let Some(template) = manifest.preview.as_deref() else {
        return Vec::new();
    };
    let cache_key = format!(
        "{}|{}|{}",
        manifest.dir.display(),
        template,
        themes.join(",")
    );
    let folder_stamp = mtime(&manifest.dir);
    {
        let mut guard = PREVIEWS.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some((stamp, list)) = map.get(&cache_key) {
            if *stamp == folder_stamp {
                return list.clone();
            }
        }
    }
    let list = collect_previews(manifest, template, themes);
    {
        let mut guard = PREVIEWS.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(cache_key, (folder_stamp, list.clone()));
    }
    list
}

fn collect_previews(manifest: &Manifest, template: &str, themes: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let Some(folder) = manifest.dir.file_name().and_then(|n| n.to_str()) else {
        return out;
    };
    let langs = ["zh-TW", "zh-CN", "en"];
    let mut push = |rel: String| {
        let path = crate::paths::resolve_inside(&manifest.dir, &rel);
        if let Some(path) = path {
            if path.is_file() {
                let kind = if manifest.builtin { "builtin" } else { "user" };
                out.push(format!(
                    "/__preview/{kind}/{folder}/{rel}?v={}",
                    mtime(&path)
                ));
            }
        }
    };
    if !template.contains('{') {
        push(template.replace('\\', "/"));
        return out;
    }
    for theme in themes {
        for lang in langs {
            push(
                template
                    .replace("{theme}", &theme)
                    .replace("{lang}", lang)
                    .replace('\\', "/"),
            );
        }
    }
    out
}
