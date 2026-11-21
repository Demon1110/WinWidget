//! The host itself: owns the config, the windows, the tray and the data the pages see.

use crate::core::config::{AppConfig, ConfigStore, InstanceConfig};
use crate::core::ports::{EventsHost, ScheduleHost};
use crate::model::appearance::SHADOW_MARGIN_DIP;
use crate::model::manifest::Manifest;
use crate::platform::tray::TrayHandle;
use crate::runtime::window::WidgetWin;
use crate::ui::server::{self, Host, Instance, ServeState};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use tao::event_loop::EventLoopProxy;
use tao::platform::windows::WindowExtWindows;

pub const CONTROL_WIN: &str = "$control";
pub const CONTROL_TITLE: &str = "WinWidget";
pub const CONTROL_URL: &str = "/__ui/control-center/index.html";

// The event protocol and its guarded poster now live in `core::bus`, where the capability
// modules can reach them without depending on this (runtime) module. Re-exported here so
// every existing `runtime::app::Ev` / `runtime::app::post` caller keeps working unchanged.
pub use crate::core::bus::{begin_build, end_build, post, Ev};

/// What the toolbar / card state needs to know about one mounted card.
#[derive(Clone)]
pub struct Boot {
    pub instance_id: String,
    pub widget_id: String,
    pub widget_version: String,
    pub locked: bool,
    pub layer: String,
    pub click_through: bool,
    pub resizable: bool,
    pub width: f64,
    pub height: f64,
    pub grow: f64,
    pub developer: bool,
    pub permissions: Vec<String>,
    /// Whether the card is on screen right now, so a page that starts hidden does not pretend it
    /// was just shown. The page takes it from here until the host sends `show`/`hide`.
    pub visible: bool,
}

pub struct ControlWin {
    pub window: tao::window::Window,
    pub webview: wry::WebView,
    pub ready: bool,
}

#[derive(Clone)]
pub struct PendingNote {
    pub at: i64,
    pub tag: String,
    pub title: String,
    pub body: String,
    pub instance: String,
}

pub struct App {
    pub store: ConfigStore,
    pub catalog: crate::model::catalog::Catalog,
    pub themes: crate::model::themes::Themes,
    pub storage: crate::core::storage::StorageStore,
    pub serve: ServeState,
    pub port: u16,
    pub windows: HashMap<String, WidgetWin>,
    /// The custom windows widgets opened (`utools.createBrowserWindow`), by their id.
    pub customs: crate::runtime::window_category::Registry,
    /// Windows asked for by a page and still owed to the event loop, which is the only place a
    /// window may be created.
    pub pending_customs: Vec<(u32, crate::runtime::window_category::CustomSpec)>,
    next_custom: u32,
    /// 模态弹框：弹框 id → 被禁用的父窗口句柄。弹框关掉时按这张表恢复父窗口的输入。
    pub modal_parents: std::collections::HashMap<u32, isize>,
    pub control: Option<ControlWin>,
    pub control_pending: bool,
    pub want_control: bool,
    pub edit_mode: bool,
    pub sampling: HashMap<String, (Vec<String>, u64)>,
    pub audio_subs: HashSet<String>,
    pub media_subs: HashSet<String>,
    pub monitor: crate::runtime::monitor::Monitor,
    pub tray: Option<TrayHandle>,
    pub proxy: EventLoopProxy<Ev>,
    pub notes: Vec<PendingNote>,
    pub staged: HashMap<String, crate::market::packages::Staged>,
    pub update: Value,
    pub pending_windows: Vec<String>,
    pub want_devtools: Option<String>,
    pub quitting: bool,
    /// When `quitting` is set, how long the pages still get to answer their `unload`: a widget that
    /// saves on the way out needs the message channel to stay open a moment longer.
    pub quit_at: Option<std::time::Instant>,
    /// Set by `finish_quit`, so the loop's second call (from `LoopDestroyed`) does not save twice.
    quit_done: bool,
    pub hotkeys_paused: bool,
    /// The last window of another program that had the foreground. Hiding a card to paste or type
    /// hands the keyboard back to it — z-order alone picks our own windows or a background terminal.
    pub last_foreign_focus: isize,
    /// What Windows said last time we asked, so a change can be noticed without a notification.
    /// Only "auto" needs it; a pinned light/dark never reads it.
    pub system_light: bool,
    theme_check_ms: i64,
    fullscreen_ticks: u32,
    fullscreen_area: Option<crate::platform::win32::RECT>,
    /// The virtual desktop id seen on the previous `sync_desktop`, so a switch can be acted on
    /// exactly once instead of on every poll.
    last_desktop: Option<String>,
    /// 输入脉冲的计数，只用来给「直角窗口区域复查」分频（10ms 一个脉冲，20 个约 200ms）。
    square_ticks: u32,
}

fn same_area(
    a: &Option<crate::platform::win32::RECT>,
    b: &Option<crate::platform::win32::RECT>,
) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => {
            x.left == y.left && x.top == y.top && x.right == y.right && x.bottom == y.bottom
        }
        (None, None) => true,
        _ => false,
    }
}

/// Points cards that still use a widget's previous id at the installed replacement. The mapping
/// comes from each widget's `aliases` declaration, never from a hardcoded widget name.
fn adopt_renamed_instances(
    instances: &mut [InstanceConfig],
    catalog: &crate::model::catalog::Catalog,
) -> bool {
    let mut changed = false;
    for inst in instances.iter_mut() {
        for (old, new) in catalog.renames() {
            if inst.widget.eq_ignore_ascii_case(old) && !inst.widget.eq_ignore_ascii_case(new) {
                inst.widget = new.to_string();
                changed = true;
                break;
            }
        }
    }
    changed
}

/// Same monitor rect on both sides, including "neither has one".
impl App {
    pub fn new(proxy: EventLoopProxy<Ev>) -> App {
        let mut store = ConfigStore::load();
        // Older configs had a separate click-through switch. Locking is the only source now,
        // so bring the persisted style in line before any window is built.
        for inst in store.data.instances.iter_mut() {
            inst.click_through = inst.locked;
        }
        let mut catalog = crate::model::catalog::Catalog::default();
        catalog.scan();
        // A widget that declares aliases keeps its documents under its current id; old namespaces
        // are renamed once, before any card is opened.
        for (old, new) in catalog.renames() {
            crate::core::db::migrate_namespace(old, new);
        }
        if adopt_renamed_instances(&mut store.data.instances, &catalog) {
            store.save();
        }
        let themes = crate::model::themes::Themes::load();
        let serve = ServeState::default();
        let port = match server::start(serve.clone()) {
            Ok(p) => p,
            Err(e) => {
                crate::core::logging::error(&e);
                0
            }
        };
        let monitor = crate::runtime::monitor::start(proxy.clone());
        crate::core::logging::info(&format!("Serving pages on 127.0.0.1:{port}"));
        // The alignment lines are created here, on the thread that owns the cards, so the drag
        // code only ever pushes pixels into windows that already exist.
        crate::platform::guides::init();
        let mut app = App {
            store,
            catalog,
            themes,
            storage: crate::core::storage::StorageStore::default(),
            serve,
            port,
            windows: HashMap::new(),
            customs: HashMap::new(),
            pending_customs: Vec::new(),
            next_custom: 1,
            modal_parents: std::collections::HashMap::new(),
            control: None,
            control_pending: false,
            want_control: true,
            edit_mode: false,
            sampling: HashMap::new(),
            audio_subs: HashSet::new(),
            media_subs: HashSet::new(),
            monitor,
            tray: None,
            proxy,
            notes: Vec::new(),
            staged: HashMap::new(),
            update: json!({ "status": "idle", "current": crate::APP_VERSION }),
            pending_windows: Vec::new(),
            want_devtools: None,
            quitting: false,
            quit_at: None,
            quit_done: false,
            hotkeys_paused: false,
            last_foreign_focus: 0,
            system_light: crate::platform::system_light(),
            theme_check_ms: 0,
            fullscreen_ticks: 0,
            fullscreen_area: None,
            last_desktop: None,
            square_ticks: 0,
        };
        app.boot_defaults();
        app.start_tray();
        app.sync_serve();
        for id in app
            .store
            .data
            .instances
            .iter()
            .map(|i| i.id.clone())
            .collect::<Vec<_>>()
        {
            app.pending_windows.push(id);
        }
        app
    }

    // ── config access ───────────────────────────────────────────────────────

    pub fn cfg(&self) -> &AppConfig {
        &self.store.data
    }

    pub fn cfg_mut(&mut self) -> &mut AppConfig {
        &mut self.store.data
    }

    pub fn save(&self) {
        self.store.save();
    }

    /// Repoints cards whose widget declared an alias, then reapplies the catalog. Called after an
    /// install rescans the catalog so an old card adopts the replacement instead of going dead.
    pub fn adopt_renamed_widgets(&mut self) -> bool {
        let changed = adopt_renamed_instances(&mut self.store.data.instances, &self.catalog);
        if changed {
            self.save();
        }
        changed
    }

    pub fn instance(&self, id: &str) -> Option<&InstanceConfig> {
        self.store.data.instances.iter().find(|i| i.id == id)
    }

