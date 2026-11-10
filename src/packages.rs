//! `.fwz` packages: a zip of one widget folder. Importing stages it, shows the user what the
//! package wants, and only installs once they say yes.

use crate::app::App;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 4000;
const MAX_TOTAL: u64 = 64 * 1024 * 1024;

pub struct Staged {
    pub token: String,
    pub archive: PathBuf,
    pub source: PathBuf,
    pub dir: PathBuf,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub new_permissions: Vec<String>,
    pub unknown: Vec<String>,
    pub update: Option<Value>,
    pub existing: bool,
}

/// Reads the archive without touching disk layout: which widget it is, and what changes.
pub fn stage(app: &App, path: &Path) -> Result<Staged, String> {
    let token = crate::config::new_id();
    let dir = crate::paths::get().staging_dir().join(&token);
    let file = std::fs::File::open(path).map_err(|e| format!("the file could not be opened: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("this is not a widget package: {e}"))?;

    let mut manifest_name: Option<(String, String)> = None;
    for index in 0..archive.len() {
        let entry = match archive.by_index(index) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let raw = entry.name().map(|n| n.to_string()).unwrap_or_default();
        let normalised = raw.replace('\\', "/");
        let lower = normalised.to_lowercase();
        if lower.ends_with("widget.json") {
            let depth = normalised.matches('/').count();
            if manifest_name.as_ref().map(|(_, n)| depth < n.matches('/').count()).unwrap_or(true) {
                manifest_name = Some((raw.clone(), normalised.clone()));
            }
        }
    }
    let (raw_manifest, manifest_path) =
        manifest_name.ok_or_else(|| "the package has no widget.json".to_string())?;
    let prefix = manifest_path
        .rfind('/')
        .map(|i| manifest_path[..=i].to_string())
        .unwrap_or_default();

    let text = {
        let mut entry = archive
            .by_name(&raw_manifest)
            .map_err(|e| format!("widget.json could not be read: {e}"))?;
        let mut text = String::new();
        entry
            .read_to_string(&mut text)
            .map_err(|e| format!("widget.json could not be read: {e}"))?;
        text
    };
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("widget.json is not valid JSON: {e}"))?;

    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return Err("widget.json has no \"id\"".into());
    }
    if id.to_lowercase().starts_with(crate::catalog::RESERVED_PREFIX) {
        return Err(format!(
            "\"{id}\" starts with \"{}\", which is kept for the built-in widgets",
            crate::catalog::RESERVED_PREFIX
        ));
    }
    let name = crate::text::pick_value(value.get("name").unwrap_or(&Value::Null));
    let name = name.as_str().unwrap_or(&id).to_string();
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    let description = crate::text::pick_value(value.get("description").unwrap_or(&Value::Null))
        .as_str()
        .unwrap_or("")
        .to_string();
    let author = value
        .get("author")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let permissions: Vec<String> = value
        .get("permissions")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
        .unwrap_or_default();
    let unknown: Vec<String> = permissions
        .iter()
        .filter(|p| !crate::permissions::is_known(p))
        .cloned()
        .collect();

    // Extract, refusing anything that would land outside the staging folder.
    std::fs::create_dir_all(&dir).map_err(|e| format!("staging folder: {e}"))?;
    let mut total: u64 = 0;
    if archive.len() > MAX_ENTRIES {
        return Err("the package has too many files".into());
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let raw = entry.name().map(|n| n.to_string()).unwrap_or_default();
        let normalised = raw.replace('\\', "/");
        let Some(res) = normalised.strip_prefix(&prefix) else {
            continue;
        };
        if res.is_empty() {
            continue;
        }
        let parts: Vec<&str> = res.split('/').collect();
        if parts.iter().any(|c| *c == ".." || c.is_empty()) || res.starts_with('/') {
            return Err(format!("the package contains an unsafe path: {raw}"));
        }
        let target = dir.join(res.replace('/', std::path::MAIN_SEPARATOR_STR));
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&target);
            continue;
        }
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        total += entry.size();
        if total > MAX_TOTAL {
            return Err("the package is larger than 64 MB".into());
        }
        let mut out =
            std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("write failed: {e}"))?;
    }

    let existing = app.catalog.find(&id);
    let update = existing.map(|m| {
        let kind = compare(&version, &m.version);
        json!({
            "kind": kind,
            "from": m.version,
            "count": app.cfg().instances.iter().filter(|i| i.widget.eq_ignore_ascii_case(&id)).count(),
        })
    });
    let mut granted: Vec<String> = Vec::new();
    if let Some(list) = app.cfg().grants.get(&id) {
        granted = list.clone();
    }
    if let Some(m) = existing {
        for p in &m.permissions {
            if !granted.iter().any(|g| g.eq_ignore_ascii_case(p)) {
                granted.push(p.clone());
            }
        }
    }
    let mut new_permissions = Vec::new();
    for p in &permissions {
        if !granted.iter().any(|g| g.eq_ignore_ascii_case(p))
            && !app.cfg().own_widgets.iter().any(|w| w.eq_ignore_ascii_case(&id))
        {
            new_permissions.push(p.clone());
        }
    }

    Ok(Staged {
        token,
        archive: path.to_path_buf(),
        source: path.to_path_buf(),
        dir,
        id,
        name,
        version,
        author,
        description,
        permissions,
        new_permissions,
        unknown,
        update,
        existing: existing.is_some(),
    })
}

