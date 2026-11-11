//! One card = one borderless, per-pixel-transparent window with a WebView2 inside. The window is
//! `SHADOW_MARGIN` bigger than the card on every side so the page can draw its own shadow;
//! everything the user sees is the card.

use crate::core::config::InstanceConfig;
use crate::model::manifest::Manifest;
use crate::platform::win32 as w;
use crate::runtime::app::Ev;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tao::dpi::{PhysicalPosition, PhysicalSize};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Window, WindowBuilder};
use wry::{Rect, WebContext, WebView, WebViewBuilder};

/// One browser process and one profile for the whole app: every card is created on this context.
/// Without it WebView2 invents `<exe name>.WebView2` next to the executable — a writable-location
/// gamble (`Program Files` fails outright) and litter in whatever folder the user dropped the exe
/// into. The folder itself is `paths::webview_data_dir()`.
static BROWSER: OnceLock<Mutex<WebContext>> = OnceLock::new();

fn browser() -> &'static Mutex<WebContext> {
    BROWSER.get_or_init(|| {
        let dir = crate::core::paths::get().webview_data_dir();
        let _ = std::fs::create_dir_all(&dir);
        Mutex::new(WebContext::new(Some(dir)))
    })
}

pub struct WidgetWin {
    pub window: Window,
    pub webview: WebView,
    pub id: String,
    pub scale: f64,
    /// Padding around the card, in physical pixels.
    pub margin: i32,
    /// The card rectangle in physical screen pixels (the window adds `margin` around it).
    pub card: w::RECT,
    /// The window rectangle as this struct last set or read it. A card that is dragged by the page or
    /// moved by Windows updates it through `sync_bounds`.
    outer: w::RECT,
    /// The size the web view was last told to lay out at. Resizing WebView2 is the expensive half of
    /// every frame, so it only happens when the size really changed.
    view: (i32, i32),
    pub visible: bool,
    pub frosted: bool,
    pub click_through: bool,
    pub layer: String,
}

impl WidgetWin {
    pub fn hwnd(&self) -> w::HWND {
        self.window.hwnd()
    }

    pub fn send(&self, body: &str) {
        // Hand the SDK an object through the same MessageEvent it listens to.
        let script = format!(
            "window.__WV_DELIVER ? window.__WV_DELIVER({body}) : \
             (window.chrome && window.chrome.webview && window.chrome.webview.dispatchEvent(new MessageEvent('message',{{data:{body}}})))",
            body = body
        );
        if let Err(e) = self.webview.evaluate_script(&script) {
            crate::core::logging::warn(&format!("Script to {} failed: {e}", self.id));
        }
    }

    pub fn event(&self, ev: &str, data: Value) {
        self.send(&format!("{{\"ev\":{},\"d\":{}}}", esc_json(ev), data));
    }

    pub fn reply(&self, body: &str) {
        self.send(body);
    }

    /// Moves the window so the card lands on `card`; `margin` is already in physical pixels.
    ///
    /// Only what actually changed is handed to Windows. `place` is called on every appearance
    /// update and on every geometry change, and setting a window's size again — even to the same
    /// size — makes Windows, DWM and WebView2 re-layout: with a handful of transparent cards that
    /// is the flash the user sees while a card is dragged or enlarged.
    pub fn place(&mut self, card: w::RECT, inner: Option<(i32, i32)>) {
        self.card = card;
        let outer = w::inflate(card, self.margin);
        let width = outer.width().max(1);
        let height = outer.height().max(1);
        let moved = outer.left != self.outer.left || outer.top != self.outer.top;
        let sized = width != self.outer.width() || height != self.outer.height();
        if moved {
            self.window
                .set_outer_position(PhysicalPosition::new(outer.left, outer.top));
        }
        if sized {
            self.window.set_inner_size(PhysicalSize::new(width, height));
            self.set_view_size(width, height);
        }
        self.outer = w::RECT {
            left: outer.left,
            top: outer.top,
            right: outer.left + width,
            bottom: outer.top + height,
        };
        if let Some((_, _)) = inner {
            // Kept for callers that need the window client size; nothing more to do.
        }
    }