    pub fn instance_mut(&mut self, id: &str) -> Option<&mut InstanceConfig> {
        self.store.data.instances.iter_mut().find(|i| i.id == id)
    }

    pub fn manifest_for(&self, instance_id: &str) -> Option<Manifest> {
        let inst = self.instance(instance_id)?;
        self.catalog.find(&inst.widget).cloned()
    }

    /// The look actually in effect for an instance (theme + global + its own tweaks).
    pub fn look(&self, inst: &InstanceConfig) -> Map<String, Value> {
        crate::model::appearance::effective(&self.themes, &self.store.data, Some(inst))
    }

    /// First run: put a clock and the system monitor on the screen so the desktop isn't empty.
    fn boot_defaults(&mut self) {
        if self.store.data.first_run_done {
            return;
        }
        for widget in ["winwidget.clock", "winwidget.sysinfo"] {
            let Some(manifest) = self.catalog.find(widget).cloned() else {
                continue;
            };
            let width = manifest.size.width;
            let height = manifest.size.height;
            let (slot_x, slot_y) = self.free_slot(width, height);
            let inst = InstanceConfig {
                widget: widget.to_string(),
                width,
                height,
                x: slot_x,
                y: slot_y,
                ..InstanceConfig::default()
            };
            self.store.data.instances.push(inst);
        }
        self.store.data.first_run_done = true;
        self.save();
    }

    /// Left, right and bottom of the primary monitor's work area, in physical pixels.
    fn primary_work_area(&self) -> (i32, i32, i32) {
        let rect = crate::platform::win32::RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        let (_, work) = crate::platform::win32::monitor_work_area(&rect);
        (work.left, work.right, work.bottom)
    }

    // ── page data ───────────────────────────────────────────────────────────

    pub fn boot(&self, inst: &InstanceConfig, manifest: &Manifest) -> Boot {
        Boot {
            instance_id: inst.id.clone(),
            widget_id: manifest.id.clone(),
            widget_version: manifest.version.clone(),
            locked: inst.locked,
            layer: inst.layer.clone(),
            click_through: inst.click_through,
            resizable: manifest.size.resizable,
            width: inst.width,
            height: inst.height,
            grow: manifest.size.grow,
            developer: self.store.data.developer_mode,
            permissions: crate::model::permissions::allowed(&self.store.data, manifest),
            visible: !self.store.data.hide_all,
        }
    }

    /// Settings a widget sees: its manifest defaults, then whatever this instance stored.
    pub fn settings_for(&self, inst: &InstanceConfig, manifest: &Manifest) -> Map<String, Value> {
        let mut out = Map::new();
        for spec in &manifest.settings {
            if let Some(default) = spec.default.clone() {
                out.insert(spec.key.clone(), crate::core::text::pick_value(&default));
            }
        }
        for (k, v) in &inst.settings {
            out.insert(k.clone(), v.clone());
        }
        out
    }

    pub fn appearance_payload(&self, inst: &InstanceConfig) -> Value {
        let theme = crate::model::appearance::theme_of(&self.themes, &self.store.data, Some(inst));
        let all = self.look(inst);
        let (theme_css, user_css) =
            crate::model::appearance::page_css(&self.themes, &self.store.data, inst);
        json!({
            "theme": theme.id,
            "themeHref": theme.css_href(),
            "style": crate::model::appearance::style(&all),
            "shadow": crate::model::appearance::shadow(&all),
            "margin": crate::model::appearance::margin_dip(&all),
            "themeCss": theme_css,
            "userCss": user_css,
            "values": all,
        })
    }

    pub fn state_payload(&self, inst: &InstanceConfig, manifest: &Manifest) -> Value {
        let name = manifest.display_name();
        json!({
            "locked": inst.locked,
            "layer": inst.layer,
            "clickThrough": inst.click_through,
            "edit": self.edit_mode,
            "label": format!("{}  {} × {}", name, inst.width.round() as i64, inst.height.round() as i64),
        })
    }

