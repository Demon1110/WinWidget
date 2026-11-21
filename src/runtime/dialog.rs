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

/// 是不是「按弹框算」的窗口（含 `window` 这种页面由组件自己画的）。
pub fn is_dialog(kind: &str) -> bool {
    KINDS.contains(&kind)
}

/// 只取外观那一层：`dialog.window` 的页面由组件画，尺寸、位置和交互仍旧归组件说了算，
/// 所以这里不套 `normalize` 的整份默认值，只把「弹框长什么样」补齐。
pub fn look(options: &Value) -> Value {
    let mut out = Map::new();
    out.insert("kind".into(), json!("window"));
    out.insert("frame".into(), json!(false));
    out.insert("rounded".into(), json!(true));
    out.insert("transparent".into(), json!(true));
    out.insert("backgroundColor".into(), json!("rgba(0,0,0,0)"));
    out.insert("theme".into(), json!("inherit"));
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
    // 和 `normalize` 同一条规矩：要原生边框就别同时要逐像素透明，透明的玻璃帧配标题栏会漏白边。
    if out.get("frame").and_then(Value::as_bool).unwrap_or(false) {
        out.insert("transparent".into(), json!(false));
    }
    Value::Object(out)
}

/// 组件可以设置的键。不在表里的键一律忽略：弹框配置是公开协议，只留组件真用得上的那些。
/// `alwaysOnTop` / `skipTaskbar` 这两项属于窗口层，但弹框的默认值（都在）就是压在别人头上、
/// 不进任务栏，偶尔真有「让它当个正常窗口」的需求，所以放开——默认值仍由宿主给。
const KNOWN: &[&str] = &[
    "title",
    "showTitle",
    "icon",
    "iconColor",
    "windowIcon",
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
    "x",
    "y",
    "center",
    "frame",
    "rounded",
    "transparent",
    "backgroundColor",
    "backgroundOpacity",
    "opacity",
    "accentColor",
    "theme",
    "animation",
    "animationMs",
    "fitContent",
    "closable",
    "closeOnEsc",
    "closeOnBlur",
    "closeOnOutsideClick",
    "autoClose",
    "draggable",
    "alwaysOnTop",
    "skipTaskbar",
    "modal",
    "anchor",
    "offset",
    "ignoreMouseEvents",
];

/// 原生标题栏左上角那个小图标从哪取：显式 `windowIcon` 优先；没写就看 `icon` 是不是一张位图
/// （`{ url }` 或 `data:` / 图片路径），是就拿它顶上——一个组件只说一次 logo 就够。
///
/// 只认位图：Windows 的标题栏要的是内存里的像素，SVG 解不了，所以 `.svg` 一律当没有。
pub fn window_icon_source(options: &Value) -> Option<String> {
    match options.get("windowIcon") {
        // 明确不要图标时别再退回 `icon`
        Some(Value::Bool(false)) | Some(Value::Null) => None,
        Some(Value::String(s)) if s.trim().is_empty() => None,
        Some(v) => image_source(Some(v)),
        None => image_source(options.get("icon")),
    }
}

fn image_source(v: Option<&Value>) -> Option<String> {
    let source = match v? {
        Value::String(s) => s.trim().to_string(),
        Value::Object(o) => o.get("url").and_then(Value::as_str)?.trim().to_string(),
        _ => return None,
    };
    if source.is_empty() || !looks_like_bitmap(&source) {
        return None;
    }
    Some(source)
}

/// `data:` 或者「带扩展名的位图路径」。`"lock"` 这种内置图标名、`icon.svg` 都不算。
fn looks_like_bitmap(source: &str) -> bool {
    if source.starts_with("data:") {
        return source.contains(";base64,");
    }
    if source.starts_with("http:") || source.starts_with("https:") {
        return false;
    }
    let ext = source
        .rsplit('.')
        .next()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "bmp" | "gif" | "webp" | "ico" | "tif" | "tiff"
    )
}

/// 一个 kind 的完整配置：默认值 + 组件覆盖。
pub fn normalize(kind: &str, options: &Value) -> Value {
    let toast = kind == "toast";
    // 组件自己给了坐标就别再居中：居中在窗口建好之后执行，会把 x/y 覆盖掉。
    let positioned = options.get("x").is_some() || options.get("y").is_some();
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
    // `backgroundColor` 兼着窗口背景刷：透明窗口就该给个全透明的值。页面把「全透明」当成
    // 「没给」，底板回落到主题的 `--w-bg`，所以这个默认值不会把底板一起抹掉。
    out.insert("backgroundColor".into(), json!("rgba(0,0,0,0)"));
    out.insert("theme".into(), json!("inherit"));
    out.insert(
        "animation".into(),
        json!(if toast { "none" } else { "fade" }),
    );
    out.insert("fitContent".into(), json!(true));
    // 行为：默认置顶、默认不进任务栏（这两项组件可以覆盖成 false），Esc 可关；toast 不抢焦点
    // 也不自动占满屏幕。
    out.insert("alwaysOnTop".into(), json!(true));
    out.insert("skipTaskbar".into(), json!(true));
    out.insert("resizable".into(), json!(false));
    out.insert("closable".into(), json!(true));
    out.insert("closeOnEsc".into(), json!(true));
    out.insert("draggable".into(), json!(true));
    out.insert("focusable".into(), json!(!toast));
    out.insert("center".into(), json!(!toast && !positioned));
    out.insert("autoClose".into(), json!(if toast { 3000.0 } else { 0.0 }));
    out.insert("modal".into(), json!(false));
    // toast 不该挡住底下的点击：窗口层面就穿过去。
    out.insert("ignoreMouseEvents".into(), json!(toast));
    // 不写 `icon` 的默认值：页面靠「有没有这个键」区分「用默认图标」和「不要图标」。
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
    // 原生边框和逐像素透明不搭：玻璃帧铺满整扇窗口，标题栏会跟着变透明，圆角外还容易出白边。
    // 有边框就按不透光的普通窗口处理，`opacity` 也就落回宿主那一层的整窗 alpha 上。
    let framed = out.get("frame").and_then(Value::as_bool).unwrap_or(false);
    if framed {
        out.insert("transparent".into(), json!(false));
        // 原生标题栏已经写着标题了，页面里再来一行就是重复。
        if options.get("showTitle").is_none() {
            out.insert("showTitle".into(), json!(false));
        }
    }
    // 底板不透明度是给页面用的（0–1），跟着 `opacity` 一样收口到合法区间，
    // 免得组件传个 35 之类的值把页面算出一层奇怪的遮罩。
    if let Some(v) = out.get("backgroundOpacity").and_then(Value::as_f64) {
        out.insert("backgroundOpacity".into(), json!(v.clamp(0.0, 1.0)));
    }
    Value::Object(out)
}
