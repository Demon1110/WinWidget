//! All widget types found on disk: the built-in ones next to the exe, plus the user's own in
//! `%APPDATA%\WinWidget\widgets`. A folder that can't be loaded is reported, not fatal.

use crate::model::manifest::Manifest;
use std::collections::BTreeMap;
use std::path::Path;

pub const RESERVED_PREFIX: &str = "winwidget.";

#[derive(Debug, Clone)]
pub struct Problem {
    pub folder: String,
    pub dir: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct Catalog {
    by_id: BTreeMap<String, Manifest>,
    problems: Vec<Problem>,
}

impl Catalog {
    pub fn scan(&mut self) {
        self.by_id.clear();
        self.problems.clear();
        let paths = crate::core::paths::get();
        scan_dir(
            &mut self.by_id,
            &mut self.problems,
            &paths.builtin_widgets_dir(),
            true,
        );
        scan_dir(
            &mut self.by_id,
            &mut self.problems,
            &paths.user_widgets_dir(),
            false,
        );
        crate::core::logging::info(&format!(
            "Catalog: {} widget(s){}",
            self.by_id.len(),
            if self.problems.is_empty() {
                String::new()
            } else {
                format!("; {} not loaded", self.problems.len())
            }
        ));
    }

    pub fn all(&self) -> impl Iterator<Item = &Manifest> {
        self.by_id.values()
    }

    pub fn find(&self, id: &str) -> Option<&Manifest> {
        self.by_id
            .get(id)
            .or_else(|| self.by_id.values().find(|m| m.id.eq_ignore_ascii_case(id)))
    }

    pub fn problems(&self) -> &[Problem] {
        &self.problems
    }

    /// Library order: by category, built-in widgets first, then by name.
    pub fn sorted(&self) -> Vec<&Manifest> {
        let mut list: Vec<&Manifest> = self.by_id.values().collect();
        list.sort_by(|a, b| {
            let ka = (
                crate::model::categories::order(&crate::model::categories::of(a)),
                !a.builtin,
                builtin_order(&a.id),
            );
            let kb = (
                crate::model::categories::order(&crate::model::categories::of(b)),
                !b.builtin,
                builtin_order(&b.id),
            );
            ka.cmp(&kb).then_with(|| {
                a.display_name()
                    .to_lowercase()
                    .cmp(&b.display_name().to_lowercase())
            })
        });
        list
    }
}

fn builtin_order(id: &str) -> usize {
    const ORDER: &[&str] = &[
        "winwidget.clock",
        "winwidget.analogclock",
        "winwidget.flipclock",
        "winwidget.worldclock",
        "winwidget.calendar",
        "winwidget.countdown",
        "winwidget.pomodoro",
        "winwidget.timer",
        "winwidget.progress",
        "winwidget.weather",
        "winwidget.forecast",
        "winwidget.airquality",
        "winwidget.sunmoon",
        "winwidget.sysinfo",
        "winwidget.usage",
        "winwidget.netspeed",
        "winwidget.disks",
        "winwidget.battery",
        "winwidget.network",
        "winwidget.pcinfo",
        "winwidget.recyclebin",
        "winwidget.volume",
        "winwidget.power",
        "winwidget.notes",
        "winwidget.todo",
        "winwidget.launcher",
        "winwidget.habits",
        "winwidget.calculator",
        "winwidget.search",
        "winwidget.infocard",
        "winwidget.rss",
        "winwidget.currency",
        "winwidget.dailyimage",
        "winwidget.onthisday",
        "winwidget.media",
        "winwidget.photoframe",
        "winwidget.whitenoise",
        "winwidget.label",
    ];
    ORDER
        .iter()
        .position(|x| x.eq_ignore_ascii_case(id))
        .unwrap_or(usize::MAX)
}

fn scan_dir(
    by_id: &mut BTreeMap<String, Manifest>,
    problems: &mut Vec<Problem>,
    root: &Path,
    builtin: bool,
) {
    let entries = match std::fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.starts_with('.') {
            continue; // staging folders (.install) and the like
        }
        if !path.join("widget.json").is_file() {
            continue;
        }
        match Manifest::load(&path, builtin) {
            Ok(m) => {
                if !builtin && m.id.to_lowercase().starts_with(RESERVED_PREFIX) {
                    problems.push(Problem {
                        folder: name,
                        dir: path.to_string_lossy().to_string(),
                        message: format!(
                            "the id \"{}\" starts with \"{RESERVED_PREFIX}\", which is kept for the built-in widgets",
                            m.id
                        ),
                    });
                    continue;
                }
                if let Some(other) = by_id.get(&m.id) {
                    problems.push(Problem {
                        folder: name,
                        dir: path.to_string_lossy().to_string(),
                        message: format!(
                            "the id \"{}\" is already used by the folder \"{}\"",
                            m.id,
                            other
                                .dir
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("?")
                        ),
                    });
                    continue;
                }
                by_id.insert(m.id.clone(), m);
            }
            Err(message) => {
                crate::core::logging::warn(&format!(
                    "Catalog: skipped {}: {message}",
                    path.display()
                ));
                problems.push(Problem {
                    folder: name,
                    dir: path.to_string_lossy().to_string(),
                    message,
                });
            }
        }
    }
}
