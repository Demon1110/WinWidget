//! The two native menus: the notification-area one and the one a card shows on its right-click.

use crate::platform::tray::{popup_menu, MenuItem};
use crate::runtime::app::App;
use serde_json::json;

fn t(tw: &str, cn: &str, en: &str) -> String {
    crate::core::text::pick_value(&json!({ "zh-TW": tw, "zh-CN": cn, "en": en }))
        .as_str()
        .unwrap_or(tw)
        .to_string()
}

pub fn tray_menu(app: &App) -> Vec<MenuItem> {
    let mut items = Vec::new();
    let mut id = 1000;
    let mut next = || {
        id += 1;
        id
    };
    items.push(MenuItem::new(
        next(),
        t("控制中心", "控制中心", "Control center"),
    ));
    items.push(MenuItem::separator());
    items.push(
        MenuItem::new(
            next(),
            t("隱藏所有組件", "隐藏所有组件", "Hide all widgets"),
        )
        .checked(app.cfg().hide_all),
    );
    items.push(
        MenuItem::new(next(), t("全部鎖定", "全部锁定", "Lock all"))
            .checked(app.cfg().instances.iter().all(|i| i.locked)),
    );
    items.push(
        MenuItem::new(next(), t("排列模式", "排列模式", "Arrange mode")).checked(app.edit_mode),
    );
    items.push(MenuItem::separator());

    if !app.cfg().instances.is_empty() {
        for (index, inst) in app.cfg().instances.iter().enumerate() {
            let name = app
                .catalog
                .find(&inst.widget)
                .map(|m| m.display_name())
                .unwrap_or_else(|| inst.widget.clone());
            let visible = app
                .windows
                .get(&inst.id)
                .map(|w| w.visible)
                .unwrap_or(false);
            let label = if index < 9 {
                format!("{}  {}", index + 1, name)
            } else {
                format!("•  {name}")
            };
            items.push(MenuItem::new(next(), label).checked(visible));
        }
        items.push(MenuItem::separator());
    }

    items.push(
        MenuItem::new(next(), t("暫停快速鍵", "暂停快捷键", "Pause hotkeys"))
            .checked(app.hotkeys_paused),
    );
    items.push(MenuItem::new(
        next(),
        t("重新掃描組件", "重新扫描组件", "Rescan widgets"),
    ));
    items.push(MenuItem::separator());
    items.push(MenuItem::new(next(), t("結束", "退出", "Quit")));
    items
}

/// One action per variant menu entry above, in the same order.
pub fn tray_actions(app: &App) -> Vec<String> {
    let mut actions: Vec<String> = vec![
        "control.open".into(),
        "hideAll.toggle".into(),
        "lockAll.toggle".into(),
        "editMode.toggle".into(),
    ];
    for inst in &app.cfg().instances {
        actions.push(format!("instance.toggle:{}", inst.id));
    }
    actions.push("hotkeysPause.toggle".into());
    actions.push("rescan".into());
    actions.push("quit".into());
    actions
}

/// A card's right-click menu. Acts straight away; the caller only reports that it happened.
pub fn widget_menu(app: &mut App, instance: &str) {
    let Some(inst) = app.instance(instance).cloned() else {
        return;
    };
    let Some(win) = app.windows.get(instance) else {
        return;
    };
    let hwnd = win.hwnd();
    let developer = app.cfg().developer_mode;

    let mut items = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    let mut id = 5000u32;
    let mut push = |items: &mut Vec<MenuItem>,
                    ids: &mut Vec<String>,
                    label: String,
                    action: String,
                    checked: bool| {
        id += 1;
        items.push(MenuItem::new(id, label).checked(checked));
        ids.push(action);
    };

    push(
        &mut items,
        &mut ids,
        t("設定", "设置", "Settings"),
        format!("menu.settings:{instance}"),
        false,
    );
    push(
        &mut items,
        &mut ids,
        t("重新載入", "重新加载", "Reload"),
        format!("menu.reload:{instance}"),
        false,
    );
    push(
        &mut items,
        &mut ids,
        t("鎖定位置", "锁定位置", "Lock position"),
        format!("menu.lock:{instance}"),
        inst.locked,
    );
    push(
        &mut items,
        &mut ids,
        t("滑鼠穿透", "鼠标穿透", "Click-through"),
        format!("menu.passthrough:{instance}"),
        inst.click_through,
    );
    for (layer, label) in [
        ("desktop", t("貼在桌面", "贴在桌面", "On the desktop")),
        ("normal", t("一般", "普通", "Normal")),
        ("top", t("置頂", "置顶", "On top")),
    ] {
        push(
            &mut items,
            &mut ids,
            label,
            format!("menu.layer:{instance}:{layer}"),
            inst.layer == layer,
        );
    }
    if developer {
        items.push(MenuItem::separator());
        push(
            &mut items,
            &mut ids,
            t("開發者工具", "开发者工具", "DevTools"),
            format!("menu.devtools:{instance}"),
            false,
        );
    }
    items.push(MenuItem::separator());
    push(
        &mut items,
        &mut ids,
        t("隱藏這個組件", "隐藏这个组件", "Hide this widget"),
        format!("menu.hide:{instance}"),
        false,
    );
    push(
        &mut items,
        &mut ids,
        t("移除", "移除", "Remove"),
        format!("menu.remove:{instance}"),
        false,
    );

    let cursor = crate::platform::win32::cursor_pos();
    let Some(picked) = popup_menu(hwnd, &items, cursor.x, cursor.y) else {
        return;
    };
    let Some(action) = ids.get((picked.saturating_sub(5001)) as usize).cloned() else {
        return;
    };
    run(app, &action);
}

