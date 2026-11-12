//! Per-instance key/value storage (`widget.storage` in the SDK), one JSON file per instance.

use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const MAX_BYTES_PER_INSTANCE: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct StorageStore {
    cache: HashMap<String, Map<String, Value>>,
    dirty: HashSet<String>,
}

impl StorageStore {
    fn file_for(instance: &str) -> std::path::PathBuf {
        crate::core::paths::get()
            .instances_dir()
            .join(format!("{instance}.json"))
    }

    fn open(&mut self, instance: &str) -> &mut Map<String, Value> {
        let file = Self::file_for(instance);
        self.cache.entry(instance.to_string()).or_insert_with(|| {
            crate::core::util::read_text(&file)
                .ok()
                .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
                .unwrap_or_default()
        })
    }

    pub fn get(&mut self, instance: &str, key: &str) -> Value {
        self.open(instance).get(key).cloned().unwrap_or(Value::Null)
    }

    pub fn keys(&mut self, instance: &str) -> Vec<String> {
        self.open(instance).keys().cloned().collect()
    }

    pub fn set(&mut self, instance: &str, key: &str, value: Value) -> Result<(), String> {
        let map = self.open(instance);
        map.insert(key.to_string(), value);
        if serde_json::to_vec(map).map(|b| b.len()).unwrap_or(0) > MAX_BYTES_PER_INSTANCE {
            map.remove(key);
            return Err("storage quota exceeded (2 MB per widget)".into());
        }
        self.dirty.insert(instance.to_string());
        self.flush(instance);
        Ok(())
    }

    pub fn remove(&mut self, instance: &str, key: &str) {
        if self.open(instance).remove(key).is_some() {
            self.dirty.insert(instance.to_string());
            self.flush(instance);
        }
    }

    pub fn delete_instance(&mut self, instance: &str) {
        self.cache.remove(instance);
        self.dirty.remove(instance);
        let _ = std::fs::remove_file(Self::file_for(instance));
    }

    fn flush(&mut self, instance: &str) {
        let Some(map) = self.cache.get(instance) else {
            return;
        };
        let text = match serde_json::to_string_pretty(map) {
            Ok(t) => t,
            Err(e) => {
                crate::core::logging::error(&format!(
                    "Storage {instance} could not be written: {e}"
                ));
                return;
            }
        };
        let file = Self::file_for(instance);
        if let Err(e) = std::fs::write(&file, text) {
            crate::core::logging::error(&format!("Storage save failed for {instance}: {e}"));
        } else {
            self.dirty.remove(instance);
        }
    }

    pub fn flush_all(&mut self) {
        let ids: Vec<String> = self.dirty.iter().cloned().collect();
        for id in ids {
            self.flush(&id);
        }
    }
}
