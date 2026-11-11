//! The window layer: cards, the main-window window family and custom windows.
//!
//! Two kinds of window live here:
//!
//! * **the card** — the thing a widget paints on the desktop. It plays the part of uTools' *main
//!   window*: the widget's own UI, the window `hideMainWindow()` talks about.
//! * **custom windows** — what `utools.createBrowserWindow()` opens: a normal framed (or
//!   borderless, or transparent) window with its own page inside the widget's origin. A widget may
//!   open several, talk to them, and close them; they belong to the card that created them.
//!
//! The names and payloads follow `https://www.u-tools.cn/docs/api-reference/window.html` so a
//! uTools plugin's window code reads the same here. Where WebView2 has nothing behind a method, the
//! method still exists and answers `{"unsupported": "…"}` instead of lying — see
//! [`unsupported_reason`].

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jbool, jnum, jstr, req_str, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use crate::runtime::app::{post, App, Ev};
use serde_json::{json, Value};
use std::collections::HashMap;
use tao::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, Window, WindowBuilder};
use wry::{Rect, WebView, WebViewBuilder};

/// The dispatcher's entry for the window category. `win.*` talks about a custom window; `window.*`
/// means the card, except inside a custom window, where it means that window itself.
pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if method.starts_with("win.") {
        return Some(custom_call(ctx.app, ctx.win, ctx.instance, method, p));
    }
    let rest = method.strip_prefix("window.")?;
    if ctx.win.is_some() {
        let as_win = format!("win.{rest}");
        return Some(custom_call(ctx.app, ctx.win, ctx.instance, &as_win, p));
    }
    Some(match card_call(ctx.app, ctx.instance, method, p) {
        Ok(Some(reply)) => Ok(reply),
        Ok(None) => Err(BridgeError::new(format!("unknown method '{method}'"))),
        Err(e) => Err(e),
    })
}

/// Hides this card and gives the keyboard back to the window below it — the step every uTools
/// `hideMainWindowPaste*` and `hideMainWindowTypeString` starts with.
pub fn hide_for_input(app: &mut App, instance: &str) {
    let hwnd = app.windows.get(instance).map(|win| win.hwnd());
    let remembered = app.last_foreign_focus as crate::platform::win32::HWND;
    app.set_visible(instance, false, "api");
    // The remembered window is where the user actually was; z-order behind the card is only a
    // fallback, and it happily lands on the terminal that launched us.
    if crate::platform::win32::can_take_focus(remembered) {
        crate::platform::win32::force_foreground(remembered);
    } else if let Some(hwnd) = hwnd {
        crate::platform::win32::activate_behind(hwnd);
    }
    app.refresh_tray_menu();
}

/// `ready` and `log` sent by a custom window's page, with no `id`: the first is what fires
/// `createBrowserWindow`'s callback once the page has actually loaded.
pub fn custom_notify(app: &mut App, win: u32, method: &str, p: &Value) -> bool {
    match method {
        "ready" => {
            app.mark_custom_loaded(win);
            true
        }
        "log" => {
            let level = jstr(p, "level").unwrap_or_else(|| "info".into());
            let text = jstr(p, "msg").unwrap_or_default();
            let line = format!("[win {win}] {text}");
            match level.as_str() {
                "error" => crate::core::logging::error(&line),
                "warn" => crate::core::logging::warn(&line),
                _ => crate::core::logging::info(&line),
            }
            true
        }
        // A custom window has no card behind it: `window.*` notifications (press, drag, resize) are
        // meaningless there, not a mistake worth a warning.
        other if other.starts_with("window.") => true,
        _ => false,
    }
}

/// Default size of a custom window, the same numbers Electron uses.
const DEFAULT_WIDTH: f64 = 800.0;
const DEFAULT_HEIGHT: f64 = 600.0;

/// `utools.createBrowserWindow()` as the page asked for it, waiting for the event loop to build it.
#[derive(Clone)]
pub struct CustomSpec {
    /// Who asked: `card:<instance>` or `win:<id>`, so `sendToParent` knows where to go back to.
    pub parent: String,
    /// The widget instance whose origin and storage the window shares.
    pub instance: String,
    /// The page inside the widget (`test.html` or `test.html?x=1`).
    pub file: String,
    pub options: Value,
}

/// One `BrowserWindow`: the window, its page, and the state its getters answer from.
pub struct CustomWin {
    pub id: u32,
    pub parent: String,
    pub instance: String,
    pub file: String,
    pub window: Window,
    pub webview: WebView,
    pub title: String,
    pub background: String,
    pub resizable: bool,
    pub closable: bool,
    pub min: Option<(f64, f64)>,
    pub max: Option<(f64, f64)>,
    /// Whether the window was created visible (`options.show`), which the page reads as its
    /// starting state.
    pub shown: bool,
    /// The page has reported `ready`, which is what `createBrowserWindow`'s callback waits for.
    pub loaded: bool,
    /// The page is gone (destroyed or closed): further calls are refused like Electron's.
    pub destroyed: bool,
    pub ignore_mouse: bool,
}

impl CustomWin {
    pub fn hwnd(&self) -> w::HWND {
        self.window.hwnd()
    }

