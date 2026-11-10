//! The host itself: owns the config, the windows, the tray and the data the pages see.

use crate::core::config::{AppConfig, ConfigStore, InstanceConfig};
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

/// True while a window (and its WebView) is being built on the loop thread.
static BUILDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Events our own threads wanted to post during a build.
static HELD: std::sync::Mutex<Vec<Ev>> = std::sync::Mutex::new(Vec::new());

/// Posts an event to the loop, holding it back while a window is being built.
///
/// Creating a WebView pumps the thread's Windows messages (`webview2-com`'s
/// `wait_with_pump`), and tao has no guard for that: a message reaching its
/// thread target during the pump re-enters `EventLoopRunner::poll` while the
/// event handler is taken, which panics and takes the whole process with it.
/// So while we build, our threads park their events here and hand them over
/// once the build is done.
pub fn post(proxy: &EventLoopProxy<Ev>, event: Ev) -> bool {
    use std::sync::atomic::Ordering;
    if BUILDING.load(Ordering::SeqCst) {
        if let Ok(mut held) = HELD.lock() {
            held.push(event);
        }
        return true;
    }
    proxy.send_event(event).is_ok()
}

fn begin_build() {
    BUILDING.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn end_build(proxy: &EventLoopProxy<Ev>) {
    BUILDING.store(false, std::sync::atomic::Ordering::SeqCst);
    let held = match HELD.lock() {
        Ok(mut held) => std::mem::take(&mut *held),
        Err(_) => Vec::new(),
    };
    for event in held {
        let _ = proxy.send_event(event);
    }
}

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

pub enum Ev {
    Ipc { win: String, msg: String },
    Reply { win: String, body: String },
    Sample(Value),
    Audio(Value),
    Media(Value),
    Command(String),
    Tick,
}

pub struct App {
    pub store: ConfigStore,
    pub catalog: crate::model::catalog::Catalog,
    pub themes: crate::model::themes::Themes,
    pub storage: crate::core::storage::StorageStore,
    pub serve: ServeState,
    pub port: u16,
    pub windows: HashMap<String, WidgetWin>,
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
    pub hotkeys_paused: bool,
    fullscreen_ticks: u32,
    fullscreen_area: Option<crate::platform::win32::RECT>,
    caption_check: i64,
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

/// Same monitor rect on both sides, including "neither has one".
impl App {
    pub fn new(proxy: EventLoopProxy<Ev>) -> App {
        let store = ConfigStore::load();
        let mut catalog = crate::model::catalog::Catalog::default();
        catalog.scan();
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
            hotkeys_paused: false,
            fullscreen_ticks: 0,
            fullscreen_area: None,
            caption_check: 0,
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
        let (left, right, bottom) = self.primary_work_area();
        let _ = (left, bottom);
        let scale = 1.0;
        for (index, widget) in ["winwidget.clock", "winwidget.sysinfo"].iter().enumerate() {
            let Some(manifest) = self.catalog.find(widget).cloned() else {
                continue;
            };
            let mut inst = InstanceConfig::default();
            inst.widget = widget.to_string();
            inst.width = manifest.size.width;
            inst.height = manifest.size.height;
            inst.x = right - ((inst.width + 40.0) * scale) as i32;
            inst.y = ((40.0 + index as f64 * (inst.height + 60.0)) * scale) as i32;
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

    pub fn scale(&self) -> f64 {
        self.windows
            .values()
            .next()
            .map(|w| w.scale)
            .unwrap_or_else(|| 1.0)
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
        self.sync_serve();
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

    pub fn event_to(&self, instance_id: &str, ev: &str, data: Value) {
        let body = format!(
            "{{\"ev\":{},\"d\":{}}}",
            serde_json::to_string(ev).unwrap(),
            data
        );
        self.send_to(instance_id, &body);
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
        w.place(card, None);
    }

    /// Hands the window's current size to the web view (and keeps `card` in step with the OS).
    pub fn sync_bounds(&mut self, instance_id: &str) {
        if let Some(w) = self.windows.get_mut(instance_id) {
            w.sync_bounds();
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
        end_build(&proxy);
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
            .build(target)
            .map_err(|e| e.to_string())?;
        let proxy = self.proxy.clone();
        let drop_proxy = proxy.clone();
        let webview = wry::WebViewBuilder::new()
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
        let (slot_x, slot_y) = at.unwrap_or_else(|| self.free_slot());
        inst.x = slot_x;
        inst.y = slot_y;
        let id = inst.id.clone();
        self.store.data.instances.push(inst);
        self.save();
        self.pending_windows.push(id.clone());
        self.sync_serve();
        Ok(id)
    }

    /// A free spot near the middle-right of the primary screen.
    fn free_slot(&self) -> (i32, i32) {
        let scale = self.scale_factor();
        let (left, right, bottom) = self.primary_work_area();
        let width = (260.0 * scale) as i32;
        let height = (160.0 * scale) as i32;
        let mut x = right - width - (24.0 * scale) as i32;
        let mut y = self.store.data.instances.len() as i32 * height + (40.0 * scale) as i32;
        while y + height > bottom {
            y -= height;
            x -= width;
            if x < left + width {
                x = right - width - (24.0 * scale) as i32;
                y = (40.0 * scale) as i32;
                break;
            }
        }
        (x, y)
    }

    pub fn remove_instance(&mut self, id: &str) {
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

    pub fn duplicate_instance(&mut self, id: &str) -> Option<String> {
        let source = self.instance(id)?.clone();
        let mut copy = source.clone();
        copy.id = crate::core::config::new_id();
        let (x, y) = self.free_slot();
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
        // A caption can come back on the top of a card after an activation, a compositing change or
        // a frame update; state the policy again so the card never keeps that strip for long.
        if now - self.caption_check >= 1000 {
            self.caption_check = now;
            for win in self.windows.values() {
                if win.visible {
                    let hwnd = win.hwnd();
                    crate::platform::win32::disable_nc_rendering(hwnd);
                }
            }
        }
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
        self.sync_serve();
        self.pending_windows
            .extend(self.store.data.instances.iter().map(|i| i.id.clone()));
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

    pub fn set_click_through(&mut self, instance_id: &str, on: bool) {
        if let Some(inst) = self.instance_mut(instance_id) {
            inst.click_through = on;
        }
        let payload = self
            .instance(instance_id)
            .cloned()
            .map(|i| self.appearance_payload(&i))
            .unwrap_or(Value::Null);
        let layer = self
            .instance(instance_id)
            .map(|i| i.layer.clone())
            .unwrap_or_else(|| "desktop".into());
        if let Some(win) = self.windows.get_mut(instance_id) {
            win.apply_effects(&payload, on, &layer);
        }
        self.save();
        self.push_state(instance_id);
        self.push_state_to_control(None);
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
                        if let Some(win) = self.windows.get_mut(&id) {
                            win.show();
                            win.window.set_focus();
                        }
                    }
                    None => self.show_control(None),
                }
            }
            other => crate::core::logging::info(&format!("Hotkey {other} has no handler")),
        }
    }

    // ── quitting ──────────────────────────────────────────────────────────

    pub fn quit(&mut self) {
        self.quitting = true;
        self.storage.flush_all();
        self.save();
        if let Some(tray) = &self.tray {
            tray.quit();
        }
        crate::core::logging::info("WinWidget exiting");
    }

    /// A window was destroyed by the system (display change, WebView2 crash): drop the handle.
    pub fn forget_window(&mut self, window_id: tao::window::WindowId) {
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
            Some(r) => format!(
                "Full-screen app on ({}, {})-({}, {}): cards there hidden",
                r.left, r.top, r.right, r.bottom
            ),
            None => "Full-screen app gone: cards shown".to_string(),
        };
        self.fullscreen_area = active;
        crate::core::logging::info(&message);
        let hide_all = self.cfg().hide_all;
        let area = active;
        for win in self.windows.values_mut() {
            // Only the cards on that monitor step aside, as FullWidget did.
            let covered = area.as_ref().map(|r| {
                let card = win.card;
                let cx = (card.left + card.right) / 2;
                let cy = (card.top + card.bottom) / 2;
                cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom
            });
            match covered {
                Some(true) => {
                    if win.visible {
                        win.hide();
                    }
                }
                Some(false) => {}
                None => {
                    if !hide_all {
                        win.show();
                    }
                }
            }
        }
    }
}
