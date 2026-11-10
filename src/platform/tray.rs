//! The notification-area icon, system-wide shortcuts and the native menus both the tray and the
//! widget context menu use.

use crate::platform::win32 as w;
use std::sync::mpsc::{channel, Sender};

pub const WM_APP: u32 = 0x8000;
pub const TRAY_MESSAGE: u32 = WM_APP + 1;
/// Posted by a second copy of WinWidget to ask this one to show the control center.
pub const ASK_CONTROL: u32 = WM_APP + 20;
pub const TRAY_CLASS: &str = "WinWidgetTrayWindow";
pub const WM_HOTKEY_MSG: u32 = 0x0312;

const WM_LBUTTONUP: u32 = 0x0202;
const WM_LBUTTONDBLCLK: u32 = 0x0203;
const WM_RBUTTONUP: u32 = 0x0205;
const WM_DESTROY: u32 = 0x0002;

const NIM_ADD: u32 = 0x0000_0000;
const NIM_MODIFY: u32 = 0x0000_0001;
const NIM_DELETE: u32 = 0x0000_0002;
const NIF_MESSAGE: u32 = 0x0000_0001;
const NIF_ICON: u32 = 0x0000_0002;
const NIF_TIP: u32 = 0x0000_0004;
const NIF_INFO: u32 = 0x0000_0010;
const NIIF_INFO: u32 = 0x0000_0001;

const MOD_ALT: u32 = 0x0001;
const MOD_CONTROL: u32 = 0x0002;
const MOD_SHIFT: u32 = 0x0004;
const MOD_WIN: u32 = 0x0008;

/// A menu entry the native popup menu shows.
#[derive(Clone)]
pub struct MenuItem {
    pub id: u32,
    pub label: String,
    pub checked: bool,
    pub enabled: bool,
    pub separator: bool,
}

impl MenuItem {
    pub fn new(id: u32, label: impl Into<String>) -> MenuItem {
        MenuItem {
            id,
            label: label.into(),
            checked: false,
            enabled: true,
            separator: false,
        }
    }
    pub fn checked(mut self, on: bool) -> MenuItem {
        self.checked = on;
        self
    }
    pub fn enabled(mut self, on: bool) -> MenuItem {
        self.enabled = on;
        self
    }
    pub fn separator() -> MenuItem {
        MenuItem {
            id: 0,
            label: String::new(),
            checked: false,
            enabled: false,
            separator: true,
        }
    }
}

/// Shows a popup menu at the cursor and returns the chosen id (None when dismissed).
pub fn popup_menu(owner: w::HWND, items: &[MenuItem], x: i32, y: i32) -> Option<u32> {
    unsafe {
        let menu = w::CreatePopupMenu();
        if menu == 0 {
            return None;
        }
        for item in items {
            if item.separator {
                let _ = w::AppendMenuW(menu, w::MF_SEPARATOR, 0, std::ptr::null());
                continue;
            }
            let mut flags = w::MF_STRING;
            if item.checked {
                flags |= w::MF_CHECKED;
            }
            if !item.enabled {
                flags |= w::MF_GRAYED;
            }
            let label = w::wide(&item.label);
            let _ = w::AppendMenuW(menu, flags, item.id as usize, label.as_ptr());
        }
        let _ = w::SetForegroundWindow(owner);
        let picked = w::TrackPopupMenu(
            menu,
            w::TPM_RETURNCMD | w::TPM_RIGHTBUTTON | w::TPM_NONOTIFY,
            x,
            y,
            0,
            owner,
            std::ptr::null(),
        );
        let _ = w::DestroyMenu(menu);
        if picked > 0 {
            Some(picked as u32)
        } else {
            None
        }
    }
}

pub enum TrayIn {
    Notify {
        title: String,
        body: String,
    },
    Tip(String),
    /// Replaces the popup menu (and the ids behind it).
    Menu(Vec<MenuItem>, Vec<String>),
    /// Replaces the registered shortcuts.
    Hotkeys(Vec<(String, String)>),
    Quit,
}