    fn scale(&self) -> f64 {
        let scale = self.window.scale_factor();
        if scale > 0.0 {
            scale
        } else {
            1.0
        }
    }

    /// Bounds in DIP: where the window sits on screen, plus the size of its page area. The page
    /// area (not the frame) is the measure the cards already report, so `setSize(getSize())` and
    /// `setBounds(getBounds())` round-trip instead of growing by the invisible frame every time.
    pub fn bounds(&self) -> (f64, f64, f64, f64) {
        let scale = self.scale();
        let pos = self
            .window
            .outer_position()
            .unwrap_or(PhysicalPosition::new(0, 0));
        let (w, h) = self.content_size();
        (
            to_dip(pos.x as f64, scale),
            to_dip(pos.y as f64, scale),
            w,
            h,
        )
    }

    pub fn content_size(&self) -> (f64, f64) {
        let scale = self.scale();
        let size = self.window.inner_size();
        (
            to_dip(size.width as f64, scale),
            to_dip(size.height as f64, scale),
        )
    }

    pub fn always_on_top(&self) -> bool {
        unsafe { w::GetWindowLongPtrW(self.hwnd(), w::GWL_EXSTYLE) & 0x0000_0008 != 0 }
    }

    /// Hands the page one of the host's events (`ipc`, `win.loaded`, …), same envelope as a card.
    pub fn send_ipc(&self, ev: &str, data: Value) {
        let body = format!(
            "{{\"ev\":{},\"d\":{}}}",
            serde_json::to_string(ev).unwrap_or_else(|_| "\"\"".into()),
            data
        );
        self.deliver(&body);
    }

    /// The same delivery the cards get: the SDK listens for a whole `{ev, d}` body.
    pub fn deliver(&self, body: &str) {
        let _ = self
            .webview
            .evaluate_script(&format!("window.__WV_DELIVER && window.__WV_DELIVER({body})"));
    }
}

fn to_dip(px: f64, scale: f64) -> f64 {
    if scale > 0.0 {
        (px / scale).round()
    } else {
        px
    }
}

fn from_dip(dip: f64, scale: f64) -> f64 {
    if scale > 0.0 {
        (dip * scale).round()
    } else {
        dip
    }
}

// ── building ────────────────────────────────────────────────────────────

/// Builds a custom window (and its page) on the app's event loop.
pub fn build_custom(
    event_loop: &tao::event_loop::EventLoopWindowTarget<Ev>,
    spec: &CustomSpec,
    url: String,
    id: u32,
    developer: bool,
    proxy: tao::event_loop::EventLoopProxy<Ev>,
) -> Result<CustomWin, String> {
    let o = if spec.options.is_object() {
        spec.options.clone()
    } else {
        json!({})
    };
    let width = jnum(&o, "width")
        .filter(|v| *v > 0.0)
        .unwrap_or(DEFAULT_WIDTH);
    let height = jnum(&o, "height")
        .filter(|v| *v > 0.0)
        .unwrap_or(DEFAULT_HEIGHT);
    let title = jstr(&o, "title").unwrap_or_default();
    let transparent = jbool(&o, "transparent").unwrap_or(false);
    let frame = jbool(&o, "frame").unwrap_or(true);
    let resizable = jbool(&o, "resizable").unwrap_or(true);
    let show = jbool(&o, "show").unwrap_or(true);
    let always_on_top = jbool(&o, "alwaysOnTop").unwrap_or(false);
    let skip_taskbar = jbool(&o, "skipTaskbar").unwrap_or(false);
    let rounded = jbool(&o, "roundedCorners").unwrap_or(true);
    let background = jstr(&o, "backgroundColor").unwrap_or_else(|| "rgba(0,0,0,0)".into());

    let mut builder = WindowBuilder::new()
        .with_title(title.clone())
        .with_decorations(frame)
        .with_transparent(transparent)
        .with_resizable(resizable)
        .with_skip_taskbar(skip_taskbar)
        .with_visible(false)
        .with_inner_size(LogicalSize::new(width, height));
    if let (Some(minw), Some(minh)) = (jnum(&o, "minWidth"), jnum(&o, "minHeight")) {
        builder = builder.with_min_inner_size(LogicalSize::new(minw, minh));
    }
    if let (Some(maxw), Some(maxh)) = (jnum(&o, "maxWidth"), jnum(&o, "maxHeight")) {
        builder = builder.with_max_inner_size(LogicalSize::new(maxw, maxh));
    }
    if let (Some(x), Some(y)) = (jnum(&o, "x"), jnum(&o, "y")) {
        builder = builder.with_position(LogicalPosition::new(x, y));
    }
    let window = builder.build(event_loop).map_err(|e| e.to_string())?;
    let hwnd = window.hwnd();

    if always_on_top {
        w::set_topmost(hwnd, true);
    }
    if !frame {
        w::polish_frame(hwnd, rounded);
    }
    if let Some(opacity) = jnum(&o, "opacity") {
        set_opacity(hwnd, opacity);
    }
    if jbool(&o, "center").unwrap_or(false) {
        center(&window);
    }
    if jbool(&o, "fullscreen").unwrap_or(false) {
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
    }

    let ipc_key = format!("win:{id}");
    let webview = {
        let mut context = crate::runtime::window::browser()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let size = window.inner_size();
        WebViewBuilder::new_with_web_context(&mut context)
            .with_url(&url)
            .with_transparent(transparent)
            .with_background_color(parse_color(&background, transparent))
            .with_devtools(developer)
            .with_initialization_script(crate::runtime::shim::SCRIPT)
            .with_ipc_handler(move |request| {
                post(
                    &proxy,
                    Ev::Ipc {
                        win: ipc_key.clone(),
                        msg: request.body().clone(),
                    },
                );
            })
            .with_bounds(Rect {
                position: PhysicalPosition::new(0, 0).into(),
                size: PhysicalSize::new(size.width.max(1), size.height.max(1)).into(),
            })
            .build(&window)
            .map_err(|e| format!("WebView2 could not be created: {e}"))?
    };

    if show {
        window.set_visible(true);
    }

    Ok(CustomWin {
        id,
        parent: spec.parent.clone(),
        instance: spec.instance.clone(),
        file: spec.file.clone(),
        window,
        webview,
        title,
        background,
        resizable,
        closable: jbool(&o, "closable").unwrap_or(true),
        min: match (jnum(&o, "minWidth"), jnum(&o, "minHeight")) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => None,
        },
        max: match (jnum(&o, "maxWidth"), jnum(&o, "maxHeight")) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => None,
        },
        shown: show,
        loaded: false,
        destroyed: false,
        ignore_mouse: jbool(&o, "ignoreMouseEvents").unwrap_or(false),
    })
}