    /// Tells WebView2 the size to lay out at, unless it already has that size.
    fn set_view_size(&mut self, width: i32, height: i32) {
        if self.view == (width, height) {
            return;
        }
        self.view = (width, height);
        self.webview
            .set_bounds(Rect {
                position: wry::dpi::PhysicalPosition::new(0, 0).into(),
                size: wry::dpi::PhysicalSize::new(width, height).into(),
            })
            .ok();
    }

    /// Keeps the card fixed while the shadow margin changes.
    pub fn set_margin(&mut self, margin: i32) {
        if margin == self.margin {
            return;
        }
        self.margin = margin;
        let card = self.card;
        self.place(card, None);
    }

    /// Re-reads the window after something else moved or resized it, and hands the new size to
    /// WebView2. The browser does not follow the window on its own: without this the page keeps
    /// laying out at the old size and the extra area stays empty.
    pub fn sync_bounds(&mut self) {
        let outer = w::window_rect(self.hwnd());
        let margin = self.margin;
        self.card = w::RECT {
            left: outer.left + margin,
            top: outer.top + margin,
            right: outer.right - margin,
            bottom: outer.bottom - margin,
        };
        self.outer = outer;
        self.set_view_size(outer.width().max(1), outer.height().max(1));
    }

    pub fn show(&mut self) {
        if self.visible {
            return;
        }
        self.visible = true;
        w::show_no_activate(self.hwnd());
        let _ = self.webview.set_visible(true);
        if self.layer == "desktop" {
            w::place_above_desktop(self.hwnd());
        }
        self.restyle();
        // The first show of a window that was created hidden makes DWM composite the non-client
        // frame, and that frame's caption — the window text on a pale strip — lands across the top of
        // the card. One more hide/show before the first present has DWM build the frame from the
        // card's own non-client calculation instead. Both calls happen before any paint, so nothing
        // flickers.
        let hwnd = self.hwnd();
        w::hide(hwnd);
        w::show_no_activate(hwnd);
        if self.layer == "desktop" {
            w::place_above_desktop(hwnd);
        }
    }

    /// Re-applies the borderless frame and asks Windows to recompute the non-client area.
    fn restyle(&self) {
        let hwnd = self.hwnd();
        w::polish_frame(hwnd, self.frosted);
        // The extended frame is what carries the page's per-pixel alpha to the compositor, so it
        // stays on whatever the style; only the acrylic fill is frosted-specific.
        w::extend_frame(hwnd);
        unsafe {
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
        // A frame-changing call makes DWM rebuild its non-client frame, and with the frame extended
        // over the whole window DWM paints that frame's caption — the window text on a pale strip —
        // into the top of the card. Silencing non-client rendering after every rebuild is what keeps
        // the card truly borderless.
        w::disable_nc_rendering(hwnd);
    }

    pub fn hide(&mut self) {
        if !self.visible {
            return;
        }
        self.visible = false;
        let _ = self.webview.set_visible(false);
        w::hide(self.hwnd());
    }

    /// Applies frosted glass / click-through / top-most to match the instance's settings.
    pub fn apply_effects(&mut self, appearance: &Value, click_through: bool, layer: &str) {
        let hwnd = self.hwnd();
        let frosted = appearance
            .get("style")
            .and_then(|v| v.as_str())
            .map(|s| s == "frosted")
            .unwrap_or(false);
        if frosted != self.frosted {
            self.frosted = frosted;
            if frosted {
                let tint = frosted_tint(appearance);
                w::set_acrylic(hwnd, tint);
            } else {
                w::clear_acrylic(hwnd);
            }
            w::polish_frame(hwnd, frosted);
            // Leaving the acrylic also drops per-pixel transparency unless the glass frame is reset,
            // so the frame is re-extended either way.
            w::extend_frame(hwnd);
            unsafe {
                w::SetWindowPos(
                    hwnd,
                    0,
                    0,
                    0,
                    0,
                    0,
                    w::SWP_NOMOVE | w::SWP_NOSIZE | w::SWP_NOZORDER | w::SWP_FRAMECHANGED,
                );
            }
            // The rebuild above would bring the caption back; keep the non-client frame dark.
            w::disable_nc_rendering(hwnd);
        }
        if click_through != self.click_through {
            self.click_through = click_through;
            w::set_click_through(hwnd, click_through);
        }
        if layer != self.layer {
            self.layer = layer.to_string();
            match layer {
                "desktop" => {
                    // Leaving the topmost band first: a card that is still topmost sits above every
                    // app window instead of sinking back into the desktop.
                    w::set_topmost(hwnd, false);
                    w::place_above_desktop(hwnd);
                }
                "top" => {
                    w::detach_from_desktop(hwnd);
                    w::set_topmost(hwnd, true);
                }
                _ => {
                    w::detach_from_desktop(hwnd);
                    w::set_topmost(hwnd, false);
                }
            }
        }
    }
}

pub fn frosted_tint(appearance: &Value) -> u32 {
    let bg = appearance
        .get("background")
        .and_then(|v| v.as_str())
        .unwrap_or("#161822");
    let op = appearance
        .get("backgroundOpacity")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.62)
        .clamp(0.0, 1.0);
    let (r, g, b) = crate::core::util::parse_color(bg).unwrap_or((22, 24, 34));
    let alpha = (0x10 as f64 + op * 0x60 as f64).round() as u32;
    (alpha << 24) | ((b as u32) << 16) | ((g as u32) << 8) | r as u32
}

