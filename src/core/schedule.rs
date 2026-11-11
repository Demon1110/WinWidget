//! 定时任务 category: cron-style schedules that wake a widget up.
//!
//! uTools keeps schedules for the user and calls `onScheduleTrigger({ code })` when one is due. The
//! host does the same here: schedules live in one file, a one-second tick checks the standard
//! 5-field cron expression against the local clock, and a due task is pushed to every instance of
//! the widget that asked for it as the `schedule` event.
//!
//! `requestSchedule` creates the schedule straight away — there is no consent dialog in this build,
//! which is what the `schedule` permission exists for instead.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jstr, now_ms, BridgeError, BridgeResult};
use crate::runtime::app::App;
use serde_json::{json, Map, Value, Value::Null};

const OWNS: &[&str] = &[
    "schedule.request",
    "schedule.list",
    "schedule.remove",
    "schedule.result",
];

const FILE_NAME: &str = "schedules.json";

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    let widget = ctx.manifest.id.clone();
    match method {
        "schedule.request" => {
            ctx.require("schedule")?;
            let schedule = p
                .get("schedule")
                .cloned()
                .ok_or_else(|| BridgeError::new("schedule is required"))?;
            let code = jstr(&schedule, "code").unwrap_or_default();
            if code.is_empty() {
                return Err(BridgeError::new("schedule.code is required"));
            }
            let trigger = schedule
                .get("trigger")
                .cloned()
                .ok_or_else(|| BridgeError::new("schedule.trigger is required"))?;
            // A cron expression is validated when the schedule is created, so a typo shows up as an
            // exception at the call site instead of a task that silently never runs.
            if let Some(cron) = trigger.get("cron").and_then(|c| c.as_str()) {
                parse_cron(cron)?;
            }
            let mut items = load();
            let list = items
                .get_mut("items")
                .and_then(|i| i.as_array_mut())
                .ok_or_else(|| BridgeError::new("schedules.json is not a list"))?;
            list.retain(|item| {
                !(item.get("widget").and_then(|w| w.as_str()) == Some(widget.as_str())
                    && item.get("code").and_then(|c| c.as_str()) == Some(code.as_str()))
            });
            list.push(json!({
                "widget": widget,
                "code": code,
                "label": jstr(&schedule, "label").unwrap_or_else(|| code.clone()),
                "trigger": trigger,
                "successCount": 0,
                "failureCount": 0,
            }));
            save(&items)?;
            Ok(Reply::Now(Null))
        }
        "schedule.list" => {
            let items = load();
            let list: Vec<Value> = items
                .get("items")
                .and_then(|i| i.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|item| {
                            item.get("widget").and_then(|w| w.as_str()) == Some(widget.as_str())
                        })
                        .map(|item| {
                            let mut out = item.clone();
                            if let Some(obj) = out.as_object_mut() {
                                obj.remove("widget");
                            }
                            out
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(Reply::Now(Value::Array(list)))
        }
        "schedule.remove" => {
            let code = jstr(p, "code").unwrap_or_default();
            let mut items = load();
            let list = items
                .get_mut("items")
                .and_then(|i| i.as_array_mut())
                .ok_or_else(|| BridgeError::new("schedules.json is not a list"))?;
            let before = list.len();
            list.retain(|item| {
                !(item.get("widget").and_then(|w| w.as_str()) == Some(widget.as_str())
                    && item.get("code").and_then(|c| c.as_str()) == Some(code.as_str()))
            });
            let after = list.len();
            save(&items)?;
            if after == before {
                return Err(BridgeError::new(format!("no schedule '{code}'")));
            }
            Ok(Reply::Now(Null))
        }
        // The page reports how the callback went, so `successCount` / `lastStatus` mean something.
        "schedule.result" => {
            let code = jstr(p, "code").unwrap_or_default();
            let ok = p.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
            let mut items = load();
            if let Some(list) = items.get_mut("items").and_then(|i| i.as_array_mut()) {
                if let Some(item) = list.iter_mut().find(|item| {
                    item.get("widget").and_then(|w| w.as_str()) == Some(widget.as_str())
                        && item.get("code").and_then(|c| c.as_str()) == Some(code.as_str())
                }) {
                    bump(item, ok);
                }
            }
            save(&items)?;
            Ok(Reply::Now(Null))
        }
        other => Err(BridgeError::new(format!("unknown method '{other}'"))),
    }
}

fn bump(item: &mut Value, ok: bool) {
    if let Some(obj) = item.as_object_mut() {
        let key = if ok { "successCount" } else { "failureCount" };
        let count = obj.get(key).and_then(|v| v.as_u64()).unwrap_or(0) + 1;
        obj.insert(key.into(), json!(count));
        obj.insert("lastStatus".into(), json!(if ok { "success" } else { "failure" }));
    }
}

// ── the clock ───────────────────────────────────────────────────────────────

/// Called once a second from `App::tick`: fires everything whose minute has arrived and pushes the
/// `schedule` event into the widget that owns it.
pub fn tick(app: &mut App) {
    let Some(parts) = local_parts() else {
        return;
    };
    let minute_start = parts.minute_start;
    let mut items = load();
    let mut due: Vec<(String, String, String)> = Vec::new();
    if let Some(list) = items.get_mut("items").and_then(|i| i.as_array_mut()) {
        let mut expired = false;
        for item in list.iter_mut() {
            let widget = item
                .get("widget")
                .and_then(|w| w.as_str())
                .unwrap_or_default()
                .to_string();
            let code = item
                .get("code")
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            let label = item
                .get("label")
                .and_then(|l| l.as_str())
                .unwrap_or_default()
                .to_string();
            let trigger = item.get("trigger").cloned().unwrap_or(Null);
            let last = item.get("lastExecuteAt").and_then(|t| t.as_i64());
            if is_due(&trigger, &parts, last, minute_start) {
                if let Some(obj) = item.as_object_mut() {
                    obj.insert("lastExecuteAt".into(), json!(minute_start));
                }
                due.push((widget, code, label));
            }
            if let Some(end) = trigger.get("endTime").and_then(|t| t.as_i64()) {
                if minute_start > end {
                    expired = true;
                }
            }
        }
        if expired {
            let now = minute_start;
            list.retain(|item| {
                let end = item
                    .get("trigger")
                    .and_then(|t| t.get("endTime"))
                    .and_then(|t| t.as_i64());
                end.map(|e| now <= e).unwrap_or(true)
            });
        }
    }
    if !due.is_empty() {
        save(&items).ok();
    }
    for (widget, code, label) in due {
        let payload = json!({ "code": code, "label": label, "at": minute_start });
        let instances: Vec<String> = app
            .cfg()
            .instances
            .iter()
            .filter(|i| i.widget.eq_ignore_ascii_case(&widget))
            .map(|i| i.id.clone())
            .collect();
        for instance in instances {
            app.event_to(&instance, "schedule", payload.clone());
        }
    }
}

fn is_due(trigger: &Value, parts: &LocalParts, last: Option<i64>, minute_start: i64) -> bool {
    if last == Some(minute_start) {
        return false;
    }
    if let Some(start) = trigger.get("startTime").and_then(|t| t.as_i64()) {
        if minute_start < start {
            return false;
        }
    }
    if let Some(end) = trigger.get("endTime").and_then(|t| t.as_i64()) {
        if minute_start > end {
            return false;
        }
    }
    if let Some(at) = trigger.as_i64() {
        // One-shot: fires once, at or after the moment asked for.
        return last.is_none() && minute_start >= at;
    }
    match trigger.get("cron").and_then(|c| c.as_str()) {
        Some(cron) => parse_cron(cron)
            .map(|fields| matches(&fields, parts))
            .unwrap_or(false),
        None => false,
    }
}

struct LocalParts {
    minute: u32,
    hour: u32,
    day: u32,
    month: u32,
    /// 0 = Sunday, the way cron counts.
    weekday: u32,
    minute_start: i64,
}

fn local_parts() -> Option<LocalParts> {
    let mut time = crate::platform::win32::SYSTEMTIME::default();
    unsafe {
        crate::platform::win32::GetLocalTime(&mut time);
    }
    // A SYSTEMTIME with every field zero means the call failed.
    if time.wYear == 0 {
        return None;
    }
    let minute_start = now_ms() / 60_000 * 60_000;
    Some(LocalParts {
        minute: time.wMinute as u32,
        hour: time.wHour as u32,
        day: time.wDay as u32,
        month: time.wMonth as u32,
        weekday: time.wDayOfWeek as u32,
        minute_start,
    })
}

fn matches(fields: &[String; 5], p: &LocalParts) -> bool {
    field(&fields[0], p.minute, 0, 59)
        && field(&fields[1], p.hour, 0, 23)
        && field(&fields[2], p.day, 1, 31)
        && field(&fields[3], p.month, 1, 12)
        && field(&fields[4], p.weekday, 0, 6)
}

/// One cron field: `*`, `7`, `1-5`, `*/15`, `1,15,30`, or `10-20/2`.
fn field(expr: &str, value: u32, min: u32, max: u32) -> bool {
    for part in expr.split(',') {
        let part = part.trim();
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (range, step.parse::<u32>().unwrap_or(1).max(1)),
            None => (part, 1),
        };
        let (low, high) = if range == "*" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (
                a.parse::<u32>().unwrap_or(min),
                b.parse::<u32>().unwrap_or(max),
            )
        } else {
            match range.parse::<u32>() {
                Ok(n) => (n, n),
                Err(_) => continue,
            }
        };
        if value >= low && value <= high && (value - low) % step == 0 {
            return true;
        }
    }
    false
}

