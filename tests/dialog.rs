#![allow(unused_imports)]

//! Tests for `src/runtime/dialog.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use serde_json::{json, Map, Value};
use winwidget::runtime::dialog::*;

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

#[test]
fn giving_a_position_turns_off_centering() {
    let centered = normalize("confirm", &json!({}));
    assert_eq!(centered["center"], json!(true));
    let cfg = normalize("confirm", &json!({ "x": 120, "y": 28 }));
    assert_eq!(cfg["x"], json!(120));
    assert_eq!(cfg["y"], json!(28));
    assert_eq!(cfg["center"], json!(false));
}

#[test]
fn a_custom_dialog_page_wears_the_dialog_look() {
    let cfg = look(&json!({ "html": "custom.html", "width": 320, "height": 150 }));
    assert_eq!(cfg["frame"], json!(false));
    assert_eq!(cfg["transparent"], json!(true));
    assert_eq!(cfg["rounded"], json!(true));
    // 组件自己给的尺寸原样留着，这一层只补外观
    assert_eq!(cfg["width"], json!(320));
    assert!(cfg.get("center").is_none());
    // 组件明确要原生边框时按不透光处理，跟 `normalize` 一样
    let framed = look(&json!({ "frame": true }));
    assert_eq!(framed["transparent"], json!(false));
}

#[test]
fn the_icon_only_appears_when_the_component_asks() {
    // 不传 `icon`：配置里就不要这个键，页面据此用默认图标
    assert!(normalize("alert", &json!({})).get("icon").is_none());
    // 传空字符串是「明确不要图标」，原样留着
    assert_eq!(
        normalize("alert", &json!({ "icon": "" }))["icon"],
        json!("")
    );
    // 自定义徽标和它的底色也照传
    let cfg = normalize(
        "confirm",
        &json!({ "icon": { "url": "data:image/png;base64,AA" }, "iconColor": "#ee00aa" }),
    );
    assert_eq!(cfg["icon"]["url"], json!("data:image/png;base64,AA"));
    assert_eq!(cfg["iconColor"], json!("#ee00aa"));
}

#[test]
fn the_panel_colour_and_its_own_opacity_are_separate_knobs() {
    // 底板底色和底板不透明度各自独立：`opacity` 管整扇面，这两个只管底板那一层。
    let cfg = normalize(
        "alert",
        &json!({ "backgroundColor": "#101216", "backgroundOpacity": 1.4 }),
    );
    assert_eq!(cfg["backgroundColor"], json!("#101216"));
    assert_eq!(cfg["backgroundOpacity"], json!(1.0));
    // 负数收口到 0，没传就不写这个键（页面用默认 1）
    assert_eq!(
        normalize("alert", &json!({ "backgroundOpacity": -2 }))["backgroundOpacity"],
        json!(0.0)
    );
    assert!(normalize("alert", &json!({}))
        .get("backgroundOpacity")
        .is_none());
    // 整窗 `opacity` 和底板不透明度互不影响
    let both = normalize(
        "alert",
        &json!({ "opacity": 0.9, "backgroundOpacity": 0.35 }),
    );
    assert_eq!(both["opacity"], json!(0.9));
    assert_eq!(both["backgroundOpacity"], json!(0.35));
}

#[test]
fn a_bitmap_icon_also_dresses_the_native_title_bar() {
    // 显式 windowIcon 优先
    assert_eq!(
        window_icon_source(&json!({ "windowIcon": "logo.png", "icon": "lock" })),
        Some("logo.png".into())
    );
    // 没写 windowIcon 时，`icon` 是位图就拿它顶上
    assert_eq!(
        window_icon_source(&json!({ "icon": { "url": "logo.PNG" } })),
        Some("logo.PNG".into())
    );
    // 内置图标名、SVG、远程地址都不行：Windows 要位图，也不替组件去联网
    assert!(window_icon_source(&json!({ "icon": "lock" })).is_none());
    assert!(window_icon_source(&json!({ "icon": { "url": "icon.svg" } })).is_none());
    assert!(window_icon_source(&json!({ "windowIcon": "https://a/b.png" })).is_none());
    // 明确关掉：别退回 `icon`
    assert!(window_icon_source(&json!({ "windowIcon": false, "icon": "a.png" })).is_none());
    assert!(window_icon_source(&json!({ "windowIcon": "" })).is_none());
    // data: URL 认
    let data = "data:image/png;base64,AAAA";
    assert_eq!(
        window_icon_source(&json!({ "windowIcon": data })),
        Some(data.into())
    );
}

#[test]
fn a_dialog_can_also_close_when_the_pointer_leaves() {
    let cfg = normalize(
        "confirm",
        &json!({ "closeOnBlur": true, "closeOnOutsideClick": true }),
    );
    assert_eq!(cfg["closeOnBlur"], json!(true));
    assert_eq!(cfg["closeOnOutsideClick"], json!(true));
    // 不写就什么都不做，跟旧行为一致
    let plain = normalize("alert", &json!({}));
    assert!(plain.get("closeOnBlur").is_none());
    assert!(plain.get("closeOnOutsideClick").is_none());
}

#[test]
fn the_window_layer_defaults_can_be_overridden() {
    // 默认：置顶、不进任务栏
    let plain = normalize("alert", &json!({}));
    assert_eq!(plain["alwaysOnTop"], json!(true));
    assert_eq!(plain["skipTaskbar"], json!(true));
    // 组件明确说要置顶/要任务栏按钮，就照它说的办
    let cfg = normalize(
        "alert",
        &json!({ "alwaysOnTop": false, "skipTaskbar": false }),
    );
    assert_eq!(cfg["alwaysOnTop"], json!(false));
    assert_eq!(cfg["skipTaskbar"], json!(false));
    // `dialog.window` 走同一份白名单，外观层也认这两项
    let custom = look(&json!({ "skipTaskbar": false, "alwaysOnTop": false }));
    assert_eq!(custom["skipTaskbar"], json!(false));
    assert_eq!(custom["alwaysOnTop"], json!(false));
}

#[test]
fn a_native_frame_means_an_opaque_window_with_one_title() {
    let cfg = normalize("confirm", &json!({ "frame": true, "title": "外观全开" }));
    assert_eq!(cfg["transparent"], json!(false));
    assert_eq!(cfg["showTitle"], json!(false));
    // 边框窗口仍然可以要求直角，圆角由 DWM 决定
    let square = normalize("confirm", &json!({ "frame": true, "rounded": false }));
    assert_eq!(square["rounded"], json!(false));
}