/// The card rectangle in physical pixels for a config entry.
pub fn card_rect(inst: &InstanceConfig, scale: f64) -> w::RECT {
    let x = inst.x;
    let y = inst.y;
    let w = ((inst.width * scale).round() as i32).max(32);
    let h = ((inst.height * scale).round() as i32).max(32);
    w::RECT {
        left: x,
        top: y,
        right: x + w,
        bottom: y + h,
    }
}

/// Builds the window and its webview on the app's own event loop.
#[allow(clippy::too_many_arguments)] // one call site, and each argument is a distinct piece of setup
pub fn build(
    event_loop: &tao::event_loop::EventLoopWindowTarget<Ev>,
    inst: &InstanceConfig,
    manifest: &Manifest,
    url: String,
    scale: f64,
    margin_dip: i32,
    developer: bool,
    proxy: tao::event_loop::EventLoopProxy<Ev>,
) -> Result<WidgetWin, String> {
    let margin = ((margin_dip as f64) * scale).round() as i32;
    let card = card_rect(inst, scale);
    let outer = w::inflate(card, margin);
    let prog = w::progman();

    let mut builder = WindowBuilder::new()
        .with_title(manifest.display_name())
        .with_decorations(false)
        .with_transparent(true)
        .with_resizable(false)
        .with_skip_taskbar(true)
        .with_visible(false)
        .with_inner_size(PhysicalSize::new(
            outer.width().max(1),
            outer.height().max(1),
        ))
        .with_position(PhysicalPosition::new(outer.left, outer.top));
    if inst.layer == "desktop" && prog != 0 {
        builder = builder.with_owner_window(prog);
    }
    let window = builder.build(event_loop).map_err(|e| e.to_string())?;

    let hwnd = window.hwnd();
    // A popup with no frame of any kind. The style bits Windows would use to draw a caption, a
    // border or a sizing edge are cleared, and `WM_NCCALCSIZE` (below) pins the client rectangle
    // to the whole window, so there is nothing left for Windows to decorate.
    unsafe {
        let style = w::GetWindowLongPtrW(hwnd, w::GWL_STYLE);
        let framed = 0x00CF_0000 | 0x0080_0000; // caption, menu, thick frame, min/max, border
        let styled = (style & !framed) | w::WS_POPUP | w::WS_CLIPCHILDREN;
        w::SetWindowLongPtrW(hwnd, w::GWL_STYLE, styled);
        let ex = w::GetWindowLongPtrW(hwnd, w::GWL_EXSTYLE) | w::WS_EX_TOOLWINDOW;
        w::SetWindowLongPtrW(hwnd, w::GWL_EXSTYLE, ex);
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
    // A card that starts life in the topmost band has to be put there explicitly: the layer diff
    // in `apply_effects` only fires on a change, and a card built as "top" would otherwise open as
    // an ordinary window and slide under every app.
    if inst.layer == "top" {
        w::set_topmost(hwnd, true);
    }
    w::extend_frame(hwnd);
    // tao asks Windows for the inner size and Windows answers by padding the window for a frame it
    // thinks it has; with the frame gone and `WM_NCCALCSIZE` pinned, the window has to be set to the
    // size the card actually needs, or every card would carry a stray 16×9 strip on its right and
    // bottom edges — and the saved geometry would come out wrong as well.
    w::resize_window(
        hwnd,
        outer.left,
        outer.top,
        outer.width().max(1),
        outer.height().max(1),
    );
    // The DWM border is the last thing that made a borderless card look framed; the corner
    // preference has to follow the frosted style, so it is applied again in `apply_effects`.
    w::polish_frame(hwnd, false);
    // The glass frame stays on even for a plain transparent card: that is what hands the DWM the
    // per-pixel alpha the page paints with, so the rounded corners show the desktop instead of a
    // black box. DWM draws that frame's caption over the card top unless non-client rendering is
    // switched off, which is what `disable_nc_rendering` does.
    w::extend_frame(hwnd);
    w::disable_nc_rendering(hwnd);
    install_proc(hwnd);
    remember(hwnd, &inst.id, proxy.clone());
    if inst.layer == "desktop" {
        w::place_above_desktop(hwnd);
    }

    let id = inst.id.clone();
    let ipc_id = id.clone();
    let webview = {
        let mut context = browser()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        WebViewBuilder::new_with_web_context(&mut context)
            .with_url(&url)
            .with_transparent(true)
            .with_devtools(developer)
            .with_initialization_script(crate::runtime::shim::SCRIPT)
            .with_ipc_handler(move |request| {
                let body = request.body().clone();
                crate::runtime::app::post(
                    &proxy,
                    Ev::Ipc {
                        win: ipc_id.clone(),
                        msg: body,
                    },
                );
            })
            .with_bounds(Rect {
                position: wry::dpi::PhysicalPosition::new(0, 0).into(),
                size: wry::dpi::PhysicalSize::new(outer.width().max(1), outer.height().max(1))
                    .into(),
            })
            .build(&window)
            .map_err(|e| format!("WebView2 could not be created: {e}"))?
    };

    Ok(WidgetWin {
        window,
        webview,
        id,
        scale,
        margin,
        card,
        outer,
        view: (outer.width().max(1), outer.height().max(1)),
        visible: false,
        frosted: false,
        click_through: false,
        layer: inst.layer.clone(),
    })
}

// ── dragging and resizing ───────────────────────────────────────────────────

use std::collections::HashMap;
use std::sync::LazyLock;

/// What a drag needs to know while the pointer moves. It sits beside the window handle rather than
/// in the app, because the window procedure runs while the app is blocked inside the move loop.
struct DragCtx {
    instance: String,
    proxy: tao::event_loop::EventLoopProxy<Ev>,
    margin: i32,
    peers: Vec<w::RECT>,
    gap: i32,
    reach: i32,
    ink: u32,
    /// Guide line: thickness, dash and gap, already scaled for the screen.
    line: (i32, i32, i32),
    resizing: crate::runtime::snap::Edges,
    min: (i32, i32),
    max: (i32, i32),
    /// The card and the pointer when the drag began: every later position is measured from here,
    /// so a slow drag never sticks to a line it already snapped to.
    anchor_card: w::RECT,
    anchor_cursor: w::POINT,
    moves: u32,
}

fn contexts() -> &'static Mutex<HashMap<usize, DragCtx>> {
    static CTX: OnceLock<Mutex<HashMap<usize, DragCtx>>> = OnceLock::new();
    CTX.get_or_init(|| Mutex::new(HashMap::new()))
}