#[derive(Clone)]
pub struct TrayHandle {
    tx: Sender<TrayIn>,
}

impl TrayHandle {
    pub fn notify(&self, title: &str, body: &str) {
        let _ = self.tx.send(TrayIn::Notify {
            title: title.to_string(),
            body: body.to_string(),
        });
    }
    pub fn tip(&self, tip: &str) {
        let _ = self.tx.send(TrayIn::Tip(tip.to_string()));
    }
    pub fn set_menu(&self, menu: Vec<MenuItem>, actions: Vec<String>) {
        let _ = self.tx.send(TrayIn::Menu(menu, actions));
    }
    pub fn set_hotkeys(&self, hotkeys: Vec<(String, String)>) {
        let _ = self.tx.send(TrayIn::Hotkeys(hotkeys));
    }
    pub fn quit(&self) {
        let _ = self.tx.send(TrayIn::Quit);
    }
}

/// Starts the tray thread. Menu ids map to the action names in `actions`, which are sent back
/// through `on_action`.
pub fn spawn<F>(
    menu: Vec<MenuItem>,
    actions: Vec<String>,
    hotkeys: Vec<(String, String)>,
    on_action: F,
) -> TrayHandle
where
    F: Fn(String) + Send + 'static,
{
    let (tx, rx) = channel::<TrayIn>();

    let actions_map: Vec<(u32, String)> = menu
        .iter()
        .filter(|i| !i.separator)
        .zip(actions.iter())
        .map(|(item, action)| (item.id, action.clone()))
        .collect();
    let map = std::sync::Arc::new(std::sync::Mutex::new(actions_map));
    let hotkey_map: std::sync::Arc<std::sync::Mutex<Vec<(i32, String)>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

    std::thread::spawn(move || {
        let class_name = w::wide(TRAY_CLASS);
        let instance = unsafe { w::GetModuleHandleW(std::ptr::null()) };
        let window_class = w::WNDCLASSEXW {
            cbSize: std::mem::size_of::<w::WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(proc_tray),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: 0,
            hCursor: 0,
            hbrBackground: 0,
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: 0,
        };
        unsafe {
            w::RegisterClassExW(&window_class);
        }
        let hwnd = unsafe {
            w::CreateWindowExW(
                0,
                class_name.as_ptr(),
                w::wide("WinWidget").as_ptr(),
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                instance,
                std::ptr::null_mut(),
            )
        };
        if hwnd == 0 {
            crate::core::logging::error("Tray: the window could not be created");
            return;
        }
        let exe = std::env::current_exe().unwrap_or_default();
        let icon = icon_for(&exe.to_string_lossy());

        let mut data = zero_icon_data();
        data.hWnd = hwnd;
        data.uID = 1;
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        data.uCallbackMessage = TRAY_MESSAGE;
        data.hIcon = icon;
        put_wide(&mut data.szTip, "WinWidget");
        unsafe {
            w::Shell_NotifyIconW(NIM_ADD, &mut data);
        }

        for (index, (action, keys)) in hotkeys.iter().enumerate() {
            if keys.trim().is_empty() {
                continue;
            }
            if let Some((mods, vk)) = parse_hotkey(keys) {
                let id = 100 + index as i32;
                let ok = unsafe { w::RegisterHotKey(hwnd, id, mods, vk) } != 0;
                if ok {
                    hotkey_map.lock().unwrap().push((id, action.clone()));
                } else {
                    crate::core::logging::warn(&format!(
                        "Hotkey {keys} for '{action}' could not be registered"
                    ));
                }
            }
        }

        let ctx = TrayCtx {
            menu: menu.clone(),
            map: map.clone(),
            hotkeys: hotkey_map.clone(),
            on_action: Box::new(on_action),
        };
        TRAY_CTX.with(|cell| *cell.borrow_mut() = Some(ctx));

        let mut msg = w::MSG::default();
        loop {
            let got = unsafe { w::GetMessageW(&mut msg, 0, 0, 0) };
            if got <= 0 {
                break;
            }
            unsafe {
                w::TranslateMessage(&msg);
                w::DispatchMessageW(&msg);
            }
            // Anything the main thread wants shown (notifications, quit).
            while let Ok(item) = rx.try_recv() {
                match item {
                    TrayIn::Notify { title, body } => {
                        let mut data = zero_icon_data();
                        data.hWnd = hwnd;
                        data.uID = 1;
                        data.uFlags = NIF_INFO;
                        data.dwInfoFlags = NIIF_INFO;
                        put_wide(&mut data.szInfoTitle, &title);
                        put_wide(&mut data.szInfo, &body);
                        unsafe {
                            w::Shell_NotifyIconW(NIM_MODIFY, &mut data);
                        }
                    }
                    TrayIn::Tip(tip) => {
                        let mut data = zero_icon_data();
                        data.hWnd = hwnd;
                        data.uID = 1;
                        data.uFlags = NIF_TIP;
                        put_wide(&mut data.szTip, &tip);
                        unsafe {
                            w::Shell_NotifyIconW(NIM_MODIFY, &mut data);
                        }
                    }
                    TrayIn::Menu(menu, actions) => {
                        let map: Vec<(u32, String)> = menu
                            .iter()
                            .filter(|i| !i.separator)
                            .zip(actions.iter())
                            .map(|(item, action)| (item.id, action.clone()))
                            .collect();
                        TRAY_CTX.with(|cell| {
                            if let Some(ctx) = cell.borrow_mut().as_mut() {
                                ctx.menu = menu;
                                *ctx.map.lock().unwrap() = map;
                            }
                        });
                    }
                    TrayIn::Hotkeys(list) => {
                        for (id, _) in hotkey_map.lock().unwrap().drain(..) {
                            unsafe {
                                w::UnregisterHotKey(hwnd, id);
                            }
                        }
                        for (index, (action, keys)) in list.iter().enumerate() {
                            if keys.trim().is_empty() {
                                continue;
                            }
                            if let Some((mods, vk)) = parse_hotkey(keys) {
                                let id = 100 + index as i32;
                                let ok = unsafe { w::RegisterHotKey(hwnd, id, mods, vk) } != 0;
                                if ok {
                                    hotkey_map.lock().unwrap().push((id, action.clone()));
                                } else {
                                    crate::core::logging::warn(&format!(
                                        "Hotkey {keys} for '{action}' could not be registered"
                                    ));
                                }
                            }
                        }
                    }
                    TrayIn::Quit => {
                        let mut data = zero_icon_data();
                        data.hWnd = hwnd;
                        data.uID = 1;
                        unsafe {
                            w::Shell_NotifyIconW(NIM_DELETE, &mut data);
                            w::DestroyWindow(hwnd);
                        }
                        return;
                    }
                }
            }
        }
    });

    TrayHandle { tx }
}