/// A CSS colour from `backgroundColor`, as the RGBA the web view paints behind the page. A window
/// that is not transparent defaults to white, like Electron's.
fn parse_color(text: &str, transparent: bool) -> (u8, u8, u8, u8) {
    let fallback = if transparent {
        (0, 0, 0, 0)
    } else {
        (255, 255, 255, 255)
    };
    let t = text.trim().to_ascii_lowercase();
    if t.is_empty() || t == "transparent" {
        return fallback;
    }
    if let Some(hex) = t.strip_prefix('#') {
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| c.to_digit(16).unwrap_or(0) as u8)
            .collect();
        return match digits.len() {
            3 => (
                digits[0] * 17,
                digits[1] * 17,
                digits[2] * 17,
                255,
            ),
            6 => (
                digits[0] * 16 + digits[1],
                digits[2] * 16 + digits[3],
                digits[4] * 16 + digits[5],
                255,
            ),
            8 => (
                digits[0] * 16 + digits[1],
                digits[2] * 16 + digits[3],
                digits[4] * 16 + digits[5],
                digits[6] * 16 + digits[7],
            ),
            _ => fallback,
        };
    }
    for prefix in ["rgba(", "rgb("] {
        if let Some(rest) = t.strip_prefix(prefix) {
            let Some(body) = rest.strip_suffix(')') else {
                return fallback;
            };
            let parts: Vec<f64> = body
                .split(',')
                .filter_map(|v| v.trim().parse::<f64>().ok())
                .collect();
            if parts.len() >= 3 {
                let alpha = parts.get(3).copied().unwrap_or(1.0).clamp(0.0, 1.0);
                return (
                    parts[0].clamp(0.0, 255.0) as u8,
                    parts[1].clamp(0.0, 255.0) as u8,
                    parts[2].clamp(0.0, 255.0) as u8,
                    (alpha * 255.0).round() as u8,
                );
            }
            return fallback;
        }
    }
    fallback
}

fn set_opacity(hwnd: w::HWND, opacity: f64) {
    let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    unsafe {
        let ex = w::GetWindowLongPtrW(hwnd, w::GWL_EXSTYLE) | w::GWL_EXSTYLE_LAYERED;
        w::SetWindowLongPtrW(hwnd, w::GWL_EXSTYLE, ex);
        w::SetLayeredWindowAttributes(hwnd, 0, alpha, 0x0000_0002); // LWA_ALPHA
    }
}

fn center(window: &Window) {
    let Some(monitor) = window.current_monitor().or_else(|| window.primary_monitor()) else {
        return;
    };
    let size = window.outer_size();
    let screen = monitor.size();
    let pos = monitor.position();
    let x = pos.x + ((screen.width as i64 - size.width as i64) / 2) as i32;
    let y = pos.y + ((screen.height as i64 - size.height as i64) / 2) as i32;
    window.set_outer_position(PhysicalPosition::new(x, y));
}

// ── the card, which plays uTools' "main window" ─────────────────────────