    /// Rebuilds what the local server hands out: one entry per mounted card, plus their hosts.
    pub fn sync_serve(&mut self) {
        let mut hosts = HashMap::new();
        let mut instances = HashMap::new();
        for m in self.catalog.all() {
            let allowed = crate::model::permissions::allowed(&self.store.data, m);
            hosts.insert(
                m.host_name(),
                Host {
                    widget_id: m.id.clone(),
                    dir: m.dir.clone(),
                    entry: m.entry.clone(),
                    csp: crate::model::permissions::content_security_policy(&allowed),
                    theme_href: String::new(),
                },
            );
        }
        for inst in &self.store.data.instances {
            let Some(manifest) = self.catalog.find(&inst.widget).cloned() else {
                continue;
            };
            let boot = self.boot(inst, &manifest);
            let settings = self.settings_for(inst, &manifest);
            let appearance = self.appearance_payload(inst);
            let state = self.state_payload(inst, &manifest);
            let boot_text = server::boot_json(&boot, &settings, &appearance, &state);
            let mut folders = HashMap::new();
            for spec in &manifest.settings {
                if spec.r#type == "folder" {
                    let value = inst.settings.get(&spec.key).cloned();
                    let folder = crate::platform::files::folder_from_setting(value.as_ref());
                    if !folder.as_os_str().is_empty() {
                        folders.insert(spec.key.clone(), folder);
                    }
                }
            }
            let (theme_css, user_css) =
                crate::model::appearance::page_css(&self.themes, &self.store.data, inst);
            let theme =
                crate::model::appearance::theme_of(&self.themes, &self.store.data, Some(inst));
            instances.insert(
                inst.id.clone(),
                Instance {
                    host: manifest.host_name(),
                    boot: boot_text,
                    theme_href: theme.css_href(),
                    theme_css,
                    user_css,
                    folders,
                },
            );
        }
        let mut st = self.serve.lock();
        st.hosts = hosts;
        st.instances = instances;
        // Custom windows are pages of their instance: the server only needs to know which window
        // belongs where, so it can hand that page its own boot data (`windowType: "custom"`).
        st.wins.clear();
        for (id, win) in &self.customs {
            st.wins.insert(
                *id,
                server::WinPage {
                    instance: win.instance.clone(),
                    visible: win.shown,
                    resizable: win.resizable,
                },
            );
        }
    }

    pub fn page_url(&self, manifest: &Manifest, instance_id: &str) -> String {
        format!(
            "http://{}:{}/{}?w={}",
            manifest.host_name(),
            self.port,
            manifest.entry.replace('\\', "/"),
            instance_id
        )
    }

    pub fn control_url(&self) -> String {
        format!(
            "http://{}:{}{}",
            server::CONTROL_HOST,
            self.port,
            CONTROL_URL
        )
    }

    // ── messages to pages ──────────────────────────────────────────────────

    pub fn send_to(&self, win: &str, body: &str) {
        if win == CONTROL_WIN {
            if let Some(c) = &self.control {
                let _ = c.webview.evaluate_script(&format!(
                    "window.__WV_DELIVER && window.__WV_DELIVER({body})"
                ));
            }
        } else if let Some(w) = self.windows.get(win) {
            w.send(body);
        } else if let Some(id) = win.strip_prefix("win:").and_then(|v| v.parse::<u32>().ok()) {
            if let Some(c) = self.customs.get(&id) {
                c.deliver(body);
            }
        }
    }

    pub fn push_settings(&mut self, instance_id: &str) {
        let Some(inst) = self.instance(instance_id).cloned() else {
            return;
        };
        let Some(manifest) = self.manifest_for(instance_id) else {
            return;
        };
        let settings = self.settings_for(&inst, &manifest);
        self.send_to(
            instance_id,
            &format!("{{\"ev\":\"settings\",\"d\":{}}}", Value::Object(settings)),
        );
    }

    /// Pushes the current look to one card's window and page. Does not touch the served
    /// snapshot — callers that also need the control center / new pages up to date follow this
    /// with [`App::sync_serve`] (see `ui::control::push_control_state`).
    pub fn push_appearance(&mut self, instance_id: &str) {
        let Some(inst) = self.instance(instance_id).cloned() else {
            return;
        };
        let payload = self.appearance_payload(&inst);
        let margin = payload.get("margin").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        if let Some(w) = self.windows.get_mut(instance_id) {
            let scale = w.scale;
            w.set_margin((margin as f64 * scale).round() as i32);
            let click = inst.click_through;
            let layer = inst.layer.clone();
            w.apply_effects(&payload, click, &layer);
        }
        self.send_to(
            instance_id,
            &format!("{{\"ev\":\"appearance\",\"d\":{}}}", payload),
        );
    }

    pub fn push_state(&mut self, instance_id: &str) {
        let Some(inst) = self.instance(instance_id).cloned() else {
            return;
        };
        let Some(manifest) = self.manifest_for(instance_id) else {
            return;
        };
        let state = self.state_payload(&inst, &manifest);
        self.send_to(
            instance_id,
            &format!("{{\"ev\":\"state\",\"d\":{}}}", state),
        );
    }

    pub fn push_all_states(&mut self) {
        let ids: Vec<String> = self.windows.keys().cloned().collect();
        for id in ids {
            self.push_state(&id);
        }
    }

    // ── visibility and lifecycle ───────────────────────────────────────────

    /// The instance behind a tao window, so window events can be routed back to its page.
    pub fn instance_of_window(&self, window_id: tao::window::WindowId) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, w)| w.window.id() == window_id)
            .map(|(id, _)| id.clone())
    }

    /// Shows or hides a card and tells its page, once, so the page can tell "shown" from "hidden".
    ///
    /// `from` says what caused it, and reaching the page verbatim as the `show`/`hide` payload's
    /// `from`: `startup`, `tray`, `control`, `hotkey`, `fullscreen`, `api`. The uTools shim maps
    /// those onto its own vocabulary rather than inventing a second one.
    pub fn set_visible(&mut self, instance_id: &str, visible: bool, from: &str) {
        let Some(before) = self.windows.get(instance_id).map(|w| w.visible) else {
            return;
        };
        if before == visible {
            return;
        }
        if let Some(win) = self.windows.get_mut(instance_id) {
            if visible {
                win.show();
            } else {
                win.hide();
            }
        }
        let ev = if visible { "show" } else { "hide" };
        self.event_to(instance_id, ev, json!({ "from": from, "visible": visible }));
    }

    /// The cards belong to the virtual desktop they were opened on. Windows paints tool windows
    /// and `Progman`-owned desktop cards on every desktop, so the host does the filtering itself.
    pub fn sync_desktop(&mut self, current: &str) {
        for win in self.windows.values_mut() {
            win.sync_desktop(current);
        }
        // The wallpaper layer is shared by every desktop, so wallpaper-hosted effect windows
        // never move: the shell's switcher just stops compositing them elsewhere. Two things go
        // wrong for them across a switch. Some Windows builds hide them and never show them back
        // — re-show any that went missing. Worse, WebView2 stops presenting to its composition
        // surface while its window is on a background desktop, and never resumes: the window
        // comes back as a see-through hole (the wallpaper shows straight through it). Hiding and
        // re-showing the window for one frame forces the presenter to start again. Only a real
        // change kicks — the poll runs every 120 ms and `tick` calls this every second, so doing
        // it unconditionally would blink the effects constantly. Stopping an effect destroys the
        // window first, so this can never resurrect something the user closed.
        let switched = self.last_desktop.as_deref() != Some(current);
        self.last_desktop = Some(current.to_string());
        let mut reshow = 0;
        let mut kicked = 0;
        for win in self.customs.values() {
            if win.wallpaper && !win.destroyed {
                let hwnd = win.hwnd();
                let visible = unsafe { crate::platform::win32::IsWindowVisible(hwnd) } != 0;
                if !visible {
                    crate::platform::win32::show_no_activate(hwnd);
                    reshow += 1;
                }
                if switched {
                    if visible {
                        crate::platform::win32::hide(hwnd);
                    }
                    crate::platform::win32::show_no_activate(hwnd);
                    // A blank presentation surface is the real killer: WebView2 stops submitting
                    // its composition output while the window sits on a background desktop and
                    // never resumes, so the user looks at bare wallpaper. Hiding and re-showing
                    // the window is not enough to wake the presenter; only an actual client-size
                    // change makes it re-submit. Nudge the width by one pixel and restore.
                    crate::platform::win32::nudge_present(hwnd);
                    kicked += 1;
                    // Cards hit the same freeze: a page that comes back from a hidden desktop
                    // stops running its JavaScript (which is how an effect fails to remount at
                    // all). Resize-nudge every card as well; a hidden card stays hidden because
                    // `SetWindowPos` never changes visibility.
                    for card in self.windows.values() {
                        crate::platform::win32::nudge_present(card.hwnd());
                    }
                }
            }
        }
        if reshow > 0 {
            crate::core::logging::info(&format!(
                "desktop switch: re-showed {reshow} wallpaper window(s)"
            ));
        }
        if switched && kicked > 0 {
            crate::core::logging::info(&format!(
                "desktop switch: kicked {kicked} wallpaper window(s) to re-present"
            ));
            // The immediate kick lands while the shell is still finishing the switch, where a
            // resize can be swallowed; WebView2's presenter is also known to stay blank after
            // it. One more nudge a second later, once the new desktop is fully active, is what
            // reliably wakes it.
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(900));
                let _ = crate::core::bus::post(&proxy, Ev::NudgeWallpaper);
            });
        }
    }

    /// Shows or hides every card at once, with one reason for all of them.
    pub fn set_all_visible(&mut self, visible: bool, from: &str) {
        let ids: Vec<String> = self.windows.keys().cloned().collect();
        for id in ids {
            self.set_visible(&id, visible, from);
        }
    }

    /// Tells a page it is going away for good (`kill: true`) or just stepping aside (`false`).
    pub fn unload_instance(&self, instance_id: &str, kill: bool) {
        crate::core::logging::info(&format!("{instance_id}: unload (kill = {kill})"));
        self.event_to(instance_id, "unload", json!({ "kill": kill }));
    }

    pub fn event_to(&self, instance_id: &str, ev: &str, data: Value) {
        let body = format!(
            "{{\"ev\":{},\"d\":{}}}",
            serde_json::to_string(ev).unwrap(),
            data
        );
        self.send_to(instance_id, &body);
    }

    /// Hands a card the real paths of what was dropped on it.
    pub fn drop_paths(&self, instance_id: &str, paths: Vec<String>, at: (i32, i32)) {
        crate::core::logging::info(&format!("{instance_id}: drop of {} path(s)", paths.len()));
        self.event_to(
            instance_id,
            "drop",
            json!({ "paths": paths, "x": at.0, "y": at.1 }),
        );
    }

    // ── geometry ───────────────────────────────────────────────────────────

    /// Reads the window the OS actually has and writes the card rectangle back to the config.
    pub fn geometry_from_window(&mut self, instance_id: &str) {
        let Some(w) = self.windows.get(instance_id) else {
            return;
        };
        let hwnd = w.hwnd();
        let margin = w.margin;
        let scale = w.scale;
        let outer = crate::platform::win32::window_rect(hwnd);
        let card = crate::platform::win32::RECT {
            left: outer.left + margin,
            top: outer.top + margin,
            right: outer.right - margin,
            bottom: outer.bottom - margin,
        };
        let (width, height) = (
            (card.width() as f64 / scale).round(),
            (card.height() as f64 / scale).round(),
        );
        if let Some(inst) = self.instance_mut(instance_id) {
            inst.x = card.left;
            inst.y = card.top;
            if width > 0.0 {
                inst.width = width;
            }
            if height > 0.0 {
                inst.height = height;
            }
        }
        self.save();
    }

    pub fn place_window(&mut self, instance_id: &str) {
        let Some(inst) = self.instance(instance_id).cloned() else {
            return;
        };
        let Some(w) = self.windows.get_mut(instance_id) else {
            return;
        };
        let card = crate::runtime::window::card_rect(&inst, w.scale);
        w.place(card);
    }

    /// Hands the window's current size to the web view (and keeps `card` in step with the OS).
    pub fn sync_bounds(&mut self, instance_id: &str) {
        if let Some(w) = self.windows.get_mut(instance_id) {
            w.sync_bounds();
        }
    }

    /// 自建窗口刚被右下角把位拖着改过尺寸：同一个步骤，只是对象换成一个自定义窗口。
    pub fn sync_custom_bounds(&mut self, id: u32) {
        if let Some(win) = self.customs.get(&id) {
            win.fit_view();
        }
    }

    // ── window lifecycle ──────────────────────────────────────────────────

    pub fn flush_windows(&mut self, target: &tao::event_loop::EventLoopWindowTarget<Ev>) {
        let proxy = self.proxy.clone();
        begin_build();
        if self.control_pending {
            self.control_pending = false;
            if self.control.is_none() {
                match self.build_control(target) {
                    Ok(c) => self.control = Some(c),
                    Err(e) => crate::core::logging::error(&format!("Control center: {e}")),
                }
            }
        }
        let wanted: Vec<String> = std::mem::take(&mut self.pending_windows);
        for id in wanted {
            if self.windows.contains_key(&id) {
                continue;
            }
            let Some(inst) = self.instance(&id).cloned() else {
                continue;
            };
            let Some(manifest) = self.catalog.find(&inst.widget).cloned() else {
                crate::core::logging::warn(&format!(
                    "Instance {id}: widget {} is missing",
                    inst.widget
                ));
                continue;
            };
            let url = self.page_url(&manifest, &id);
            let scale = self.scale_factor();
            let look = self.look(&inst);
            let margin = crate::model::appearance::margin_dip(&look);
            match crate::runtime::window::build(
                target,
                &inst,
                &manifest,
                url,
                scale,
                margin,
                self.store.data.developer_mode,
                self.proxy.clone(),
            ) {
                Ok(mut win) => {
                    let payload = self.appearance_payload(&inst);
                    win.apply_effects(&payload, inst.click_through, &inst.layer);
                    if !self.store.data.hide_all {
                        win.show();
                    }
                    self.windows.insert(id.clone(), win);
                }
                Err(e) => crate::core::logging::error(&format!("Card {id}: {e}")),
            }
        }
        self.build_customs(target);
        end_build(&proxy);
    }

    /// Records a window a page asked for. It cannot be built here (only the loop thread may create a
    /// window), so it is queued and the loop is woken up for it.
    pub fn create_custom(
        &mut self,
        spec: crate::runtime::window_category::CustomSpec,
    ) -> crate::core::util::BridgeResult<u32> {
        use crate::core::util::BridgeError;
        if self.manifest_for(&spec.instance).is_none() {
            return Err(BridgeError::new("this widget is no longer installed"));
        }
        let file = spec.file.trim_start_matches(['/', '\\']).replace('\\', "/");
        if file.is_empty() || file.contains("..") || file.contains(':') {
            return Err(BridgeError::new(
                "the page must be a path inside the widget folder",
            ));
        }
        if self.customs.len() >= 24 {
            return Err(BridgeError::new("too many windows are already open"));
        }
        // `key` + `reuse`：同一个名字只开一个窗口。连点五次「设置」不该开出五个设置窗，
        // 已有窗口就把它叫到前面、原样返回它的 id（页面拿到的 handle 指向同一个窗口）。
        let key = spec
            .options
            .get("key")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(key) = key {
            let reuse = spec
                .options
                .get("reuse")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if reuse {
                if let Some(existing) = self
                    .customs
                    .iter()
                    .find(|(_, w)| w.instance == spec.instance && w.key == key)
                    .map(|(id, w)| (*id, w.hwnd()))
                {
                    let (id, hwnd) = existing;
                    crate::platform::win32::force_foreground(hwnd);
                    crate::core::logging::info(&format!("win {id}: reused by key '{key}'"));
                    return Ok(id);
                }
                // 已经排进队列、还没建出来的同一个 key：直接复用那条记录，别再排一个。
                if let Some(id) = self
                    .pending_customs
                    .iter()
                    .find(|(_, s)| {
                        s.instance == spec.instance
                            && s.options.get("key").and_then(|v| v.as_str()) == Some(key.as_str())
                    })
                    .map(|(id, _)| *id)
                {
                    return Ok(id);
                }
            }
        }
        let id = self.next_custom;
        self.next_custom += 1;
        self.pending_customs.push((
            id,
            crate::runtime::window_category::CustomSpec { file, ..spec },
        ));
        let _ = self.proxy.send_event(Ev::Wake);
        Ok(id)
    }

    /// The URL a custom window loads: the widget's own origin, plus the `win` marker the server
    /// turns into this window's boot data.
    fn custom_url(
        &self,
        manifest: &Manifest,
        spec: &crate::runtime::window_category::CustomSpec,
        id: u32,
    ) -> String {
        // `test.html?name=1` keeps its own query; the window markers are appended after it.
        let (path, extra) = match spec.file.split_once('?') {
            Some((path, rest)) => (path, format!("&{rest}")),
            None => (spec.file.as_str(), String::new()),
        };
        // 弹框没有实体文件：路径是一个宿主保留名，服务端见到它就出内置页并把配置塞进 boot。
        let path = if path == crate::runtime::dialog::PAGE {
            "__dialog"
        } else {
            path
        };
        // The markers sit in the URL itself: the page starts loading as soon as the window exists,
        // which can be before the serve state is refreshed, so the server cannot rely on its table
        // alone to know this is a custom window.
        let visible = spec
            .options
            .get("show")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        // 能不能缩放也走 URL：页面上的把位是加载时挂的，那一刻表里还没有这个窗口，
        // 只靠表就只能拿到 false，连把位都不会出现。
        let resizable = spec
            .options
            .get("resizable")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        format!(
            "http://{}:{}/{}?w={}&win={}&wt=custom&vis={}&rs={}{}",
            manifest.host_name(),
            self.port,
            path,
            spec.instance,
            id,
            if visible { 1 } else { 0 },
            if resizable { 1 } else { 0 },
            extra
        )
    }

    /// The windows still owed to the loop are built after the cards, on the same pass, so a page
    /// that opens one during `ready` does not have to wait for the next heartbeat.
    fn build_customs(&mut self, target: &tao::event_loop::EventLoopWindowTarget<Ev>) {
        let wanted: Vec<(u32, crate::runtime::window_category::CustomSpec)> =
            std::mem::take(&mut self.pending_customs);
        for (id, spec) in wanted {
            let Some(manifest) = self.manifest_for(&spec.instance) else {
                crate::core::logging::warn(&format!(
                    "{}: custom window for a widget that is no longer installed",
                    spec.instance
                ));
                continue;
            };
            let url = self.custom_url(&manifest, &spec, id);
            // 弹框的配置要在页面加载前就位：`/__dialog` 一起来就向服务端要它。
            if spec.file == crate::runtime::dialog::PAGE {
                self.serve.lock().dialogs.insert(id, spec.options.clone());
            }
            match crate::runtime::window_category::build_custom(
                target,
                &spec,
                url,
                id,
                self.store.data.developer_mode,
                self.proxy.clone(),
            ) {
                Ok(win) => {
                    // 原生标题栏（有系统边框时）左上角那个小图标：组件给了 `windowIcon` 就换上，
                    // 没给就留系统默认，别把 exe 自带的图标顶掉。
                    if let Some(icon) = custom_window_icon(&manifest.dir, &spec.options) {
                        win.window.set_window_icon(Some(icon));
                    }
                    crate::core::logging::info(&format!(
                        "win {id}: opened {} for {}",
                        spec.file, spec.instance
                    ));
                    self.customs.insert(id, win);
                    self.apply_modal(&spec, id);
                    self.place_custom(&spec, id);
                }
                Err(e) => {
                    self.serve.lock().dialogs.remove(&id);
                    crate::core::logging::error(&format!("win {id}: {e}"))
                }
            }
        }
    }

    /// 焦点离开一个自建窗口时按它的配置决定要不要收起来。
    /// `closeOnBlur` 是「点了别处就消失」，`closeOnOutsideClick` 只在鼠标真的落在窗口外时才关，
    /// 这样弹框内的输入框、下拉换焦点都不会误关。
    pub fn custom_blurred(&mut self, id: u32) {
        let Some(win) = self.customs.get(&id) else {
            return;
        };
        if !win.flags.close_on_blur && !win.flags.close_on_outside {
            return;
        }
        if win.flags.close_on_blur {
            self.close_custom(id, "blur");
            return;
        }
        let hwnd = win.hwnd();
        if !crate::platform::win32::cursor_inside(hwnd) {
            self.close_custom(id, "outside");
        }
    }

    /// 左键刚按下：落点在这些窗口外面就按配置收起来。
    ///
    /// 不能只靠失焦：卡片是 `NOACTIVATE` 的，点卡片不会把焦点抢走，窗口一直是「有焦点」的状态，
    /// `Focused(false)` 永远不来——这恰好是测试台里最常用的一下「点别处」。
    pub fn pointer_pressed(&mut self) {
        // 开窗那一下点击自己不能算「点了别处」：鼠标按下发生在窗口建出来之前，但事件可能
        // 排队排到窗口已经站住之后才被处理，那样弹出来就立刻自己关了。
        let press_ms = crate::platform::win32::last_press_ms();
        let ids: Vec<u32> = self
            .customs
            .iter()
            .filter(|(_, win)| {
                win.shown
                    && !win.destroyed
                    && (win.flags.close_on_blur || win.flags.close_on_outside)
                    && press_ms >= win.created_ms
                    && !crate::platform::win32::cursor_inside(win.hwnd())
            })
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            let blur = self
                .customs
                .get(&id)
                .is_some_and(|win| win.flags.close_on_blur);
            self.close_custom(id, if blur { "blur" } else { "outside" });
        }
    }

    /// 直角窗口（`frame:false` + `rounded:false`）的形状是 win32 区域裁出来的，而 DWM 在第一次
    /// 合成、重获焦点、重建边框时都会把那块矩形换成它自己的圆角区域，窗口两个上角于是又圆回去。
    /// 输入脉冲每 10ms 来一次，这里每 20 个（约 200ms）复查一遍：区域形状不对就重新贴，已贴好的
    /// 窗口一次 `GetWindowRgn` 就过，代价可以忽略。
    pub fn repair_square_clips(&mut self) {
        self.square_ticks = self.square_ticks.wrapping_add(1);
        if !self.square_ticks.is_multiple_of(20) {
            return;
        }
        let mut repaired = 0;
        for win in self.customs.values() {
            if !win.square || win.destroyed {
                continue;
            }
            if !crate::platform::win32::square_clipped(win.hwnd()) {
                win.repair_clip();
                repaired += 1;
            }
        }
        if repaired > 0 {
            crate::core::logging::info(&format!("square clip restored on {repaired} window(s)"));
        }
    }

    /// Esc 刚按下：带 `closeOnEsc` 的窗口收起来。窗口没拿到焦点时页面听不到键盘，只能宿主代劳。
    pub fn escape_pressed(&mut self) {
        let ids: Vec<u32> = self
            .customs
            .iter()
            .filter(|(_, win)| win.shown && !win.destroyed && win.flags.close_on_esc)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.close_custom(id, "esc");
        }
    }

    /// `modal: true`：弹框期间父窗口不接受输入，关掉时恢复。父可以是卡片，也可以是窗口。
    fn apply_modal(&mut self, spec: &crate::runtime::window_category::CustomSpec, id: u32) {
        let modal = spec
            .options
            .get("modal")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !modal {
            return;
        }
        let parent = match spec
            .parent
            .strip_prefix("win:")
            .and_then(|v| v.parse::<u32>().ok())
        {
            Some(pid) => self.customs.get(&pid).map(|win| win.hwnd()),
            None => spec
                .parent
                .strip_prefix("card:")
                .and_then(|owner| self.windows.get(owner))
                .map(|win| win.window.hwnd()),
        };
        if let Some(hwnd) = parent {
            crate::platform::win32::enable_window(hwnd, false);
            self.modal_parents.insert(id, hwnd);
        }
    }

    /// `anchor`: 贴哪儿开。`"card"` 贴在卡片下方（下面放不下就翻到上面），`"cursor"` 贴在鼠标
    /// 位置，`"screen"` 居中；`offset: [dx, dy]` 做微调，最后都夹在工作区内。
    fn place_custom(&mut self, spec: &crate::runtime::window_category::CustomSpec, id: u32) {
        let anchor = spec
            .options
            .get("anchor")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if anchor.is_empty() || anchor == "none" || anchor == "auto" {
            return;
        }
        let offset = spec
            .options
            .get("offset")
            .and_then(|v| v.as_array())
            .map(|pair| {
                (
                    pair.first().and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                    pair.get(1).and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                )
            })
            .unwrap_or((0, 0));
        let Some(win) = self.customs.get(&id) else {
            return;
        };
        let size = win.window.outer_size();
        let (dw, dh) = (size.width as i32, size.height as i32);
        let card = spec
            .parent
            .strip_prefix("card:")
            .and_then(|owner| self.windows.get(owner))
            .map(|win| win.card);
        let cursor = crate::platform::win32::cursor_pos();
        let probe = card.unwrap_or(crate::platform::win32::RECT {
            left: cursor.x,
            top: cursor.y,
            right: cursor.x + 1,
            bottom: cursor.y + 1,
        });
        let (_, work) = crate::platform::win32::monitor_work_area(&probe);
        let (mut x, mut y) = match anchor.as_str() {
            "card" => match card {
                Some(card) => (card.left, card.bottom + 8),
                None => (cursor.x, cursor.y + 8),
            },
            "cursor" => (cursor.x, cursor.y + 8),
            _ => (
                work.left + ((work.right - work.left) - dw) / 2,
                work.top + ((work.bottom - work.top) - dh) / 2,
            ),
        };
        x += offset.0;
        y += offset.1;
        // 卡片下面放不下就翻到卡片上面：贴边弹出不该被屏幕裁掉半截。
        if anchor == "card" {
            if let Some(card) = card {
                if y + dh > work.bottom - 8 {
                    y = card.top - dh - 8;
                }
            }
        }
        x = x.clamp(work.left + 8, (work.right - dw - 8).max(work.left + 8));
        y = y.clamp(work.top + 8, (work.bottom - dh - 8).max(work.top + 8));
        if let Some(win) = self.customs.get(&id) {
            win.window
                .set_outer_position(tao::dpi::PhysicalPosition::new(x, y));
        }
    }

    pub fn close_custom(&mut self, id: u32, reason: &str) {
        // Children first: a chain of windows closes from the outside in, so a page never sees its
        // parent disappear before it does.
        let kids: Vec<u32> = self
            .customs
            .iter()
            .filter(|(_, win)| win.parent == format!("win:{id}"))
            .map(|(key, _)| *key)
            .collect();
        for kid in kids {
            self.close_custom(kid, "parent");
        }
        let info = self.customs.get(&id).map(|win| {
            (
                win.parent.clone(),
                win.instance.clone(),
                win.key.clone(),
                win.kind.clone(),
                win.result.clone(),
            )
        });
        let Some((parent, instance, key, kind, result)) = info else {
            return;
        };
        if self.customs.remove(&id).is_none() {
            return;
        }
        self.serve.lock().dialogs.remove(&id);
        // 模态窗关了，父窗口要立刻能点，不能等下一轮。
        if let Some(modal_parent) = self.modal_parents.remove(&id) {
            crate::platform::win32::enable_window(modal_parent, true);
        }
        crate::core::logging::info(&format!("win {id}: closed ({reason})"));
        // Electron's `closed` event, now with the reason and whatever the page handed back. The
        // creator hears it, and so does every other window of this widget — a settings window
        // closing is news the whole widget may act on.
        let payload = json!({
            "id": id,
            "key": key,
            "kind": kind,
            "reason": reason,
            "result": result,
        });
        if let Some(pid) = parent
            .strip_prefix("win:")
            .and_then(|v| v.parse::<u32>().ok())
        {
            if let Some(win) = self.customs.get(&pid) {
                win.send_ipc("win.closed", payload.clone());
            }
        } else if let Some(owner) = parent.strip_prefix("card:") {
            self.event_to(owner, "win.closed", payload.clone());
        }
        for (other, win) in self.customs.iter() {
            if *other != id && win.instance == instance {
                win.send_ipc("win.closed", payload.clone());
            }
        }
    }
    /// One window's state, as the JS `BrowserWindow` getters read it.
    pub fn custom_state(&self, id: u32) -> Value {
        crate::runtime::window_category::state_json(self, id)
    }

    /// The page inside a custom window said `ready`: that is what `createBrowserWindow`'s callback
    /// waits for, so the creator hears about it now.
    pub fn mark_custom_loaded(&mut self, id: u32) {
        // A page that asked for click-through set it at creation time, but WebView2 builds its
        // child HWNDs asynchronously — often after `ready`. Re-apply now that the subtree exists,
        // otherwise those late children eat the mouse and the effect blocks the desktop beneath.
        let click_through = if let Some(win) = self.customs.get_mut(&id) {
            if win.loaded {
                return;
            }
            win.loaded = true;
            // 弹框窗口建的时候是藏着的：页面已经就绪，这时候亮出来才不会被 WebView 的白底闪一下。
            if win.show_on_ready {
                win.show_on_ready = false;
                win.window.set_visible(true);
                // 显示这一下会让 DWM 重新合成这扇窗，把它原来贴的矩形区域换成圆角形状，直角窗口
                // 得上两角于是又圆了回来——亮出来之后立刻补一次。
                win.repair_clip();
                // 页面把自己停在「未显示」等这一声：先亮窗口，再让它从第一帧播入场动画。
                // 顺序反了会看到完整画面先出现、动画再从半透明重播一遍。
                let _ = win
                    .webview
                    .evaluate_script("window.__fwReveal && window.__fwReveal()");
            }
            // Wallpaper windows are child windows behind the icon layer: they never capture the
            // mouse, and the layered click-through style would make their WebView invisible.
            if win.ignore_mouse && !win.wallpaper {
                Some(win.hwnd())
            } else {
                None
            }
        } else {
            None
        };
        if let Some(hwnd) = click_through {
            crate::platform::win32::set_click_through(hwnd, true);
        }
        // `set_visible` 在建窗时已经跑过一轮，页面就绪后再把创建时要求的整窗透明度补一次，
        // 免得 tao 改样式时把 layered 位抹掉。
        let alpha = self
            .customs
            .get(&id)
            .and_then(|win| win.alpha.map(|opacity| (win.hwnd(), opacity)));
        if let Some((hwnd, opacity)) = alpha {
            crate::runtime::window_category::set_opacity(hwnd, opacity);
        }
        let Some(parent) = self.customs.get(&id).map(|win| win.parent.clone()) else {
            return;
        };
        let state = crate::runtime::window_category::state_json(self, id);
        let payload = json!({ "id": id, "state": state });
        if let Some(pid) = parent
            .strip_prefix("win:")
            .and_then(|v| v.parse::<u32>().ok())
        {
            if let Some(win) = self.customs.get(&pid) {
                win.send_ipc("win.loaded", payload);
            }
        } else if let Some(instance) = parent.strip_prefix("card:") {
            self.event_to(instance, "win.loaded", payload);
        }
    }

    /// A window was destroyed by the system: drop the handle instead of keeping a dead window.
    pub fn forget_custom(&mut self, window_id: tao::window::WindowId) {
        let hit = self
            .customs
            .iter()
            .find(|(_, win)| win.window.id() == window_id)
            .map(|(key, _)| *key);
        if let Some(id) = hit {
            crate::core::logging::warn(&format!("win {id}: destroyed by the system"));
            self.customs.remove(&id);
        }
    }

    pub fn close_customs_of(&mut self, instance: &str) {
        let ids: Vec<u32> = self
            .customs
            .iter()
            .filter(|(_, win)| win.instance == instance)
            .map(|(key, _)| *key)
            .collect();
        for id in ids {
            self.close_custom(id, "owner");
        }
    }

    pub fn close_all_customs(&mut self) {
        let ids: Vec<u32> = self.customs.keys().copied().collect();
        for id in ids {
            self.close_custom(id, "owner");
        }
    }

    fn build_control(
        &mut self,
        target: &tao::event_loop::EventLoopWindowTarget<Ev>,
    ) -> Result<ControlWin, String> {
        use tao::dpi::LogicalSize;
        use tao::window::WindowBuilder;
        let window = WindowBuilder::new()
            .with_title(CONTROL_TITLE)
            .with_inner_size(LogicalSize::new(1180.0, 800.0))
            .with_min_inner_size(LogicalSize::new(880.0, 560.0))
            .with_window_icon(control_icon())
            .build(target)
            .map_err(|e| e.to_string())?;
        let proxy = self.proxy.clone();
        let drop_proxy = proxy.clone();
        // Same browser context as the cards: a second environment without it would make WebView2
        // put the default profile back next to the exe.
        let mut browser = crate::runtime::window::browser()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let webview = wry::WebViewBuilder::new_with_web_context(&mut browser)
            .with_url(self.control_url())
            .with_initialization_script(crate::runtime::shim::SCRIPT)
            .with_devtools(self.store.data.developer_mode)
            .with_drag_drop_handler(move |event| {
                if let wry::DragDropEvent::Drop { paths, .. } = event {
                    for path in paths {
                        let payload = json!({ "path": path.to_string_lossy() });
                        crate::runtime::app::post(
                            &drop_proxy,
                            Ev::Command(format!("package.drop:{payload}")),
                        );
                    }
                }
                true
            })
            .with_ipc_handler(move |request| {
                post(
                    &proxy,
                    Ev::Ipc {
                        win: CONTROL_WIN.to_string(),
                        msg: request.body().clone(),
                    },
                );
            })
            .build(&window)
            .map_err(|e| e.to_string())?;
        Ok(ControlWin {
            window,
            webview,
            ready: false,
        })
    }

    pub fn show_control(&mut self, page: Option<&str>) {
        if self.control.is_none() {
            self.control_pending = true;
            self.want_control = true;
            return;
        }
        if let Some(c) = &self.control {
            c.window.set_visible(true);
            c.window.set_focus();
        }
        self.push_state_to_control(page);
    }

    pub fn push_state_to_control(&mut self, page: Option<&str>) {
        self.sync_serve();
        let state = crate::ui::control::state_json(self);
        self.send_to(CONTROL_WIN, &format!("{{\"ev\":\"state\",\"d\":{state}}}"));
        if let Some(page) = page {
            self.send_to(
                CONTROL_WIN,
                &format!(
                    "{{\"ev\":\"page\",\"d\":{}}}",
                    serde_json::to_string(page).unwrap()
                ),
            );
        }
    }

    pub fn scale_factor(&self) -> f64 {
        self.windows.values().next().map(|w| w.scale).unwrap_or(1.0)
    }

    // ── widgets on the desktop ────────────────────────────────────────────

    pub fn add_widget(
        &mut self,
        widget_id: &str,
        at: Option<(i32, i32)>,
    ) -> Result<String, String> {
        let manifest = self
            .catalog
            .find(widget_id)
            .cloned()
            .ok_or_else(|| format!("no widget called {widget_id}"))?;
        let mut inst = InstanceConfig {
            widget: manifest.id.clone(),
            width: manifest.size.width,
            height: manifest.size.height,
            ..InstanceConfig::default()
        };
        if let Some(layer) = manifest
            .layer
            .clone()
            .filter(|l| ["top", "normal", "desktop"].contains(&l.as_str()))
        {
            inst.layer = layer;
        }
        let (slot_x, slot_y) = match at {
            Some(pos) => pos,
            None => self.free_slot(inst.width, inst.height),
        };
        inst.x = slot_x;
        inst.y = slot_y;
        let id = inst.id.clone();
        self.store.data.instances.push(inst);
        self.save();
        self.pending_windows.push(id.clone());
        self.sync_serve();
        Ok(id)
    }

    /// 卡片在主屏work区右边找空位时的算法。`width_dip` / `height_dip` 是卡片的逻辑尺寸，
    /// 返回的 x/y 是卡片左上角；四周的投影留白（`SHADOW_MARGIN_DIP`，现已为 0）加在外侧，
    /// 保证整张卡片仍完整落在工作区内。
    fn free_slot(&self, width_dip: f64, height_dip: f64) -> (i32, i32) {
        let scale = self.scale_factor();
        let (left, right, bottom) = self.primary_work_area();
        // 留白归零后这个值恒为 0，保留变量是为了让“卡片外沿”的算式仍然可读。
        let shadow = (SHADOW_MARGIN_DIP * scale).round() as i32;
        let gap = (8.0 * scale).round() as i32;
        let width = (width_dip * scale).round() as i32;
        let height = (height_dip * scale).round() as i32;
        let top = (40.0 * scale).round() as i32;
        let start_x = (right - width - shadow - gap).max(left + shadow);

        let overlaps = |x: i32, y: i32| {
            self.store.data.instances.iter().any(|inst| {
                let other_width = (inst.width * scale).round() as i32;
                let other_height = (inst.height * scale).round() as i32;
                x - shadow < inst.x + other_width + shadow
                    && x + width + shadow > inst.x - shadow
                    && y - shadow < inst.y + other_height + shadow
                    && y + height + shadow > inst.y - shadow
            })
        };

        let mut column_x = start_x;
        for _ in 0..6 {
            let mut y = top;
            while y + height + shadow <= bottom {
                if !overlaps(column_x, y) {
                    return (column_x, y);
                }
                y += height + gap;
            }
            column_x -= width + gap;
            if column_x < left + shadow {
                break;
            }
        }
        (start_x, top)
    }

    pub fn remove_instance(&mut self, id: &str) {
        // The page is about to lose its window: say so first, while it can still hear it. It cannot
        // answer (no reply is waited for), so this is "flush what you can", not a transaction.
        self.unload_instance(id, true);
        // A widget's custom windows are part of the widget: they go with it.
        self.close_customs_of(id);
        if let Some(mut w) = self.windows.remove(id) {
            w.hide();
            w.webview.focus().ok();
            w.window.set_visible(false);
        }
        self.store.data.instances.retain(|i| i.id != id);
        self.storage.delete_instance(id);
        self.sampling.remove(id);
        self.audio_subs.remove(id);
        self.media_subs.remove(id);
        self.save();
        self.sync_serve();
        self.rebuild_sampling();
    }

    /// Removes every card at once — the "clear all widgets" button in the control center.
    pub fn clear_instances(&mut self) {
        let ids: Vec<String> = self
            .store
            .data
            .instances
            .iter()
            .map(|i| i.id.clone())
            .collect();
        for id in ids {
            self.remove_instance(&id);
        }
    }

    pub fn duplicate_instance(&mut self, id: &str) -> Option<String> {
        let source = self.instance(id)?.clone();
        let mut copy = source.clone();
        copy.id = crate::core::config::new_id();
        let (x, y) = self.free_slot(copy.width, copy.height);
        copy.x = x;
        copy.y = y;
        let new_id = copy.id.clone();
        self.store.data.instances.push(copy);
        self.save();
        self.pending_windows.push(new_id.clone());
        self.sync_serve();
        Some(new_id)
    }

    // ── system subscriptions ──────────────────────────────────────────────

    pub fn set_subscription(&mut self, instance_id: &str, topics: Vec<String>, interval: u64) {
        if topics.is_empty() {
            self.sampling.remove(instance_id);
        } else {
            self.sampling
                .insert(instance_id.to_string(), (topics, interval.max(200)));
        }
        self.rebuild_sampling();
    }

    pub fn clear_subscription(&mut self, instance_id: &str) {
        self.sampling.remove(instance_id);
        self.rebuild_sampling();
    }

    pub fn rebuild_sampling(&self) {
        let mut topics: Vec<String> = Vec::new();
        let mut interval = u64::MAX;
        for (list, ms) in self.sampling.values() {
            for t in list {
                if !topics.iter().any(|x| x.eq_ignore_ascii_case(t)) {
                    topics.push(t.clone());
                }
            }
            interval = interval.min(*ms);
        }
        let media = !self.media_subs.is_empty();
        // The media module only polls the session while a card is actually subscribed.
        crate::platform::media::set_watching(media);
        self.monitor.configure(crate::runtime::monitor::Request {
            topics,
            interval_ms: if interval == u64::MAX { 1000 } else { interval },
            audio: !self.audio_subs.is_empty(),
            media,
        });
    }

    pub fn dispatch_sample(&mut self, data: &Value) {
        let targets: Vec<(String, Vec<String>)> = self
            .sampling
            .iter()
            .map(|(id, (topics, _))| (id.clone(), topics.clone()))
            .collect();
        for (id, topics) in targets {
            let mut part = Map::new();
            for t in &topics {
                if let Some(v) = data.get(t) {
                    part.insert(t.clone(), v.clone());
                }
            }
            if !part.is_empty() {
                self.event_to(&id, "system", Value::Object(part));
            }
        }
    }

    // ── tray ──────────────────────────────────────────────────────────────

    fn start_tray(&mut self) {
        let proxy = self.proxy.clone();
        let menu = crate::ui::menus::tray_menu(self);
        let actions = crate::ui::menus::tray_actions(self);
        let hotkeys: Vec<(String, String)> = self
            .store
            .data
            .hotkeys
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let tray = crate::platform::tray::spawn(menu, actions, hotkeys, move |action| {
            post(&proxy, Ev::Command(action));
        });
        self.tray = Some(tray);
    }

    pub fn refresh_tray_menu(&mut self) {
        let Some(tray) = self.tray.clone() else {
            return;
        };
        let menu = crate::ui::menus::tray_menu(self);
        let actions = crate::ui::menus::tray_actions(self);
        tray.set_menu(menu, actions);
        let count = self.store.data.instances.len();
        tray.tip(&format!("WinWidget · {count}"));
    }

    // ── notifications ─────────────────────────────────────────────────────

    pub fn schedule_note(
        &mut self,
        instance: &str,
        title: String,
        body: String,
        at: Option<i64>,
        tag: Option<String>,
    ) {
        let tag = tag.unwrap_or_default();
        if let Some(at_ms) = at.filter(|t| *t > crate::core::util::now_ms() + 500) {
            self.notes.push(PendingNote {
                at: at_ms,
                tag,
                title,
                body,
                instance: instance.to_string(),
            });
        } else {
            self.show_note(&title, &body);
        }
    }

    pub fn cancel_notes(&mut self, instance: &str, tag: Option<&str>) {
        self.notes.retain(|n| {
            if n.instance != instance {
                return true;
            }
            match tag {
                Some(t) if !t.is_empty() => n.tag != t,
                _ => false,
            }
        });
    }

    pub fn show_note(&self, title: &str, body: &str) {
        if let Some(tray) = &self.tray {
            tray.notify(title, body);
        }
    }

    pub fn tick(&mut self) {
        // The desktop watcher posts a dedicated event on a switch; this is the slower safety net
        // for a missed one (and for the first tick after startup).
        if let Some(current) = crate::platform::win32::current_virtual_desktop_id() {
            self.sync_desktop(&current);
        }
        // Widget-requested schedules (`utools.requestSchedule`) ride the same one-second clock.
        let host: &dyn ScheduleHost = &*self;
        crate::core::schedule::tick(host);
        // Remember where the user was before a card took the foreground, for paste/type to return to.
        let foreign = crate::platform::win32::foreign_foreground();
        if foreign != 0 {
            self.last_foreign_focus = foreign as isize;
        }
        let now = crate::core::util::now_ms();
        let mut fired = Vec::new();
        let mut keep = Vec::new();
        for note in std::mem::take(&mut self.notes) {
            if note.at <= now {
                fired.push(note);
            } else {
                keep.push(note);
            }
        }
        self.notes = keep;
        for note in fired {
            self.show_note(&note.title, &note.body);
        }
        // autoClose：内置弹框页自己会关，但组件自绘的窗口得靠宿主兜底，页面卡死也不会一直挂着。
        let due: Vec<u32> = self
            .customs
            .iter()
            .filter(|(_, win)| {
                win.flags
                    .auto_close_ms
                    .is_some_and(|ms| ms > 0 && now.saturating_sub(win.created_ms) >= ms)
            })
            .map(|(id, _)| *id)
            .collect();
        for id in due {
            self.close_custom(id, "timeout");
        }
        // "Same as Windows" has no notification to lean on (the theme broadcast does not reach a
        // message-only window), so the registry is re-read on a slow clock: twice a second is
        // pointless, two seconds is invisible, and a flipped Windows theme repaints the control
        // center without a restart. Pinned light/dark skips the read entirely.
        if now >= self.theme_check_ms {
            self.theme_check_ms = now + 2000;
            let now_light = crate::platform::system_light();
            if now_light != self.system_light {
                self.system_light = now_light;
                let auto = self.cfg().ui_theme.eq_ignore_ascii_case("auto");
                if auto {
                    self.push_state_to_control(None);
                }
            }
        }
        // Reasserting the non-client policy on a timer used to look like cheap insurance, but every
        // `DwmSetWindowAttribute` makes the compositor rebuild the frame: with a few transparent
        // cards that is a visible flash once a second, and with nine of them it is a stall. The
        // window procedure already states the policy at the only three moments the caption can come
        // back (show, activate, non-client paint), so nothing here needs a clock.
    }

    // ── small operations shared by the control center, menus and hotkeys ──

    pub fn publish_states(&mut self) {
        let ids: Vec<String> = self.windows.keys().cloned().collect();
        for id in ids {
            self.push_state(&id);
        }
    }

    pub fn rescan(&mut self) {
        self.catalog = crate::model::catalog::Catalog::default();
        self.catalog.scan();
        self.themes = crate::model::themes::Themes::load();
        self.pending_windows
            .extend(self.store.data.instances.iter().map(|i| i.id.clone()));
        // push_state_to_control syncs the served snapshot as its first step.
        self.push_state_to_control(None);
    }

    pub fn select_in_control(&mut self, instance_id: &str) {
        self.send_to(
            CONTROL_WIN,
            &format!(
                "{{\"ev\":\"select\",\"d\":{}}}",
                json!({ "id": instance_id })
            ),
        );
    }

    pub fn reload_instance(&mut self, instance_id: &str) {
        if let Some(win) = self.windows.get(instance_id) {
            if let Err(e) = win.webview.reload() {
                crate::core::logging::warn(&format!("{instance_id}: reload failed: {e}"));
            }
        } else {
            self.pending_windows.push(instance_id.to_string());
        }
    }

    /// Locking is what makes a card transparent to the mouse; there is no separate click-through
    /// switch. Arrange mode unlocks cards temporarily so they can still be dragged.
    pub fn set_locked(&mut self, instance_id: &str, on: bool) {
        let click = on && !self.edit_mode;
        if let Some(inst) = self.instance_mut(instance_id) {
            inst.locked = on;
            inst.click_through = click;
        }
        self.apply_click_through(instance_id);
        self.save();
        self.publish_states();
        self.refresh_tray_menu();
        self.push_state_to_control(None);
    }

    pub fn set_all_locked(&mut self, on: bool) {
        let click = on && !self.edit_mode;
        let ids: Vec<String> = self
            .cfg()
            .instances
            .iter()
            .map(|inst| inst.id.clone())
            .collect();
        for inst in self.cfg_mut().instances.iter_mut() {
            inst.locked = on;
            inst.click_through = click;
        }
        for id in &ids {
            self.apply_click_through(id);
        }
        self.save();
        self.publish_states();
        self.refresh_tray_menu();
        self.push_state_to_control(None);
    }

    /// Arrange mode has to make locked cards interactive, otherwise they can neither be dragged
    /// nor resized. Leaving it restores the click-through style that locking implies.
    pub fn set_edit_mode(&mut self, on: bool) {
        if self.edit_mode == on {
            return;
        }
        self.edit_mode = on;
        let ids: Vec<String> = self
            .cfg()
            .instances
            .iter()
            .map(|inst| inst.id.clone())
            .collect();
        for inst in self.cfg_mut().instances.iter_mut() {
            inst.click_through = inst.locked && !on;
        }
        for id in &ids {
            self.apply_click_through(id);
        }
        self.publish_states();
        self.refresh_tray_menu();
        self.push_state_to_control(None);
    }

    fn apply_click_through(&mut self, instance_id: &str) {
        let payload = self
            .instance(instance_id)
            .cloned()
            .map(|i| self.appearance_payload(&i))
            .unwrap_or(Value::Null);
        let layer = self
            .instance(instance_id)
            .map(|i| i.layer.clone())
            .unwrap_or_else(|| "desktop".into());
        let click = self
            .instance(instance_id)
            .map(|i| i.click_through)
            .unwrap_or(false);
        crate::core::logging::info(&format!(
            "{instance_id}: click-through {}",
            if click { "on" } else { "off" }
        ));
        if let Some(win) = self.windows.get_mut(instance_id) {
            win.apply_effects(&payload, click, &layer);
        }
        self.push_state(instance_id);
    }

    pub fn set_layer(&mut self, instance_id: &str, layer: &str) {
        if !["desktop", "normal", "top"].contains(&layer) {
            return;
        }
        if let Some(inst) = self.instance_mut(instance_id) {
            inst.layer = layer.to_string();
        }
        let payload = self
            .instance(instance_id)
            .cloned()
            .map(|i| self.appearance_payload(&i))
            .unwrap_or(Value::Null);
        let click = self
            .instance(instance_id)
            .map(|i| i.click_through)
            .unwrap_or(false);
        if let Some(win) = self.windows.get_mut(instance_id) {
            win.apply_effects(&payload, click, layer);
        }
        self.save();
        self.push_state(instance_id);
        self.push_state_to_control(None);
    }

    /// A package the market downloaded: stage it, install it, and report the result in the page.
    pub fn install_downloaded(&mut self, payload: &Value) {
        let ok = payload.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let id = payload
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !ok {
            let message = payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("the download failed")
                .to_string();
            self.send_to(
                CONTROL_WIN,
                &format!(
                    "{{\"ev\":\"installError\",\"d\":{}}}",
                    json!({ "file": id, "message": message })
                ),
            );
            return;
        }
        // The bytes are down: the page may take the button out of "下載中…" while packaging runs.
        self.send_to(
            CONTROL_WIN,
            &format!("{{\"ev\":\"installDone\",\"d\":{}}}", json!({ "id": id })),
        );
        let path = std::path::PathBuf::from(
            payload
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
        );
        match crate::market::packages::stage(self, &path) {
            Ok(staged) => {
                let token = staged.token.clone();
                self.staged.insert(token.clone(), staged);
                match crate::market::packages::install(self, &token) {
                    Ok(result) => {
                        let name = result
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&id)
                            .to_string();
                        self.show_note(
                            crate::core::text::pick_value(&json!({
                                "zh-TW": "已安裝組件", "zh-CN": "已安装组件", "en": "Widget installed"
                            }))
                            .as_str()
                            .unwrap_or("Widget installed"),
                            &name,
                        );
                        self.push_state_to_control(None);
                    }
                    Err(e) => {
                        self.send_to(
                            CONTROL_WIN,
                            &format!(
                                "{{\"ev\":\"installError\",\"d\":{}}}",
                                json!({ "file": id, "message": e })
                            ),
                        );
                    }
                }
            }
            Err(message) => {
                self.send_to(
                    CONTROL_WIN,
                    &format!(
                        "{{\"ev\":\"installError\",\"d\":{}}}",
                        json!({ "file": id, "message": message })
                    ),
                );
            }
        }
    }

    pub fn hotkey_pressed(&mut self, action: &str) {
        if self.hotkeys_paused {
            return;
        }
        match action {
            "control" => self.show_control(None),
            "notes" => {
                let target = self
                    .store
                    .data
                    .instances
                    .iter()
                    .find(|i| i.widget == "winwidget.notes")
                    .map(|i| i.id.clone());
                match target {
                    Some(id) => {
                        self.set_visible(&id, true, "hotkey");
                        if let Some(win) = self.windows.get(&id) {
                            win.window.set_focus();
                        }
                        // The documented "summon" event, for pages that want to focus an input
                        // after the hotkey brought the card up.
                        self.event_to(&id, "summon", json!({}));
                    }
                    None => self.show_control(None),
                }
            }
            other => crate::core::logging::info(&format!("Hotkey {other} has no handler")),
        }
    }

    // ── quitting ──────────────────────────────────────────────────────────

    pub fn quit(&mut self) {
        if self.quitting {
            return;
        }
        self.quitting = true;
        // Every live card hears `unload` (kill = true) once before the windows go away. The pages
        // get a short grace period to answer — a widget that saves on the way out needs the message
        // channel to stay open one more beat.
        let ids: Vec<String> = self.windows.keys().cloned().collect();
        for id in ids {
            self.unload_instance(&id, true);
        }
        // Custom windows go first: they belong to the cards and there is nothing left to talk to
        // once the cards are gone.
        self.close_all_customs();
        self.quit_at = Some(std::time::Instant::now() + std::time::Duration::from_millis(150));
    }

    /// The last step once the grace period after `quit()` is over: flush, save, drop the tray icon.
    /// Called from the loop when the deadline expires, and again from `LoopDestroyed`, so it guards
    /// itself: the second call has nothing left to do.
    pub fn finish_quit(&mut self) {
        self.quit_at = None;
        if self.quit_done {
            return;
        }
        self.quit_done = true;
        self.storage.flush_all();
        self.save();
        if let Some(tray) = &self.tray {
            tray.quit();
        }
        crate::core::logging::info("WinWidget exiting");
    }

    /// A window was destroyed by the system (display change, WebView2 crash): drop the handle.
    pub fn forget_window(&mut self, window_id: tao::window::WindowId) {
        if self
            .customs
            .values()
            .any(|win| win.window.id() == window_id)
        {
            self.forget_custom(window_id);
            return;
        }
        let hit: Vec<String> = self
            .windows
            .iter()
            .filter(|(_, win)| win.window.id() == window_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in hit {
            self.windows.remove(&id);
            crate::core::logging::warn(&format!(
                "Window for {id} was destroyed; it will be rebuilt"
            ));
            self.pending_windows.push(id);
        }
    }

    /// Nothing for tray/menu actions to tidy beyond keeping the page in step.
    pub fn after_command(&mut self) {
        self.publish_states();
        self.push_state_to_control(None);
    }

    /// The monitor hidden behind another app's full-screen window, if there is one.
    fn fullscreen_foreground(&self) -> Option<crate::platform::win32::RECT> {
        if let Some(control) = self.control.as_ref() {
            let hwnd = crate::platform::win32::foreground_window();
            if hwnd == control.window.hwnd() {
                return None;
            }
        }
        crate::platform::win32::fullscreen_monitor(std::process::id())
    }

    pub fn watch_fullscreen(&mut self) {
        if !self.cfg().pause_on_fullscreen {
            return;
        }
        self.fullscreen_ticks = self.fullscreen_ticks.wrapping_add(1);
        if !self.fullscreen_ticks.is_multiple_of(4) {
            return; // roughly a second apart
        }
        let active = self.fullscreen_foreground();
        if same_area(&active, &self.fullscreen_area) {
            return;
        }
        let message = match &active {
            // 带上窗口类名和标题：卡片突然整片消失时，第一件想知道的事就是"它把谁当成了全屏"，
            // 一行日志里说清楚比事后猜便宜得多。
            Some(r) => format!(
                "Full-screen app on ({}, {})-({}, {}): cards there hidden [{}]",
                r.left,
                r.top,
                r.right,
                r.bottom,
                crate::platform::win32::foreground_label()
            ),
            None => "Full-screen app gone: cards shown".to_string(),
        };
        self.fullscreen_area = active;
        crate::core::logging::info(&message);
        let hide_all = self.cfg().hide_all;
        let area = active;
        let ids: Vec<String> = self.windows.keys().cloned().collect();
        for id in ids {
            // Only the cards on that monitor step aside, as FullWidget did.
            let covered = match (area.as_ref(), self.windows.get(&id)) {
                (Some(r), Some(win)) => {
                    let card = win.card;
                    let cx = (card.left + card.right) / 2;
                    let cy = (card.top + card.bottom) / 2;
                    Some(cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom)
                }
                _ => None,
            };
            match covered {
                Some(true) => self.set_visible(&id, false, "fullscreen"),
                Some(false) => {}
                None => {
                    if !hide_all {
                        self.set_visible(&id, true, "fullscreen");
                    }
                }
            }
        }
    }
}