fn parse_cron(expr: &str) -> BridgeResult<[String; 5]> {
    let fields: Vec<String> = expr.split_whitespace().map(|f| f.to_string()).collect();
    if fields.len() != 5 {
        return Err(BridgeError::new(
            "cron must have 5 fields: minute hour day month weekday",
        ));
    }
    let bounds = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)];
    for (field, (min, max)) in fields.iter().zip(bounds.iter()) {
        if !field_sane(field, *min, *max) {
            return Err(BridgeError::new(format!(
                "cron field '{field}' is outside {min}-{max}"
            )));
        }
    }
    Ok([
        fields[0].clone(),
        fields[1].clone(),
        fields[2].clone(),
        fields[3].clone(),
        fields[4].clone(),
    ])
}

fn field_sane(expr: &str, min: u32, max: u32) -> bool {
    expr.split(',').all(|part| {
        let (range, _step) = match part.split_once('/') {
            Some((range, step)) => (range, step.parse::<u32>().is_ok()),
            None => (part, true),
        };
        if !_step {
            return false;
        }
        if range == "*" {
            return true;
        }
        match range.split_once('-') {
            Some((a, b)) => match (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                (Ok(a), Ok(b)) => a >= min && b <= max && a <= b,
                _ => false,
            },
            None => match range.trim().parse::<u32>() {
                Ok(n) => n >= min && n <= max,
                Err(_) => false,
            },
        }
    })
}