/// Card-side window methods (`window.*`). `None` means "not a window method".
pub fn card_call(
    app: &mut App,
    instance: &str,
    method: &str,
    p: &Value,
) -> BridgeResult<Option<Reply>> {
    let reply = match method {
        "window.getSize" => {
            let inst = app
                .instance(instance)
                .ok_or_else(|| BridgeError::new("no such instance"))?;
            Reply::Now(json!({ "width": inst.width, "height": inst.height }))
        }
        "window.setSize" => {
            let width = jnum(p, "width").unwrap_or(0.0);
            let height = jnum(p, "height").unwrap_or(0.0);
            if width <= 0.0 && height <= 0.0 {
                return Err(BridgeError::new("width or height is required"));
            }
            let manifest = app
                .manifest_for(instance)
                .ok_or_else(|| BridgeError::new("this widget is no longer installed"))?;
            let s = &manifest.size;
            let w = if width > 0.0 {
                width.clamp(s.min_width, s.max_width)
            } else {
                app.instance(instance).map(|i| i.width).unwrap_or(s.width)
            };
            let h = if height > 0.0 {
                height.clamp(s.min_height, s.max_height)
            } else {
                app.instance(instance).map(|i| i.height).unwrap_or(s.height)
            };
            if let Some(inst) = app.instance_mut(instance) {
                inst.width = w;
                inst.height = h;
            }
            app.place_window(instance);
            app.save();
            app.push_state(instance);
            app.push_state_to_control(None);
            Reply::Now(json!({ "width": w, "height": h }))
        }
        "window.hide" | "window.main.hide" => {
            let restore = jbool(p, "isFocusPrevWindow").unwrap_or(true);
            app.set_visible(instance, false, "api");
            if restore {
                // Hand the keyboard back to whatever the user was in before the card popped up,
                // the same courtesy uTools' `isFocusPrevWindow` does.
                if let Some(hwnd) = app.windows.get(instance).map(|win| win.hwnd()) {
                    unsafe {
                        let next = w::GetWindow(hwnd, w::GW_HWNDNEXT);
                        if next != 0 {
                            w::SetForegroundWindow(next);
                        }
                    }
                }
            }
            app.refresh_tray_menu();
            Reply::Now(Value::Bool(true))
        }
        "window.show" | "window.main.show" => {
            app.set_visible(instance, true, "api");
            app.refresh_tray_menu();
            Reply::Now(Value::Bool(true))
        }
        "window.main.out" => {
            // Same shape as `utools.outPlugin`: the card goes away, the widget stays installed.
            let kill = jbool(p, "isKill").unwrap_or(false);
            app.set_visible(instance, false, "api");
            app.refresh_tray_menu();
            Reply::Now(json!({ "isKill": kill }))
        }
        "window.main.expand" => {
            let height = jnum(p, "height").unwrap_or(0.0);
            if height <= 0.0 {
                return Err(BridgeError::new("height is required"));
            }
            let manifest = app
                .manifest_for(instance)
                .ok_or_else(|| BridgeError::new("this widget is no longer installed"))?;
            let s = &manifest.size;
            let h = height.clamp(s.min_height, s.max_height);
            if let Some(inst) = app.instance_mut(instance) {
                inst.height = h;
            }
            app.place_window(instance);
            app.save();
            app.push_state(instance);
            app.push_state_to_control(None);
            Reply::Now(Value::Bool(true))
        }
        "window.main.visible" => {
            let visible = app
                .windows
                .get(instance)
                .map(|win| win.visible)
                .unwrap_or(false);
            Reply::Now(Value::Bool(visible))
        }
        "window.main.find" => {
            let text = jstr(p, "text").unwrap_or_default();
            let forward = jbool(p, "forward").unwrap_or(true);
            let case = jbool(p, "matchCase").unwrap_or(false);
            let script = format!(
                "window.find({}, {}, {}, true, false, false, false)",
                serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into()),
                forward,
                case
            );
            eval(app, instance, &script);
            Reply::Now(Value::Null)
        }
        "window.main.stopFind" => {
            let action = jstr(p, "action").unwrap_or_else(|| "clearSelection".into());
            if action != "keepSelection" {
                eval(app, instance, "window.getSelection().removeAllRanges()");
            }
            Reply::Now(Value::Null)
        }
        _ => return Ok(None),
    };
    Ok(Some(reply))
}

fn eval(app: &App, instance: &str, script: &str) {
    if let Some(win) = app.windows.get(instance) {
        let _ = win.webview.evaluate_script(script);
    }
}

/// Card-side fire-and-forget notifications (`window.*` without an id). `true` when handled.
pub fn card_notify(app: &mut App, instance: &str, method: &str, params: &Value) -> bool {
    match method {
        "window.drag" => {
            start_drag(app, instance, params);
            true
        }
        "window.press" => {
            // The page is using this press for a control inside the card; the watcher that would
            // otherwise turn a long slide into a window drag has to stand down for it.
            if let Some(win) = app.windows.get(instance) {
                crate::runtime::window::claim_press(win.hwnd());
            }
            true
        }
        "window.resize" => {
            start_resize(app, instance);
            true
        }
        "window.menu" => {
            crate::ui::menus::widget_menu(app, instance);
            true
        }
        "window.devtools" => {
            if app.cfg().developer_mode {
                if let Some(win) = app.windows.get(instance) {
                    win.webview.open_devtools();
                }
            }
            true
        }
        _ => false,
    }
}

// ── dragging and resizing a card ────────────────────────────────────────

pub(crate) fn current_card(app: &App, instance: &str) -> Option<(w::RECT, i32, f64)> {
    let win = app.windows.get(instance)?;
    let outer = w::window_rect(win.hwnd());
    let margin = win.margin;
    let card = w::RECT {
        left: outer.left + margin,
        top: outer.top + margin,
        right: outer.right - margin,
        bottom: outer.bottom - margin,
    };
    Some((card, margin, win.scale))
}

