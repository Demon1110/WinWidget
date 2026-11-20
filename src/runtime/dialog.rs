//! 宿主内置弹框：把组件传来的 `{ kind, … }` 补成一份完整的窗口配置。
//!
//! 弹框不另建一套窗口系统，它就是 `win.create` 的一个 `kind`：窗口、页面、关闭、通信全都走
//! 同一套（见 `window_category`）。这里只负责两件事——按 kind 填默认值、把配置交给页面。
//!
//! 默认值的取向是「弹框就该像个弹框」：无边框、透明、圆角、置顶、不进任务栏、Esc 能关、
//! 高度跟着内容走。组件传进来的每一项都能覆盖它。

use serde_json::{json, Map, Value};

/// 能当弹框用的 kind。`window` 表示「外观按弹框算，但页面由组件自己画」。
pub const KINDS: [&str; 5] = ["alert", "confirm", "prompt", "toast", "window"];

/// 弹框页在 `file` 字段里的占位值。组件不传文件时用它，`custom_url` 见到它就改走 `/__dialog`。
pub const PAGE: &str = "__dialog";

/// 有内置页面、由宿主自己画的 kind。`window` 也能套弹框外观，但页面仍由组件提供，
/// 所以不在这里——它走普通的 `win.create`。
pub fn has_builtin_page(kind: &str) -> bool {
    matches!(kind, "alert" | "confirm" | "prompt" | "toast")
}

/// 组件可以设置的键。不在表里的键一律忽略：弹框配置是公开协议，别让它顺手改窗口层。
const KNOWN: &[&str] = &[
    "title",
    "showTitle",
    "icon",
    "content",
    "rawHtml",
    "buttons",
    "defaultButton",
    "cancelButton",
    "okText",
    "cancelText",
    "danger",
    "input",
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "frame",
    "rounded",
    "transparent",
    "backgroundColor",
    "opacity",
    "accentColor",
    "theme",
    "animation",
    "animationMs",
    "fitContent",
    "closable",
    "closeOnEsc",
    "autoClose",
    "draggable",
    "modal",
    "anchor",
    "ignoreMouseEvents",
];

/// 一个 kind 的完整配置：默认值 + 组件覆盖。
pub fn normalize(kind: &str, options: &Value) -> Value {
    let toast = kind == "toast";
    let mut out = Map::new();
    out.insert("kind".into(), json!(kind));
    // 尺寸：弹框不需要手动定高，先给一个够用的初值，页面量完内容会自己调。
    out.insert("width".into(), json!(if toast { 320.0 } else { 380.0 }));
    out.insert("height".into(), json!(if toast { 76.0 } else { 140.0 }));
    out.insert("minWidth".into(), json!(220.0));
    out.insert("maxWidth".into(), json!(760.0));
    out.insert("showTitle".into(), json!(!toast));
    // 外观：无边框 + 透明 + 圆角，弹框的样子由页面画，跟卡片同一套主题变量。
    out.insert("frame".into(), json!(false));
    out.insert("rounded".into(), json!(true));
    out.insert("transparent".into(), json!(true));
    out.insert("backgroundColor".into(), json!("rgba(0,0,0,0)"));
    out.insert("theme".into(), json!("inherit"));
    out.insert(
        "animation".into(),
        json!(if toast { "none" } else { "fade" }),
    );
    out.insert("fitContent".into(), json!(true));
    // 行为：置顶、不进任务栏、Esc 可关；toast 不抢焦点也不自动占满屏幕。
    out.insert("alwaysOnTop".into(), json!(true));
    out.insert("skipTaskbar".into(), json!(true));
    out.insert("resizable".into(), json!(false));
    out.insert("closable".into(), json!(true));
    out.insert("closeOnEsc".into(), json!(true));
    out.insert("draggable".into(), json!(true));
    out.insert("focusable".into(), json!(!toast));
    out.insert("center".into(), json!(!toast));
    out.insert("autoClose".into(), json!(if toast { 3000.0 } else { 0.0 }));
    out.insert("modal".into(), json!(false));
    // toast 不该挡住底下的点击：窗口层面就穿过去。
    out.insert("ignoreMouseEvents".into(), json!(toast));
    out.insert("icon".into(), json!(""));
    if let Some(obj) = options.as_object() {
        for (key, value) in obj {
            if key == "kind" || value.is_null() {
                continue;
            }
            if KNOWN.contains(&key.as_str()) {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toast_is_small_and_self_closing() {
        let cfg = normalize("toast", &json!({}));
        assert_eq!(cfg["autoClose"], json!(3000.0));
        assert_eq!(cfg["focusable"], json!(false));
        assert_eq!(cfg["showTitle"], json!(false));
    }

    #[test]
    fn user_options_override_defaults() {
        let cfg = normalize(
            "alert",
            &json!({ "width": 460.0, "title": "提醒", "unknown": 1 }),
        );
        assert_eq!(cfg["width"], json!(460.0));
        assert_eq!(cfg["title"], json!("提醒"));
        // 不认识的键不会进配置
        assert!(cfg.get("unknown").is_none());
        // kind 不会被覆盖
        assert_eq!(cfg["kind"], json!("alert"));
    }
}