// The narrow host views the `events` and `schedule` core categories are allowed to see. All the
// detailed field access (cfg, manifest, instances) stays here in runtime instead of leaking into
// core through a `use runtime::app::App`.

impl EventsHost for App {
    fn has_pending_permissions(&self, instance: &str) -> bool {
        self.manifest_for(instance)
            .map(|m| !crate::model::permissions::pending(self.cfg(), &m).is_empty())
            .unwrap_or(false)
    }

    fn refresh_control_state(&mut self) {
        self.push_state_to_control(None);
    }
}

impl ScheduleHost for App {
    fn instances_of_widget(&self, widget: &str) -> Vec<String> {
        self.cfg()
            .instances
            .iter()
            .filter(|i| i.widget.eq_ignore_ascii_case(widget))
            .map(|i| i.id.clone())
            .collect()
    }

    fn event_to(&self, instance: &str, ev: &str, data: serde_json::Value) {
        App::event_to(self, instance, ev, data);
    }
}

/// The logo for the title bar and the taskbar. Without it Windows draws its generic placeholder,
/// which is what the window showed even though the exe itself carries `assets\logo.ico`.
fn control_icon() -> Option<tao::window::Icon> {
    let paths = crate::core::paths::get();
    // `file_bytes` reads the folder on disk in a dev build and the packed copy in a shipped exe.
    let bytes = crate::core::assets::file_bytes(&paths.ui_dir(), "control-center/img/logo.png")?;
    let image = image::load_from_memory(&bytes).ok()?.to_rgba8();
    let (width, height) = image.dimensions();
    tao::window::Icon::from_rgba(image.into_raw(), width, height).ok()
}