fn compare(a: &str, b: &str) -> &'static str {
    let pa: Vec<i64> = a.split('.').filter_map(|p| p.parse().ok()).collect();
    let pb: Vec<i64> = b.split('.').filter_map(|p| p.parse().ok()).collect();
    for i in 0..pa.len().max(pb.len()) {
        let x = *pa.get(i).unwrap_or(&0);
        let y = *pb.get(i).unwrap_or(&0);
        if x > y {
            return "newer";
        }
        if x < y {
            return "older";
        }
    }
    "same"
}

/// Moves the staged folder into the widgets directory and makes sure one card is on the desktop.
pub fn install(app: &mut App, token: &str) -> Result<Value, String> {
    let staged = app
        .staged
        .remove(token)
        .ok_or_else(|| "this install was cancelled or already finished".to_string())?;
    let result = install_staged(app, &staged);
    let _ = std::fs::remove_dir_all(&staged.dir);
    if result.is_err() {
        let _ = std::fs::remove_file(&staged.archive);
    }
    result
}

fn install_staged(app: &mut App, staged: &Staged) -> Result<Value, String> {
    let manifest = crate::manifest::Manifest::load(&staged.dir, false)?;
    let desktop = crate::paths::get().user_widgets_dir().join(&manifest.id);
    if desktop.exists() {
        crate::platform::win32::recycle_path(&desktop);
    }
    let _ = std::fs::create_dir_all(crate::paths::get().user_widgets_dir());
    copy_dir(&staged.dir, &desktop)?;
    app.catalog = crate::catalog::Catalog::default();
    app.catalog.scan();

    let before = app.cfg().instances.len();
    let id = app.add_widget(&manifest.id, None)?;
    let had_instance = app.cfg().instances.len() > before;
    app.push_state_to_control(None);
    Ok(json!({
        "name": manifest.display_name(),
        "version": manifest.version,
        "instanceId": if had_instance { Value::String(id) } else { Value::Null },
        "update": staged.update.is_some(),
    }))
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("{}: {e}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let dest = to.join(&name);
        if path.is_dir() {
            copy_dir(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)
                .map_err(|e| format!("{}: {e}", dest.display()))?;
        }
    }
    Ok(())
}