fn old_procs() -> &'static Mutex<HashMap<usize, isize>> {
    static OLD: OnceLock<Mutex<HashMap<usize, isize>>> = OnceLock::new();
    OLD.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Which card a window belongs to, and how to reach the app: needed from the window procedure,
/// which cannot borrow the app.
struct WindowMeta {
    instance: String,
    proxy: tao::event_loop::EventLoopProxy<Ev>,
    /// When this window last reported its size to the app (`WM_SIZE` throttling).
    last_bounds: std::time::Instant,
}

fn meta() -> &'static Mutex<HashMap<usize, WindowMeta>> {
    static META: OnceLock<Mutex<HashMap<usize, WindowMeta>>> = OnceLock::new();
    META.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember(hwnd: w::HWND, instance: &str, proxy: tao::event_loop::EventLoopProxy<Ev>) {
    if let Ok(mut map) = meta().lock() {
        map.insert(
            hwnd as usize,
            WindowMeta {
                instance: instance.to_string(),
                proxy,
                // The web view is already built at the right size, so the first report may wait a frame.
                last_bounds: std::time::Instant::now(),
            },
        );
    }
}

fn previous_proc(hwnd: w::HWND) -> isize {
    old_procs()
        .lock()
        .ok()
        .and_then(|m| m.get(&(hwnd as usize)).copied())
        .unwrap_or(0)
}