// ── the file ────────────────────────────────────────────────────────────────

fn file() -> std::path::PathBuf {
    crate::core::paths::data_dir().join(FILE_NAME)
}

fn load() -> Map<String, Value> {
    let text = std::fs::read_to_string(file()).unwrap_or_default();
    serde_json::from_str::<Map<String, Value>>(&text).unwrap_or_else(|_| {
        let mut map = Map::new();
        map.insert("items".into(), Value::Array(Vec::new()));
        map
    })
}

fn save(items: &Map<String, Value>) -> BridgeResult<()> {
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| BridgeError::new(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(items).map_err(|e| BridgeError::new(e.to_string()))?;
    std::fs::write(path, text).map_err(|e| BridgeError::new(e.to_string()))
}

/// Used by the tests below, and by anything that wants to know a schedule's next minute without a
/// running app.
pub fn minute_of(day: u32, hour: u32, minute: u32) -> i64 {
    i64::from(day) * 86_400_000 + i64::from(hour) * 3_600_000 + i64::from(minute) * 60_000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(hour: u32, minute: u32) -> LocalParts {
        LocalParts {
            minute,
            hour,
            day: 1,
            month: 1,
            weekday: 0,
            minute_start: 0,
        }
    }

    #[test]
    fn cron_fields_match_the_way_cron_does() {
        assert!(field("*/15", 0, 0, 59));
        assert!(field("*/15", 45, 0, 59));
        assert!(!field("*/15", 7, 0, 59));
        assert!(field("9-18", 12, 0, 23));
        assert!(!field("9-18", 20, 0, 23));
        assert!(field("1,15,30", 15, 0, 59));
        assert!(field("10-20/2", 14, 0, 59));
        assert!(!field("10-20/2", 15, 0, 59));
    }

    #[test]
    fn a_whole_expression_matches() {
        let fields = parse_cron("0 9-18 * * *").unwrap();
        assert!(matches(&fields, &parts(9, 0)));
        assert!(matches(&fields, &parts(18, 0)));
        assert!(!matches(&fields, &parts(9, 1)));
        assert!(!matches(&fields, &parts(8, 0)));
    }

    #[test]
    fn a_typo_is_rejected() {
        assert!(parse_cron("0 9 * *").is_err());
        assert!(parse_cron("0 25 * * *").is_err());
        assert!(parse_cron("0 9 * * *").is_ok());
    }

    #[test]
    fn a_due_one_shot_fires_once() {
        let trigger = json!(minute_of(1, 9, 0));
        assert!(is_due(&trigger, &parts(9, 0), None, minute_of(1, 9, 0)));
        // A minute missed (the machine slept, the app had just started) is caught up once rather
        // than dropped.
        assert!(is_due(&trigger, &parts(9, 1), None, minute_of(1, 9, 1)));
        assert!(!is_due(
            &trigger,
            &parts(9, 0),
            Some(minute_of(1, 9, 0)),
            minute_of(1, 9, 0)
        ));
    }
}