pub(crate) fn other_cards(app: &App, skip: &str) -> Vec<w::RECT> {
    let mut out = Vec::new();
    for (id, win) in &app.windows {
        if id == skip || !win.visible {
            continue;
        }
        let outer = w::window_rect(win.hwnd());
        let margin = win.margin;
        out.push(w::RECT {
            left: outer.left + margin,
            top: outer.top + margin,
            right: outer.right - margin,
            bottom: outer.bottom - margin,
        });
    }
    out
}

/// The dashed lines take the card's own accent colour, the way FullWidget did.
pub(crate) fn guide_ink(app: &App, instance: &str) -> u32 {
    let appearance =
        crate::model::appearance::effective(&app.themes, app.cfg(), app.instance(instance));
    let accent = appearance
        .get("accentColor")
        .and_then(|v| v.as_str())
        .unwrap_or("#4cc9f0");
    match crate::core::util::parse_color(accent) {
        Some((r, g, b)) => ((r as u32) << 16) | ((g as u32) << 8) | b as u32,
        None => 0x4CC9F0,
    }
}

/// Gap kept between cards, and how close a card has to come before it snaps, both on the screen.
pub(crate) fn snap_metrics(scale: f64) -> (i32, i32, (i32, i32, i32)) {
    let gap = (12.0 * scale).round() as i32;
    let reach = (8.0 * scale).round() as i32;
    let thickness = (1.0 * scale).round().max(1.0) as i32;
    let dash = (5.0 * scale).round().max(1.0) as i32;
    let space = (4.0 * scale).round().max(1.0) as i32;
    (gap.max(0), reach.max(1), (thickness, dash, space))
}

/// The page reports the pointer delta since the button went down; the window has not moved yet,
/// so it jumps by that delta and then rides the pointer until the button is released.
pub(crate) fn start_drag(app: &mut App, instance: &str, p: &Value) {
    let dx = jnum(p, "dx").unwrap_or(0.0).round() as i32;
    let dy = jnum(p, "dy").unwrap_or(0.0).round() as i32;
    let Some(inst) = app.instance(instance).cloned() else {
        return;
    };
    if inst.locked && !app.edit_mode {
        return;
    }
    let Some((card, margin, scale)) = current_card(app, instance) else {
        return;
    };
    if app
        .windows
        .get(instance)
        .map(|win| win.click_through)
        .unwrap_or(false)
    {
        return;
    }
    let moved = w::RECT {
        left: card.left + dx,
        top: card.top + dy,
        right: card.right + dx,
        bottom: card.bottom + dy,
    };
    let hwnd = match app.windows.get(instance) {
        Some(win) => win.hwnd(),
        None => return,
    };
    w::move_window(hwnd, moved.left - margin, moved.top - margin);
    if let Some(win) = app.windows.get_mut(instance) {
        win.card = moved;
    }
    let others = other_cards(app, instance);
    let ink = guide_ink(app, instance);
    let (gap, reach, line) = snap_metrics(scale);
    crate::runtime::window::begin_move(
        hwnd,
        crate::runtime::window::DragStart {
            instance: instance.to_string(),
            proxy: app.proxy.clone(),
            margin,
            card: moved,
            peers: others,
            gap,
            reach,
            ink,
            line,
            min: (32, 32),
            max: (0, 0),
        },
    );
}

/// The window's own drag: the same move the page would have asked for, started when the page never
/// saw the press. `dx`/`dy` are how far the pointer has already travelled.
pub(crate) fn drag_by(app: &mut App, instance: &str, dx: i32, dy: i32) {
    let params = serde_json::json!({ "dx": dx, "dy": dy });
    start_drag(app, instance, &params);
}

/// Resizing follows the pointer from the grip instead of the reported delta, so the card tracks
/// the cursor even when the page throttles its events.
fn start_resize(app: &mut App, instance: &str) {
    let Some(inst) = app.instance(instance).cloned() else {
        return;
    };
    if inst.locked && !app.edit_mode {
        return;
    }
    let Some((card, margin, scale)) = current_card(app, instance) else {
        return;
    };
    let Some(manifest) = app.manifest_for(instance) else {
        return;
    };
    if !manifest.size.resizable {
        return;
    }
    let hwnd = match app.windows.get(instance) {
        Some(win) => win.hwnd(),
        None => return,
    };
    let others = other_cards(app, instance);
    let ink = guide_ink(app, instance);
    let (gap, reach, line) = snap_metrics(scale);
    crate::runtime::window::begin_resize(
        hwnd,
        card,
        w::cursor_pos(),
        margin,
        (
            (manifest.size.min_width * scale).round().max(1.0) as i32,
            (manifest.size.min_height * scale).round().max(1.0) as i32,
        ),
        (
            (manifest.size.max_width * scale).round() as i32,
            (manifest.size.max_height * scale).round() as i32,
        ),
        others,
        gap,
        reach,
        ink,
        line,
        app.proxy.clone(),
        instance.to_string(),
    );
}

// ── custom windows ──────────────────────────────────────────────────────