/// The card whose window is under the given screen point. A card is looked up through the window
/// actually hit there, so a card hidden behind an app window, a click-through card and the drop
/// shadow margin all answer correctly.
fn card_at(pt: w::POINT) -> Option<(w::HWND, String)> {
    unsafe {
        let mut hwnd = w::WindowFromPoint(pt);
        while hwnd != 0 {
            let found = meta()
                .lock()
                .ok()
                .and_then(|m| m.get(&(hwnd as usize)).map(|meta| meta.instance.clone()));
            if let Some(instance) = found {
                return Some((hwnd, instance));
            }
            hwnd = w::GetParent(hwnd);
        }
    }
    None
}

fn is_dragging(hwnd: w::HWND) -> bool {
    contexts()
        .lock()
        .map(|m| m.contains_key(&(hwnd as usize)))
        .unwrap_or(false)
}

/// Windows whose page says it is using the press itself — a volume fader, a text field, a slider.
static PRESS_CLAIMED: LazyLock<Mutex<HashSet<usize>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// The page took the press: a control is being dragged inside the card, not the card itself. The
/// watcher below must leave that window alone until the button comes up.
pub fn claim_press(hwnd: w::HWND) {
    if let Ok(mut set) = PRESS_CLAIMED.lock() {
        set.insert(hwnd as usize);
    }
}

fn press_claimed(hwnd: w::HWND) -> bool {
    PRESS_CLAIMED
        .lock()
        .map(|set| set.contains(&(hwnd as usize)))
        .unwrap_or(false)
}

fn clear_press_claims() {
    if let Ok(mut set) = PRESS_CLAIMED.lock() {
        set.clear();
    }
}