/// Runs a menu/tray/hotkey action.
pub fn run(app: &mut App, action: &str) {
    let (verb, arg) = match action.split_once(':') {
        Some((v, a)) => (v, Some(a)),
        None => (action, None),
    };
    match verb {
        // A drag the window started itself, because the page never saw the press. The argument is
        // "instance:dx:dy".
        "autodrag" => {
            let mut parts = arg.unwrap_or_default().split(':');
            let instance = parts.next().unwrap_or_default();
            let dx = parts.next().and_then(|v| v.parse::<i32>().ok());
            let dy = parts.next().and_then(|v| v.parse::<i32>().ok());
            if let (false, Some(dx), Some(dy)) = (instance.is_empty(), dx, dy) {
                crate::runtime::bridge::drag_by(app, instance, dx, dy);
            }
        }
        "control.open" | "tray.open" => {
            crate::core::logging::info("Opening the control center");
            app.show_control(None);
        }
        "hideAll.toggle" => {
            let next = !app.cfg().hide_all;
            app.cfg_mut().hide_all = next;
            for win in app.windows.values_mut() {
                if next {
                    win.hide();
                } else {
                    win.show();
                }
            }
            app.save();
            app.refresh_tray_menu();
            app.push_state_to_control(None);
        }
        "lockAll.toggle" => {
            let next = !app.cfg().instances.iter().all(|i| i.locked);
            for inst in app.cfg_mut().instances.iter_mut() {
                inst.locked = next;
            }
            app.save();
            app.publish_states();
            app.refresh_tray_menu();
            app.push_state_to_control(None);
        }
        "editMode.toggle" => {
            app.edit_mode = !app.edit_mode;
            app.publish_states();
            app.refresh_tray_menu();
            app.push_state_to_control(None);
        }
        "hotkeysPause.toggle" => {
            app.hotkeys_paused = !app.hotkeys_paused;
            app.refresh_tray_menu();
            app.push_state_to_control(None);
        }
        "rescan" => {
            app.rescan();
        }
        "quit" => app.quit(),
        "instance.toggle" => {
            if let Some(id) = arg {
                let visible = app.windows.get(id).map(|w| w.visible).unwrap_or(false);
                if let Some(win) = app.windows.get_mut(id) {
                    if visible {
                        win.hide();
                    } else {
                        win.show();
                    }
                }
                app.refresh_tray_menu();
                app.push_state_to_control(None);
            }
        }
        "menu.settings" => {
            if let Some(id) = arg {
                app.show_control(None);
                app.select_in_control(id);
            }
        }
        "menu.reload" => {
            if let Some(id) = arg {
                app.reload_instance(id);
            }
        }
        "menu.lock" => {
            if let Some(id) = arg {
                let next = !app.instance(id).map(|i| i.locked).unwrap_or(false);
                if let Some(inst) = app.instance_mut(id) {
                    inst.locked = next;
                }
                app.save();
                app.publish_states();
                app.push_state_to_control(None);
            }
        }
        "menu.passthrough" => {
            if let Some(id) = arg {
                let next = !app.instance(id).map(|i| i.click_through).unwrap_or(false);
                app.set_click_through(id, next);
            }
        }
        "menu.layer" => {
            if let Some(rest) = arg {
                if let Some((id, layer)) = rest.rsplit_once(':') {
                    app.set_layer(id, layer);
                }
            }
        }
        "menu.devtools" => {
            if let Some(id) = arg {
                if let Some(win) = app.windows.get(id) {
                    win.webview.open_devtools();
                } else {
                    app.want_devtools = Some(id.to_string());
                }
            }
        }
        "menu.hide" => {
            if let Some(id) = arg {
                if let Some(win) = app.windows.get_mut(id) {
                    win.hide();
                }
                app.refresh_tray_menu();
            }
        }
        "menu.remove" => {
            if let Some(id) = arg {
                app.remove_instance(id);
                app.refresh_tray_menu();
                app.push_state_to_control(None);
            }
        }
        "package.drop" => {
            if let Some(json) = arg {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
                    if let Some(path) = value.get("path").and_then(|p| p.as_str()) {
                        crate::ui::control::stage_and_show(app, std::path::Path::new(path));
                    }
                }
            }
        }
        "market.downloaded" => {
            if let Some(json) = arg {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
                    app.install_downloaded(&value);
                    app.refresh_tray_menu();
                }
            }
        }
        // Where a drag or a resize left the card: read the window and persist it.
        "geometry" => {
            if let Some(id) = arg {
                app.geometry_from_window(id);
                app.publish_states();
            }
        }
        // The window grew or shrank: the web view has to be told, it does not follow on its own.
        "bounds" => {
            if let Some(id) = arg {
                app.sync_bounds(id);
            }
        }
        // Actions the app handles itself (hotkeys other than the built-ins).
        other => {
            if let Some(rest) = other.strip_prefix("hotkey.") {
                app.hotkey_pressed(rest);
            } else {
                crate::core::logging::warn(&format!("Unknown action '{other}'"));
            }
        }
    }
}
