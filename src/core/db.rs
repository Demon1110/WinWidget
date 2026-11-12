//! 数据库 category: a document store per widget, plus one attachment per document.
//!
//! uTools models this on PouchDB (`_id`, `_rev`, put/get/remove/allDocs/bulkDocs and attachments).
//! WinWidget keeps it as one JSON file per widget under `data/db/`, which is enough for the sizes
//! uTools allows (a document under 1 MB, an attachment under 10 MB) and needs no database engine.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

const OWNS: &[&str] = &[
    "db.put",
    "db.get",
    "db.remove",
    "db.bulkDocs",
    "db.allDocs",
    "db.postAttachment",
    "db.getAttachment",
    "db.getAttachmentType",
    "db.replicateStateFromCloud",
];

const MAX_DOC_BYTES: usize = 1024 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    let store = Store::for_widget(&ctx.manifest.id);
    match method {
        "db.put" => {
            let doc = p
                .get("doc")
                .cloned()
                .ok_or_else(|| BridgeError::new("doc is required"))?;
            let answered = store.put(doc)?;
            let id = answered.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                announce(ctx, &store, &[id]);
            }
            Ok(Reply::Now(answered))
        }
        "db.get" => {
            let id = jstr(p, "id").unwrap_or_default();
            Ok(Reply::Now(store.get(&id)))
        }
        "db.remove" => {
            let id = match p.get("doc") {
                Some(doc) => jstr(doc, "_id").unwrap_or_default(),
                None => jstr(p, "id").unwrap_or_default(),
            };
            let answered = store.remove(&id)?;
            announce(ctx, &store, &[id]);
            Ok(Reply::Now(answered))
        }
        "db.bulkDocs" => {
            let docs = p
                .get("docs")
                .and_then(|d| d.as_array())
                .cloned()
                .ok_or_else(|| BridgeError::new("docs is required"))?;
            let mut out = Vec::new();
            let mut written = Vec::new();
            for doc in docs {
                out.push(match store.put(doc) {
                    Ok(result) => {
                        if let Some(id) = result.get("id").and_then(|v| v.as_str()) {
                            written.push(id.to_string());
                        }
                        result
                    }
                    Err(e) => json!({ "ok": false, "error": e.0 }),
                });
            }
            if !written.is_empty() {
                announce(ctx, &store, &written);
            }
            Ok(Reply::Now(Value::Array(out)))
        }
        "db.allDocs" => {
            let prefix = jstr(p, "idStartsWith");
            let ids: Option<Vec<String>> = p.get("ids").and_then(|v| v.as_array()).map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            });
            Ok(Reply::Now(Value::Array(store.all(prefix.as_deref(), ids.as_deref()))))
        }
        "db.postAttachment" => {
            let id = jstr(p, "id").unwrap_or_default();
            let kind = jstr(p, "type").unwrap_or_else(|| "application/octet-stream".into());
            let data = p
                .get("data")
                .and_then(|d| d.as_str())
                .ok_or_else(|| BridgeError::new("data is required"))?;
            let bytes = w::base64_decode(data)
                .ok_or_else(|| BridgeError::new("data must be base64"))?;
            if bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(BridgeError::new("attachment is larger than 10 MB"));
            }
            Ok(Reply::Now(store.attach(&id, &kind, &bytes)?))
        }
        "db.getAttachment" => {
            let id = jstr(p, "id").unwrap_or_default();
            Ok(Reply::Now(match store.attachment(&id) {
                Some((kind, bytes)) => {
                    Value::String(format!("data:{kind};base64,{}", w::base64(&bytes)))
                }
                None => Value::Null,
            }))
        }
        "db.getAttachmentType" => {
            let id = jstr(p, "id").unwrap_or_default();
            Ok(Reply::Now(match store.attachment_type(&id) {
                Some(kind) => Value::String(kind),
                None => Value::Null,
            }))
        }
        // 0 means "synced", but there is no account behind this build, so `null` is the honest
        // answer uTools gives when cloud sync is off.
        "db.replicateStateFromCloud" => Ok(Reply::Now(Value::Null)),
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

/// Tells the widget's *other* cards what just changed, which is WinWidget's stand-in for uTools'
/// `onDbPull`: there is no cloud to sync from, but a second copy of the same widget on screen stays
/// in step with the first.
fn announce(ctx: &mut Ctx, store: &Store, ids: &[String]) {
    let widget = ctx.manifest.id.clone();
    let me = ctx.instance;
    let targets: Vec<String> = ctx
        .app
        .cfg()
        .instances
        .iter()
        .filter(|i| i.widget.eq_ignore_ascii_case(&widget) && i.id != me)
        .map(|i| i.id.clone())
        .collect();
    if targets.is_empty() {
        return;
    }
    let docs: Vec<Value> = ids
        .iter()
        .map(|id| store.get(id))
        .filter(|doc| !doc.is_null())
        .collect();
    if docs.is_empty() {
        return;
    }
    for instance in targets {
        ctx.app.event_to(
            &instance,
            "dbPull",
            json!({ "direction": "pull", "docs": docs }),
        );
    }
}

/// One widget's database: `{ "docs": { id: {…} }, "attachments": { id: type } }` plus a
/// `<id>.attachments/` folder for the bytes. Public inside the crate only so the clipboard can
/// hand a picture straight to a widget's attachment store.
pub(crate) struct Store {
    widget: String,
}

impl Store {
    pub(crate) fn for_widget(id: &str) -> Store {
        Store {
            widget: sanitize(id),
        }
    }