/// Falls back to a card drag the window can do on its own.
///
/// The page asks for the drag (`window.drag`), and that is the normal path: it knows where the
/// press landed, so a text field can keep its selection. When the web view never receives the
/// press — a synthetic click, a card behind a full-screen app, a web view that missed the input
/// while another window was active — the card would sit still and read as broken. So while the
/// left button is held the pointer is watched here too, and once it has travelled far enough
/// without the page claiming the press, the card follows the pointer anyway.
pub fn watch_presses(proxy: tao::event_loop::EventLoopProxy<Ev>) {
    std::thread::spawn(move || {
        let mut button = false;
        let mut armed: Option<(w::HWND, String, w::POINT, std::time::Instant)> = None;
        let mut claimed = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(if button {
                6
            } else {
                16
            }));
            let down = w::left_button_down();
            if !down {
                button = false;
                armed = None;
                claimed = false;
                clear_press_claims();
                continue;
            }
            if !button {
                // The press itself: remember which card it landed on, if any.
                button = true;
                let press = w::cursor_pos();
                armed = card_at(press)
                    .map(|(hwnd, instance)| (hwnd, instance, press, std::time::Instant::now()));
                continue;
            }
            let Some((hwnd, instance, press, since)) = armed.clone() else {
                continue;
            };
            if claimed {
                continue;
            }
            let cursor = w::cursor_pos();
            let dx = cursor.x - press.x;
            let dy = cursor.y - press.y;
            // A page that is alive claims the drag within a few pixels and a few milliseconds; the
            // wait below keeps the two paths from starting the same drag twice.
            if dx.abs() < 8 && dy.abs() < 8 {
                continue;
            }
            if since.elapsed() < std::time::Duration::from_millis(110) || is_dragging(hwnd) {
                continue;
            }
            // The page is alive and using this press for its own control: dropping a fader or
            // sweeping a slider must not turn into a card drag.
            if press_claimed(hwnd) {
                continue;
            }
            claimed = true;
            let _ = crate::runtime::app::post(
                &proxy,
                Ev::Command(format!("autodrag:{instance}:{dx}:{dy}")),
            );
        }
    });
}

/// Chains onto tao's window procedure so the card can take part in the native move and size loops.
fn install_proc(hwnd: w::HWND) {
    unsafe {
        let previous = w::SetWindowLongPtrW(hwnd, w::GWLP_WNDPROC, card_proc as *const () as isize);
        if previous != 0 {
            let _ = old_procs()
                .lock()
                .map(|mut m| m.insert(hwnd as usize, previous));
        }
    }
}

unsafe extern "system" fn card_proc(hwnd: w::HWND, msg: u32, wp: usize, lp: isize) -> isize {
    match msg {
        // No non-client area at all: the client rectangle *is* the window rectangle. Without this
        // Windows keeps a few pixels of frame around a borderless window and the card looks framed.
        w::WM_NCCALCSIZE if wp != 0 => return 0,
        w::WM_MOVING => {
            if let Some(rect) = drag_rect(hwnd, lp, false) {
                (*(lp as *mut w::RECT)) = rect;
                return 1;
            }
        }
        w::WM_SIZING => {
            if let Some(rect) = drag_rect(hwnd, lp, true) {
                (*(lp as *mut w::RECT)) = rect;
                return 1;
            }
        }
        w::WM_EXITSIZEMOVE => {
            crate::platform::guides::hide();
            if let Some(ctx) = take_context(hwnd) {
                let _ = crate::runtime::app::post(
                    &ctx.proxy,
                    Ev::Command(format!("geometry:{}", ctx.instance)),
                );
            }
        }
        // Anything that changes the size (a resize, a DPI change, the user's own window command)
        // has to reach the web view, which never follows the window on its own. Windows sends this
        // once per `SetWindowPos` and the resize loop runs every 8 ms, so the reports are thinned
        // out to one per frame: each report costs a WebView2 re-layout on the UI thread, and a
        // thread kept busy that way is what makes the other cards blink too. The end of a resize
        // always reports again (`begin_resize`), so nothing is lost.
        w::WM_SIZE => {
            let todo = meta().lock().ok().and_then(|mut m| {
                let meta = m.get_mut(&(hwnd as usize))?;
                if meta.last_bounds.elapsed() < std::time::Duration::from_millis(16) {
                    return None;
                }
                meta.last_bounds = std::time::Instant::now();
                Some((meta.instance.clone(), meta.proxy.clone()))
            });
            if let Some((instance, proxy)) = todo {
                let _ =
                    crate::runtime::app::post(&proxy, Ev::Command(format!("bounds:{instance}")));
            }
        }
        // DWM decides to draw its caption whenever the window is (re)shown or activated for the
        // first time; stating the policy again here is what keeps the top of the card clean.
        w::WM_SHOWWINDOW if wp != 0 => {
            w::extend_frame(hwnd);
            w::disable_nc_rendering(hwnd);
        }
        w::WM_ACTIVATE => {
            w::disable_nc_rendering(hwnd);
        }
        // Activating a card — a click — is the moment the frame would be painted: the caption strip
        // across the top and the 1px border around the card. The card has no non-client area at all,
        // so it answers the activation itself and never lets Windows paint that frame.
        w::WM_NCACTIVATE => {
            w::disable_nc_rendering(hwnd);
            return 1;
        }
        w::WM_NCPAINT => {
            w::disable_nc_rendering(hwnd);
            return 0;
        }
        _ => {}
    }
    let previous = previous_proc(hwnd);
    if previous == 0 {
        w::DefWindowProcW(hwnd, msg, wp, lp)
    } else {
        w::CallWindowProcW(previous, hwnd, msg, wp, lp)
    }
}