/// `win.*` methods: creation, the `BrowserWindow` surface, and the two message channels.
pub fn custom_call(
    app: &mut App,
    ctx: Option<u32>,
    instance: &str,
    method: &str,
    p: &Value,
) -> BridgeResult<Reply> {
    if method == "win.create" {
        let file = req_str(p, "file")?;
        let options = p.get("options").cloned().unwrap_or_else(|| json!({}));
        let parent = match ctx {
            Some(id) => format!("win:{id}"),
            None => format!("card:{instance}"),
        };
        let id = app.create_custom(CustomSpec {
            parent,
            instance: instance.to_string(),
            file,
            options,
        })?;
        return Ok(Reply::Now(json!({
            "id": id,
            "type": "custom",
            "state": state_json(app, id),
        })));
    }
    let id = ctx
        .or_else(|| p.get("win").and_then(|v| v.as_u64()).map(|v| v as u32))
        .ok_or_else(|| BridgeError::new("this window is not a custom window"))?;
    if method == "win.parent" {
        let channel = jstr(p, "channel").unwrap_or_default();
        let args = p.get("args").cloned().unwrap_or_else(|| json!([]));
        send_to_parent(app, Some(id), &channel, args);
        return Ok(Reply::Now(Value::Null));
    }
    let name = method.trim_start_matches("win.");
    if let Some(why) = unsupported_reason(name) {
        return Ok(Reply::Now(json!({ "unsupported": why })));
    }
    invoke(app, id, name, p)
}