pub fn export(app: &App, widget_id: &str) -> Result<Value, String> {
    let manifest = app
        .catalog
        .find(widget_id)
        .ok_or_else(|| format!("no widget called {widget_id}"))?;
    let folder = manifest
        .dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("widget")
        .to_string();
    let out_dir = crate::paths::get().exports_dir();
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;
    let file_name = format!("{}-{}.fwz", folder, manifest.version);
    let out_path = out_dir.join(&file_name);
    let file = std::fs::File::create(&out_path).map_err(|e| format!("{}: {e}", out_path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    add_folder(&mut writer, &manifest.dir, &folder, options)?;
    writer.finish().map_err(|e| format!("the package could not be finished: {e}"))?;
    Ok(json!({
        "name": manifest.display_name(),
        "path": out_path.to_string_lossy(),
    }))
}

fn add_folder<W: Write + std::io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    root: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let inside = format!("{prefix}/{name}");
        if path.is_dir() {
            add_folder(writer, &path, &inside, options.clone())?;
        } else {
            let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            writer.start_file(inside, options.clone()).map_err(|e| e.to_string())?;
            writer.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Removes a user widget: its folder goes to the recycle bin and its cards disappear.
pub fn uninstall(app: &mut App, widget_id: &str) -> Result<Value, String> {
    let manifest = app
        .catalog
        .find(widget_id)
        .cloned()
        .ok_or_else(|| format!("no widget called {widget_id}"))?;
    if manifest.builtin {
        return Err("WinWidget's built-in widgets can't be uninstalled".into());
    }
    let ids: Vec<String> = app
        .cfg()
        .instances
        .iter()
        .filter(|i| i.widget.eq_ignore_ascii_case(&manifest.id))
        .map(|i| i.id.clone())
        .collect();
    for id in ids {
        app.remove_instance(&id);
    }
    crate::platform::win32::recycle_path(&manifest.dir);
    app.cfg_mut()
        .own_widgets
        .retain(|w| !w.eq_ignore_ascii_case(&manifest.id));
    app.cfg_mut().grants.remove(&manifest.id);
    app.save();
    app.catalog = crate::catalog::Catalog::default();
    app.catalog.scan();
    app.sync_serve();
    app.push_state_to_control(None);
    Ok(json!({ "name": manifest.display_name() }))
}

/// A brand-new widget folder under the user's widgets directory.
pub fn create(app: &mut App, name: &str) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a name is needed".into());
    }
    let mut slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    let slug = if slug.is_empty() {
        format!("widget-{}", &crate::config::new_id()[..6])
    } else {
        slug
    };
    let id = format!("local.{slug}");
    if app.catalog.find(&id).is_some() {
        return Err(format!("a widget called \"{id}\" already exists"));
    }
    let folder = crate::paths::get().user_widgets_dir().join(&id);
    std::fs::create_dir_all(&folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let template = crate::paths::get().templates_dir().join("widget");
    if template.is_dir() {
        copy_dir(&template, &folder)?;
    }
    let manifest_file = folder.join("widget.json");
    let mut value: Value = crate::util::read_text(&manifest_file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    let obj = value.as_object_mut().ok_or_else(|| "widget.json is not an object".to_string())?;
    obj.insert("id".into(), json!(id));
    obj.insert("name".into(), json!(name));
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&manifest_file, text).map_err(|e| e.to_string())?;
    if !folder.join("index.html").is_file() {
        std::fs::write(
            folder.join("index.html"),
            "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>Widget</title>\n<link rel=\"stylesheet\" href=\"/__fw/base.css\">\n</head>\n<body>\n<h1>Hello</h1>\n<script src=\"/__fw/widget-sdk.js\"></script>\n<script src=\"main.js\"></script>\n</body>\n</html>\n",
        )
        .map_err(|e| e.to_string())?;
    }
    if !folder.join("main.js").is_file() {
        std::fs::write(folder.join("main.js"), "// draw your widget here\n").map_err(|e| e.to_string())?;
    }

    app.cfg_mut().own_widgets.push(id.clone());
    app.cfg_mut().developer_mode = true;
    app.catalog = crate::catalog::Catalog::default();
    app.catalog.scan();
    app.save();
    let instance = app.add_widget(&id, None)?;
    crate::platform::shell::open(&folder.to_string_lossy())?;
    app.push_state_to_control(None);
    Ok(json!({ "id": id, "instanceId": instance }))
}