fn take_context(hwnd: w::HWND) -> Option<DragCtx> {
    contexts().lock().ok()?.remove(&(hwnd as usize))
}

/// The window rectangle the drag wants, after snapping. `resizing` limits the change to the
/// bottom-right corner.
fn drag_rect(hwnd: w::HWND, lp: isize, resizing: bool) -> Option<w::RECT> {
    let mut guard = contexts().lock().ok()?;
    let ctx = guard.get_mut(&(hwnd as usize))?;
    ctx.moves += 1;
    let ctx = &*ctx;
    let proposed = unsafe { *(lp as *const w::RECT) };
    let margin = ctx.margin;
    let (work, _) = w::monitor_work_area(&proposed);

    let card = if resizing {
        w::RECT {
            left: proposed.left + margin,
            top: proposed.top + margin,
            right: proposed.right - margin,
            bottom: proposed.bottom - margin,
        }
    } else {
        let cursor = w::cursor_pos();
        let dx = cursor.x - ctx.anchor_cursor.x;
        let dy = cursor.y - ctx.anchor_cursor.y;
        w::RECT {
            left: ctx.anchor_card.left + dx,
            top: ctx.anchor_card.top + dy,
            right: ctx.anchor_card.right + dx,
            bottom: ctx.anchor_card.bottom + dy,
        }
    };

    let edges = if resizing {
        ctx.resizing
    } else {
        crate::runtime::snap::Edges::NONE
    };

    // Ctrl places the card freely, and no guides are drawn.
    let (card, guides) = if w::ctrl_down() {
        crate::platform::guides::hide();
        (card, Vec::new())
    } else {
        crate::runtime::snap::snap(
            card, work, &ctx.peers, ctx.gap, ctx.reach, edges, ctx.min, ctx.max,
        )
    };
    if guides.is_empty() {
        crate::platform::guides::hide();
    } else {
        let (thickness, dash, space) = ctx.line;
        crate::platform::guides::show(&guides, ctx.ink, thickness, dash, space);
    }

    Some(w::inflate(card, margin))
}

pub struct DragStart {
    pub instance: String,
    pub proxy: tao::event_loop::EventLoopProxy<Ev>,
    pub margin: i32,
    pub card: w::RECT,
    pub peers: Vec<w::RECT>,
    pub gap: i32,
    pub reach: i32,
    pub ink: u32,
    pub line: (i32, i32, i32),
    pub min: (i32, i32),
    pub max: (i32, i32),
}