fn invoke(app: &mut App, id: u32, m: &str, p: &Value) -> BridgeResult<Reply> {
    // Everything read-only is snapshotted first: the arms below need `app` mutably.
    let snapshot = {
        let Some(win) = app.customs.get(&id) else {
            return Err(BridgeError::new(format!("no window with id {id}")));
        };
        (
            win.scale(),
            win.bounds(),
            win.content_size(),
            win.title.clone(),
            win.resizable,
            win.closable,
            win.min,
            win.max,
            win.background.clone(),
            win.destroyed,
        )
    };
    let (scale, bounds, content, title, resizable, closable, min, max, background, destroyed) =
        snapshot;
    if destroyed && m != "isDestroyed" {
        return Err(BridgeError::new(format!("window {id} has been destroyed")));
    }
    let (x, y, width, height) = bounds;

    let reply = match m {
        // ── visibility ───────────────────────────────────────────────────
        "show" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_visible(true);
            }
            Value::Null
        }
        "showInactive" => {
            if let Some(win) = app.customs.get(&id) {
                w::show_no_activate(win.hwnd());
            }
            Value::Null
        }
        "hide" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_visible(false);
            }
            Value::Null
        }
        "focus" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_focus();
            }
            Value::Null
        }
        "blur" => {
            if let Some(win) = app.customs.get(&id) {
                let hwnd = win.hwnd();
                let next = unsafe { w::GetWindow(hwnd, w::GW_HWNDNEXT) };
                if next != 0 {
                    unsafe {
                        w::SetForegroundWindow(next);
                    }
                }
            }
            Value::Null
        }
        "close" | "destroy" => {
            app.close_custom(id);
            Value::Bool(true)
        }
        "isVisible" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.window.is_visible())
                .unwrap_or(false),
        ),
        "isDestroyed" => Value::Bool(!app.customs.contains_key(&id)),
        "isFocused" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.window.is_focused())
                .unwrap_or(false),
        ),

        // ── geometry ─────────────────────────────────────────────────────
        "getSize" | "getContentSize" => json!([content.0, content.1]),
        "setSize" | "setContentSize" => {
            let width = jnum(p, "width").unwrap_or(0.0).max(1.0);
            let height = jnum(p, "height").unwrap_or(0.0).max(1.0);
            if let Some(win) = app.customs.get(&id) {
                win.window.set_inner_size(LogicalSize::new(width, height));
            }
            Value::Null
        }
        "getPosition" => json!([x, y]),
        "setPosition" => {
            let nx = jnum(p, "x").unwrap_or(x);
            let ny = jnum(p, "y").unwrap_or(y);
            if let Some(win) = app.customs.get(&id) {
                win.window
                    .set_outer_position(PhysicalPosition::new(
                        from_dip(nx, scale),
                        from_dip(ny, scale),
                    ));
            }
            Value::Null
        }
        "getBounds" | "getNormalBounds" | "getContentBounds" => {
            json!({ "x": x, "y": y, "width": width, "height": height })
        }
        "setBounds" | "setContentBounds" => {
            let nx = jnum(p, "x").unwrap_or(x);
            let ny = jnum(p, "y").unwrap_or(y);
            let nw = jnum(p, "width").unwrap_or(width).max(1.0);
            let nh = jnum(p, "height").unwrap_or(height).max(1.0);
            if let Some(win) = app.customs.get(&id) {
                win.window
                    .set_outer_position(PhysicalPosition::new(
                        from_dip(nx, scale),
                        from_dip(ny, scale),
                    ));
                win.window.set_inner_size(LogicalSize::new(nw, nh));
            }
            Value::Null
        }
        "setMinimumSize" | "setMaximumSize" => {
            let pair = match (jnum(p, "width"), jnum(p, "height")) {
                (Some(a), Some(b)) => Some((a, b)),
                _ => None,
            };
            if let Some(win) = app.customs.get_mut(&id) {
                if m == "setMinimumSize" {
                    win.min = pair;
                    win.window
                        .set_min_inner_size(pair.map(|(a, b)| LogicalSize::new(a, b)));
                } else {
                    win.max = pair;
                    win.window
                        .set_max_inner_size(pair.map(|(a, b)| LogicalSize::new(a, b)));
                }
            }
            Value::Null
        }
        "getMinimumSize" => json!([min.map(|v| v.0).unwrap_or(0.0), min.map(|v| v.1).unwrap_or(0.0)]),
        "getMaximumSize" => json!([max.map(|v| v.0).unwrap_or(0.0), max.map(|v| v.1).unwrap_or(0.0)]),
        "center" => {
            if let Some(win) = app.customs.get(&id) {
                center(&win.window);
            }
            Value::Null
        }
        "setResizable" => {
            let on = jbool(p, "resizable").unwrap_or(true);
            if let Some(win) = app.customs.get_mut(&id) {
                win.resizable = on;
                win.window.set_resizable(on);
            }
            Value::Null
        }
        "isResizable" => Value::Bool(resizable),

        // ── state ────────────────────────────────────────────────────────
        "maximize" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_maximized(true);
            }
            Value::Null
        }
        "unmaximize" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_maximized(false);
            }
            Value::Null
        }
        "isMaximized" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.window.is_maximized())
                .unwrap_or(false),
        ),
        "minimize" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_minimized(true);
            }
            Value::Null
        }
        "restore" => {
            if let Some(win) = app.customs.get(&id) {
                win.window.set_minimized(false);
                win.window.set_visible(true);
            }
            Value::Null
        }
        "isMinimized" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.window.is_minimized())
                .unwrap_or(false),
        ),
        "isNormal" => {
            let normal = app
                .customs
                .get(&id)
                .map(|win| !win.window.is_minimized() && !win.window.is_maximized())
                .unwrap_or(false);
            Value::Bool(normal)
        }
        "setFullScreen" => {
            let on = jbool(p, "flag").unwrap_or(false);
            if let Some(win) = app.customs.get(&id) {
                if on {
                    win.window.set_fullscreen(Some(Fullscreen::Borderless(None)));
                } else {
                    win.window.set_fullscreen(None);
                }
            }
            Value::Null
        }
        "isFullScreen" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.window.fullscreen().is_some())
                .unwrap_or(false),
        ),
        "setClosable" => {
            let on = jbool(p, "closable").unwrap_or(true);
            if let Some(win) = app.customs.get_mut(&id) {
                win.closable = on;
            }
            Value::Null
        }
        "isClosable" => Value::Bool(closable),
        "setAlwaysOnTop" => {
            let on = jbool(p, "flag").unwrap_or(false);
            if let Some(win) = app.customs.get(&id) {
                w::set_topmost(win.hwnd(), on);
            }
            Value::Null
        }
        "isAlwaysOnTop" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.always_on_top())
                .unwrap_or(false),
        ),
        "moveTop" => {
            if let Some(win) = app.customs.get(&id) {
                w::set_topmost(win.hwnd(), true);
            }
            Value::Null
        }
        "setTitle" => {
            let next = jstr(p, "title").unwrap_or_default();
            if let Some(win) = app.customs.get_mut(&id) {
                win.title = next.clone();
                win.window.set_title(&next);
            }
            Value::Null
        }
        "getTitle" => Value::String(title),
        "setSkipTaskbar" => {
            let skip = jbool(p, "skip").unwrap_or(false);
            if let Some(win) = app.customs.get(&id) {
                let hwnd = win.hwnd();
                unsafe {
                    let ex = w::GetWindowLongPtrW(hwnd, w::GWL_EXSTYLE);
                    let next = if skip {
                        ex | w::WS_EX_TOOLWINDOW
                    } else {
                        ex & !w::WS_EX_TOOLWINDOW
                    };
                    w::SetWindowLongPtrW(hwnd, w::GWL_EXSTYLE, next);
                    w::SetWindowPos(
                        hwnd,
                        0,
                        0,
                        0,
                        0,
                        0,
                        w::SWP_NOMOVE
                            | w::SWP_NOSIZE
                            | w::SWP_NOZORDER
                            | w::SWP_NOACTIVATE
                            | w::SWP_FRAMECHANGED,
                    );
                }
            }
            Value::Null
        }
        "setIgnoreMouseEvents" => {
            let ignore = jbool(p, "ignore").unwrap_or(false);
            if let Some(win) = app.customs.get_mut(&id) {
                win.ignore_mouse = ignore;
                w::set_click_through(win.hwnd(), ignore);
            }
            Value::Null
        }
        "setOpacity" => {
            let opacity = jnum(p, "opacity").unwrap_or(1.0);
            if let Some(win) = app.customs.get(&id) {
                set_opacity(win.hwnd(), opacity);
            }
            Value::Null
        }
        "setBackgroundColor" => {
            if let Some(win) = app.customs.get_mut(&id) {
                win.background = jstr(p, "backgroundColor").unwrap_or_default();
            }
            Value::Null
        }
        "getBackgroundColor" => Value::String(background),

        // ── page ─────────────────────────────────────────────────────────
        "reload" | "reloadIgnoringCache" => {
            if let Some(win) = app.customs.get(&id) {
                let _ = win.webview.evaluate_script("location.reload()");
            }
            Value::Null
        }
        "executeJavaScript" => {
            let code = jstr(p, "code").unwrap_or_default();
            if let Some(win) = app.customs.get(&id) {
                let _ = win.webview.evaluate_script(&code);
            }
            Value::Null
        }
        "openDevTools" => {
            if let Some(win) = app.customs.get(&id) {
                win.webview.open_devtools();
            }
            Value::Null
        }
        "closeDevTools" => {
            if let Some(win) = app.customs.get(&id) {
                win.webview.close_devtools();
            }
            Value::Null
        }
        "isDevToolsOpened" => Value::Bool(
            app.customs
                .get(&id)
                .map(|win| win.webview.is_devtools_open())
                .unwrap_or(false),
        ),
        "send" => {
            let channel = jstr(p, "channel").unwrap_or_default();
            let args = p.get("args").cloned().unwrap_or_else(|| json!([]));
            if let Some(win) = app.customs.get(&id) {
                win.send_ipc("ipc", json!({ "channel": channel, "args": args }));
            }
            Value::Null
        }
        "state" => state_json(app, id),
        "id" => json!(id),

        other => json!({ "unsupported": format!("{other} is not available in WinWidget") }),
    };
    Ok(Reply::Now(reply))
}