struct TrayCtx {
    menu: Vec<MenuItem>,
    map: std::sync::Arc<std::sync::Mutex<Vec<(u32, String)>>>,
    hotkeys: std::sync::Arc<std::sync::Mutex<Vec<(i32, String)>>>,
    on_action: Box<dyn Fn(String)>,
}

thread_local! {
    static TRAY_CTX: std::cell::RefCell<Option<TrayCtx>> = const { std::cell::RefCell::new(None) };
}

unsafe extern "system" fn proc_tray(
    hwnd: w::HWND,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    match msg {
        ASK_CONTROL => {
            crate::core::logging::info("Tray: asked to show the control center");
            TRAY_CTX.with(|cell| {
                if let Some(ctx) = cell.borrow().as_ref() {
                    (ctx.on_action)("control.open".to_string());
                } else {
                    crate::core::logging::warn("Tray: no context, the request is dropped");
                }
            });
            0
        }
        TRAY_MESSAGE => {
            let event = lparam as u32;
            match event {
                WM_LBUTTONUP | WM_LBUTTONDBLCLK => TRAY_CTX.with(|cell| {
                    if let Some(ctx) = cell.borrow().as_ref() {
                        (ctx.on_action)("tray.open".to_string());
                    }
                }),
                WM_RBUTTONUP => {
                    let ctx = TRAY_CTX.with(|cell| cell.borrow_mut().take());
                    if let Some(ctx) = ctx {
                        let p = w::cursor_pos();
                        let picked = popup_menu(hwnd, &ctx.menu, p.x, p.y);
                        if let Some(id) = picked {
                            let action = ctx
                                .map
                                .lock()
                                .unwrap()
                                .iter()
                                .find(|(mid, _)| *mid == id)
                                .map(|(_, a)| a.clone());
                            if let Some(action) = action {
                                (ctx.on_action)(action);
                            }
                        }
                        TRAY_CTX.with(|cell| *cell.borrow_mut() = Some(ctx));
                    }
                }
                _ => {}
            }
            0
        }
        WM_HOTKEY_MSG => {
            let id = wparam as i32;
            let action = TRAY_CTX.with(|cell| {
                cell.borrow().as_ref().and_then(|ctx| {
                    ctx.hotkeys
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(hid, _)| *hid == id)
                        .map(|(_, a)| a.clone())
                })
            });
            if let Some(action) = action {
                TRAY_CTX.with(|cell| {
                    if let Some(ctx) = cell.borrow().as_ref() {
                        (ctx.on_action)(format!("hotkey.{action}"));
                    }
                });
            }
            0
        }
        WM_DESTROY => {
            unsafe { w::PostQuitMessage(0) };
            0
        }
        _ => unsafe { w::DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn zero_icon_data() -> w::NOTIFYICONDATAW {
    w::NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<w::NOTIFYICONDATAW>() as u32,
        hWnd: 0,
        uID: 0,
        uFlags: 0,
        uCallbackMessage: 0,
        hIcon: 0,
        szTip: [0; 128],
        dwState: 0,
        dwStateMask: 0,
        szInfo: [0; 256],
        uTimeoutOrVersion: 0,
        szInfoTitle: [0; 64],
        dwInfoFlags: 0,
        guidItem: w::GUID::default(),
        hBalloonIcon: 0,
    }
}

fn put_wide(target: &mut [u16], text: &str) {
    let wide: Vec<u16> = text
        .encode_utf16()
        .take(target.len().saturating_sub(1))
        .collect();
    target[..wide.len()].copy_from_slice(&wide);
    let end = wide.len();
    target[end] = 0;
}

fn icon_for(exe: &str) -> w::HICON {
    let path = w::wide(exe);
    let mut large: w::HICON = 0;
    let count = unsafe { w::ExtractIconExW(path.as_ptr(), 0, &mut large, std::ptr::null_mut(), 1) };
    if count > 0 && large != 0 {
        large
    } else {
        // No icon resource: fall back to the generic application icon.
        unsafe { w::LoadIconW(0, 32512) }
    }
}

pub fn hotkey_ok(keys: &str) -> bool {
    parse_hotkey(keys).is_some()
}

pub fn parse_hotkey(keys: &str) -> Option<(u32, u32)> {
    let mut mods = 0u32;
    let mut key = String::new();
    for part in keys.split('+') {
        let t = part.trim().to_lowercase();
        match t.as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "alt" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            "win" | "super" => mods |= MOD_WIN,
            _ => key = t,
        }
    }
    let vk = match key.as_str() {
        "space" => 0x20,
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "escape" | "esc" => 0x1B,
        "left" => 0x25,
        "right" => 0x27,
        "up" => 0x26,
        "down" => 0x28,
        k if k.len() == 1 => {
            let c = k.chars().next()?;
            if c.is_ascii_alphabetic() {
                c.to_ascii_uppercase() as u32
            } else if c.is_ascii_digit() {
                c as u32
            } else {
                return None;
            }
        }
        k if k.starts_with('f')
            && k[1..]
                .parse::<u32>()
                .ok()
                .map(|n| (1..=24).contains(&n))
                .unwrap_or(false) =>
        {
            0x70 + k[1..].parse::<u32>().ok()? - 1
        }
        _ => return None,
    };
    if mods == 0 {
        return None;
    }
    Some((mods, vk))
}