    /// Puts bytes behind `id` unless something is already stored there.
    ///
    /// The clipboard uses this so a picture lands in the widget's attachment store directly: the
    /// plugin reads `utools.db.getAttachment("attachment/<hash>")`, and copying a picture through
    /// the page first would move its bytes over the bridge for no reason.
    pub(crate) fn ensure_attachment(&self, id: &str, kind: &str, bytes: &[u8]) -> bool {
        if self.attachment_type(id).is_some() {
            return true;
        }
        self.attach(id, kind, bytes).is_ok()
    }

    fn file(&self) -> PathBuf {
        crate::core::paths::data_dir()
            .join("db")
            .join(format!("{}.json", self.widget))
    }

    fn attachment_dir(&self) -> PathBuf {
        crate::core::paths::data_dir()
            .join("db")
            .join(format!("{}.attachments", self.widget))
    }

    fn load(&self) -> Map<String, Value> {
        let text = std::fs::read_to_string(self.file()).unwrap_or_default();
        serde_json::from_str::<Map<String, Value>>(&text).unwrap_or_default()
    }

    fn save(&self, data: &Map<String, Value>) -> BridgeResult<()> {
        let file = self.file();
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| BridgeError::new(e.to_string()))?;
        }
        let text = serde_json::to_string_pretty(data).map_err(|e| BridgeError::new(e.to_string()))?;
        std::fs::write(&file, text).map_err(|e| BridgeError::new(e.to_string()))
    }

    fn put(&self, doc: Value) -> BridgeResult<Value> {
        let mut data = self.load();
        let mut docs = data
            .get("docs")
            .and_then(|d| d.as_object())
            .cloned()
            .unwrap_or_default();
        let id = jstr(&doc, "_id").unwrap_or_default();
        if id.is_empty() {
            return Err(BridgeError::new("doc._id is required"));
        }
        if serde_json::to_string(&doc).map(|s| s.len()).unwrap_or(0) > MAX_DOC_BYTES {
            return Err(BridgeError::new("a document must stay under 1 MB"));
        }
        let rev = next_rev(docs.get(&id));
        let mut stored = doc.as_object().cloned().unwrap_or_default();
        stored.insert("_id".into(), Value::String(id.clone()));
        stored.insert("_rev".into(), Value::String(rev.clone()));
        docs.insert(id.clone(), Value::Object(stored));
        data.insert("docs".into(), Value::Object(docs));
        self.save(&data)?;
        Ok(json!({ "id": id, "rev": rev, "ok": true }))
    }

    fn get(&self, id: &str) -> Value {
        self.load()
            .get("docs")
            .and_then(|d| d.get(id))
            .cloned()
            .unwrap_or(Value::Null)
    }

    fn remove(&self, id: &str) -> BridgeResult<Value> {
        if id.is_empty() {
            return Err(BridgeError::new("doc._id is required"));
        }
        let mut data = self.load();
        let mut docs = data
            .get("docs")
            .and_then(|d| d.as_object())
            .cloned()
            .unwrap_or_default();
        docs.remove(id);
        data.insert("docs".into(), Value::Object(docs));
        self.save(&data)?;
        Ok(json!({ "id": id, "ok": true }))
    }

    fn all(&self, prefix: Option<&str>, ids: Option<&[String]>) -> Vec<Value> {
        self.load()
            .get("docs")
            .and_then(|d| d.as_object())
            .map(|docs| {
                docs.iter()
                    .filter(|(id, _)| match (prefix, ids) {
                        (_, Some(ids)) => ids.iter().any(|x| x == *id),
                        (Some(prefix), None) => id.starts_with(prefix),
                        (None, None) => true,
                    })
                    .map(|(_, doc)| doc.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn attach(&self, id: &str, kind: &str, bytes: &[u8]) -> BridgeResult<Value> {
        if id.is_empty() {
            return Err(BridgeError::new("id is required"));
        }
        let dir = self.attachment_dir();
        std::fs::create_dir_all(&dir).map_err(|e| BridgeError::new(e.to_string()))?;
        std::fs::write(dir.join(sanitize(id)), bytes).map_err(|e| BridgeError::new(e.to_string()))?;
        let mut data = self.load();
        let mut list = data
            .get("attachments")
            .and_then(|a| a.as_object())
            .cloned()
            .unwrap_or_default();
        list.insert(id.to_string(), Value::String(kind.to_string()));
        data.insert("attachments".into(), Value::Object(list));
        self.save(&data)?;
        Ok(json!({ "id": id, "ok": true }))
    }

    fn attachment_type(&self, id: &str) -> Option<String> {
        self.load()
            .get("attachments")
            .and_then(|a| a.get(id))
            .and_then(|kind| kind.as_str())
            .map(|s| s.to_string())
    }

    fn attachment(&self, id: &str) -> Option<(String, Vec<u8>)> {
        let kind = self.attachment_type(id)?;
        let bytes = std::fs::read(self.attachment_dir().join(sanitize(id))).ok()?;
        Some((kind, bytes))
    }
}

/// PouchDB style revision: a short random tail, so a reader can tell a document changed.
fn next_rev(previous: Option<&Value>) -> String {
    let n = previous
        .and_then(|p| p.get("_rev"))
        .and_then(|r| r.as_str())
        .and_then(|r| r.split('-').next())
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0)
        + 1;
    let tail = crate::core::util::random_hex(6);
    format!("{n}-{tail}")
}

/// Ids become file names, so anything that is not a plain character is flattened.
fn sanitize(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push('_');
    }
    out
}