/// Methods a page may call that have no WebView2 equivalent; the reason travels back to the page so
/// a plugin sees a straight answer instead of a silent no-op.
pub fn unsupported_reason(method: &str) -> Option<&'static str> {
    let list: &[(&str, &str)] = &[
        ("capturePage", "WebView2 的页面截图需要额外接口，暂未接入"),
        ("print", "WebView2 没有暴露打印接口"),
        ("printToPDF", "WebView2 没有暴露打印到 PDF 的接口"),
        ("savePage", "WebView2 没有暴露保存页面接口"),
        ("takeHeapSnapshot", "WebView2 没有暴露堆快照接口"),
        ("loadURL", "自定义窗口创建后不能换地址，需要新开一个窗口"),
        ("loadFile", "自定义窗口创建后不能换地址，需要新开一个窗口"),
        ("setZoomFactor", "WebView2 的缩放没有接入"),
        ("insertCSS", "WebView2 的注入样式没有接入"),
        ("removeInsertedCSS", "WebView2 的注入样式没有接入"),
        ("setAspectRatio", "窗口没有宽高比约束"),
        ("setProgressBar", "任务栏进度条没有接入"),
        ("setVisibleOnAllWorkspaces", "Windows 没有工作区概念"),
        ("setContentProtection", "内容保护没有接入"),
        ("setKiosk", "kiosk 模式没有接入"),
        ("flashFrame", "闪烁窗口没有接入"),
        ("setHasShadow", "阴影跟随系统设置，不能单独控制"),
        ("hasShadow", "阴影跟随系统设置，不能单独查询"),
        ("setEnabled", "禁用窗口没有接入"),
        ("isEnabled", "禁用窗口没有接入"),
        ("enableDeviceEmulation", "设备模拟没有接入"),
        ("disableDeviceEmulation", "设备模拟没有接入"),
        ("findInPage", "页面内查找请用 utools.findInPage（主窗口）或页面自己的搜索"),
        ("stopFindInPage", "页面内查找请用 utools.stopFindInPage（主窗口）"),
    ];
    list
        .iter()
        .find(|(name, _)| *name == method)
        .map(|(_, why)| *why)
}

/// Sends a message to whichever window created `ctx` (`utools.sendToParent`).
pub fn send_to_parent(app: &App, ctx: Option<u32>, channel: &str, args: Value) {
    let parent = match ctx {
        Some(id) => app.customs.get(&id).map(|win| win.parent.clone()),
        None => None,
    };
    let Some(parent) = parent else {
        return;
    };
    let payload = json!({ "channel": channel, "args": args });
    if let Some(id) = parent
        .strip_prefix("win:")
        .and_then(|v| v.parse::<u32>().ok())
    {
        if let Some(win) = app.customs.get(&id) {
            win.send_ipc("ipc", payload);
        }
    } else if let Some(instance) = parent.strip_prefix("card:") {
        app.event_to(instance, "ipc", payload);
    }
}

/// Which instance a custom window belongs to, for storage and origin.
pub fn instance_of(app: &App, win: u32) -> Option<String> {
    app.customs.get(&win).map(|w| w.instance.clone())
}

/// A snapshot of one window's state, so the JS side can answer its getters without a round trip.
pub fn state_json(app: &App, id: u32) -> Value {
    let Some(win) = app.customs.get(&id) else {
        return json!({ "id": id, "destroyed": true });
    };
    let (x, y, width, height) = win.bounds();
    json!({
        "id": id,
        "type": "custom",
        "title": win.title,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "visible": win.window.is_visible(),
        "destroyed": win.destroyed,
        "resizable": win.resizable,
        "closable": win.closable,
        "alwaysOnTop": win.always_on_top(),
        "loaded": win.loaded,
        "file": win.file,
        "parent": win.parent,
        "background": win.background,
        "ignoreMouse": win.ignore_mouse,
    })
}

/// Every custom window still alive, by id.
pub type Registry = HashMap<u32, CustomWin>;