/// Starts a drag. The card follows the pointer here rather than through Windows' modal move loop:
/// the loop runs on the UI thread, which stalls the page and the paint for as long as the drag
/// lasts, and that reads as a card that lags behind the cursor and stutters.
pub fn begin_move(hwnd: w::HWND, start: DragStart) {
    let cursor = w::cursor_pos();
    let ctx = DragCtx {
        instance: start.instance,
        proxy: start.proxy,
        margin: start.margin,
        peers: start.peers,
        gap: start.gap,
        reach: start.reach,
        ink: start.ink,
        line: start.line,
        resizing: crate::runtime::snap::Edges::NONE,
        min: start.min,
        max: start.max,
        anchor_card: start.card,
        anchor_cursor: cursor,
        moves: 0,
    };
    if let Ok(mut map) = contexts().lock() {
        map.insert(hwnd as usize, ctx);
    }
    follow_pointer(hwnd);
}

/// Drags the card with the pointer, snapping the same way the native loop does, until release. It
/// runs on its own thread so the page keeps painting while the card is moving.
fn follow_pointer(hwnd: w::HWND) {
    std::thread::spawn(move || {
        let mut proposed = w::window_rect(hwnd);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(4));
            let Some(rect) = drag_rect(hwnd, &mut proposed as *mut w::RECT as isize, false) else {
                break;
            };
            if rect.left != proposed.left || rect.top != proposed.top {
                w::move_window(hwnd, rect.left, rect.top);
                proposed = rect;
            }
            if !w::left_button_down() {
                break;
            }
        }
        unsafe {
            w::SendMessageW(hwnd, w::WM_EXITSIZEMOVE, 0, 0);
        }
    });
}

/// Resizing keeps its own small loop: the corner grip has to grow the window *and* the web view
/// inside it, which only the app can do, so this one reports back instead of running modally.
#[allow(clippy::too_many_arguments)]
pub fn begin_resize(
    hwnd: w::HWND,
    start: w::RECT,
    cursor: w::POINT,
    margin: i32,
    min: (i32, i32),
    max: (i32, i32),
    peers: Vec<w::RECT>,
    gap: i32,
    reach: i32,
    ink: u32,
    line: (i32, i32, i32),
    done: tao::event_loop::EventLoopProxy<Ev>,
    instance: String,
) {
    std::thread::spawn(move || {
        let anchor = start;
        let mut last = start;
        let mut last_report = std::time::Instant::now();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(8));
            if !w::left_button_down() {
                break;
            }
            let p = w::cursor_pos();
            let dx = p.x - cursor.x;
            let dy = p.y - cursor.y;
            let mut card = anchor;
            card.right =
                (anchor.right + dx).clamp(anchor.left + min.0, anchor.left + max.0.max(min.0));
            card.bottom =
                (anchor.bottom + dy).clamp(anchor.top + min.1, anchor.top + max.1.max(min.1));
            let (work, _) = w::monitor_work_area(&card);
            let (card, guides) = if w::ctrl_down() {
                crate::platform::guides::hide();
                (card, Vec::new())
            } else {
                crate::runtime::snap::snap(
                    card,
                    work,
                    &peers,
                    gap,
                    reach,
                    crate::runtime::snap::Edges::RIGHT,
                    min,
                    max,
                )
            };
            if guides.is_empty() {
                crate::platform::guides::hide();
            } else {
                let (thickness, dash, space) = line;
                crate::platform::guides::show(&guides, ink, thickness, dash, space);
            }
            let outer = w::inflate(card, margin);
            if outer.width() != last.width() || outer.height() != last.height() {
                last = outer;
                w::resize_window(hwnd, outer.left, outer.top, outer.width(), outer.height());
                if last_report.elapsed() > std::time::Duration::from_millis(30) {
                    last_report = std::time::Instant::now();
                    let _ =
                        crate::runtime::app::post(&done, Ev::Command(format!("bounds:{instance}")));
                }
            }
        }
        crate::platform::guides::hide();
        let _ = crate::runtime::app::post(&done, Ev::Command(format!("bounds:{instance}")));
        let _ = crate::runtime::app::post(&done, Ev::Command(format!("geometry:{instance}")));
    });
}

fn esc_json(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}