/// 组件级窗口图标：`windowIcon`（组件包里的相对路径，或 `data:` 内联位图）。
///
/// 原生标题栏和任务栏要的是位图句柄，SVG 在这里没法解，所以 `.svg` 一律当没给（见
/// `dialog::window_icon_source`）。大图先缩到 32px——标题栏那个位置就这么大，让 Windows 自己
/// 抽点会比缩一次更糊。
fn custom_window_icon(
    dir: &std::path::Path,
    options: &serde_json::Value,
) -> Option<tao::window::Icon> {
    let source = crate::runtime::dialog::window_icon_source(options)?;
    let bytes = match source.split_once(',') {
        Some((head, data)) if head.starts_with("data:") && head.contains(";base64") => {
            crate::platform::win32::base64_decode(data)?
        }
        _ => crate::core::assets::file_bytes(dir, source.trim_start_matches(['/', '\\']))?,
    };
    let image = image::load_from_memory(&bytes).ok()?.to_rgba8();
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    let (w, h, rgba) = if width > 32 || height > 32 {
        let scaled = image::imageops::resize(&image, 32, 32, image::imageops::FilterType::Lanczos3);
        (32, 32, scaled.into_raw())
    } else {
        (width, height, image.into_raw())
    };
    tao::window::Icon::from_rgba(rgba, w, h).ok()
}
