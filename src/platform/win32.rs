//! The Win32 work the host needs: layered borderless windows, desktop layering, click-through,
//! acrylic, monitors, shortcuts, native menus and window messages for the tray.
//!
//! Declared by hand rather than through a binding crate: the few functions used here are stable,
//! and this keeps the calls readable.

// Names and parameter order deliberately mirror the Windows SDK: renaming them would make the
// declarations harder to check against the documentation, and `dead_code` covers the ones that
// only exist to document the ABI.
#![allow(non_snake_case, dead_code, clippy::upper_case_acronyms)]

use std::ffi::c_void;

pub type HWND = isize;
pub type HINSTANCE = isize;
pub type HMENU = isize;
pub type HICON = isize;
pub type HANDLE = isize;
pub type LPRECT = *mut RECT;

pub const GWL_STYLE: i32 = -16;
pub const GWL_EXSTYLE: i32 = -20;

pub const WS_POPUP: isize = 0x8000_0000u32 as isize;
pub const WS_CHILD: isize = 0x4000_0000;
pub const WS_CLIPCHILDREN: isize = 0x0200_0000;
pub const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
pub const WS_EX_LAYERED: isize = 0x0008_0000;
pub const WS_EX_TRANSPARENT: isize = 0x0000_0020;
pub const WS_EX_NOACTIVATE: isize = 0x0800_0000;

pub const HWND_TOP: HWND = 0;
pub const HWND_NOTOPMOST: HWND = -2;
pub const HWND_TOPMOST: HWND = -1;

pub const SW_HIDE: i32 = 0;
pub const SW_SHOWNOACTIVATE: i32 = 4;
pub const SW_SHOWNOACTIVATE_ALT: i32 = 8;

pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOZORDER: u32 = 0x0004;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const SWP_FRAMECHANGED: u32 = 0x0020;
pub const SWP_NOOWNERZORDER: u32 = 0x0200;
pub const SWP_SHOWWINDOW: u32 = 0x0040;
pub const SWP_HIDEWINDOW: u32 = 0x0080;

pub const GW_HWNDNEXT: u32 = 2;
pub const GW_HWNDPREV: u32 = 3;
pub const LWA_ALPHA: u32 = 0x0000_0002;
pub const GWL_EXSTYLE_LAYERED: isize = 0x0008_0000;

pub const VK_LBUTTON: i32 = 0x01;
pub const VK_CONTROL: i32 = 0x11;

pub const GWLP_WNDPROC: i32 = -4;
/// `GWLP_HWNDPARENT`: the owner of a top-level window, or the parent of a child window.
pub const GWLP_HWNDPARENT: i32 = -8;

pub const WM_SIZE: u32 = 0x0005;
pub const WM_ACTIVATE: u32 = 0x0006;
pub const WM_SHOWWINDOW: u32 = 0x0018;
pub const WM_NCCALCSIZE: u32 = 0x0083;
pub const WM_NCPAINT: u32 = 0x0085;
pub const WM_NCACTIVATE: u32 = 0x0086;
pub const WM_NCLBUTTONDOWN: u32 = 0x00A1;
pub const WM_SIZING: u32 = 0x0214;
pub const WM_MOVING: u32 = 0x0216;
pub const WM_ENTERSIZEMOVE: u32 = 0x0231;
pub const WM_EXITSIZEMOVE: u32 = 0x0232;

pub const HTCAPTION: usize = 2;
pub const HTBOTTOMRIGHT: usize = 17;

pub const ULW_ALPHA: u32 = 0x0000_0002;
pub const DIB_RGB_COLORS: u32 = 0;
pub const BI_RGB: u32 = 0;

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct SIZE {
    pub cx: i32,
    pub cy: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct BLENDFUNCTION {
    pub BlendOp: u8,
    pub BlendFlags: u8,
    pub SourceConstantAlpha: u8,
    pub AlphaFormat: u8,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct BITMAPINFOHEADER {
    pub biSize: u32,
    pub biWidth: i32,
    pub biHeight: i32,
    pub biPlanes: u16,
    pub biBitCount: u16,
    pub biCompression: u32,
    pub biSizeImage: u32,
    pub biXPelsPerMeter: i32,
    pub biYPelsPerMeter: i32,
    pub biClrUsed: u32,
    pub biClrImportant: u32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct BITMAPINFO {
    pub bmiHeader: BITMAPINFOHEADER,
    pub bmiColors: [u32; 3],
}

pub const MONITOR_DEFAULTTONEAREST: u32 = 2;

pub const MF_STRING: u32 = 0x0000_0000;
pub const MF_CHECKED: u32 = 0x0000_0008;
pub const MF_UNCHECKED: u32 = 0x0000_0000;
pub const MF_SEPARATOR: u32 = 0x0000_0800;
pub const MF_GRAYED: u32 = 0x0000_0001;
pub const MF_POPUP: u32 = 0x0000_0010;
pub const TPM_RETURNCMD: u32 = 0x0100;
pub const TPM_RIGHTBUTTON: u32 = 0x0002;
pub const TPM_NONOTIFY: u32 = 0x0080;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl RECT {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct MARGINS {
    pub cxLeftWidth: i32,
    pub cxRightWidth: i32,
    pub cyTopHeight: i32,
    pub cyBottomHeight: i32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct MONITORINFO {
    pub cbSize: u32,
    pub rcMonitor: RECT,
    pub rcWork: RECT,
    pub dwFlags: u32,
}

pub const MONITORINFOF_PRIMARY: u32 = 1;

pub type MONITORENUMPROC = extern "system" fn(isize, isize, *mut RECT, isize) -> i32;

/// Every monitor, primary first, with its rectangle in physical pixels.
pub fn monitors() -> Vec<(RECT, bool)> {
    extern "system" fn collect(monitor: isize, _hdc: isize, _rect: *mut RECT, data: isize) -> i32 {
        let list = unsafe { &mut *(data as *mut Vec<(RECT, bool)>) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
            list.push((info.rcMonitor, info.dwFlags & MONITORINFOF_PRIMARY != 0));
        }
        1
    }
    let mut list: Vec<(RECT, bool)> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            0,
            std::ptr::null(),
            collect,
            &mut list as *mut Vec<(RECT, bool)> as isize,
        );
    }
    if list.is_empty() {
        list.push((
            RECT {
                left: 0,
                top: 0,
                right: unsafe { GetSystemMetrics(0) },
                bottom: unsafe { GetSystemMetrics(1) },
            },
            true,
        ));
    }
    list.sort_by_key(|(rect, primary)| (!*primary, rect.left));
    list
}

#[repr(C)]
struct ACCENT_POLICY {
    accent_state: i32,
    accent_flags: i32,
    gradient_color: u32,
    animation_id: i32,
}

#[repr(C)]
struct WINDOWCOMPOSITIONATTRIBDATA {
    attribute: i32,
    data: *mut c_void,
    size_of_data: u32,
}

const WCA_ACCENT_POLICY: i32 = 19;
const ACCENT_DISABLED: i32 = 0;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: i32 = 4;
const ACCENT_ENABLE_BLURBEHIND: i32 = 3;

#[link(name = "user32")]
extern "system" {
    pub fn SetWindowLongPtrW(hwnd: HWND, index: i32, value: isize) -> isize;
    pub fn GetWindowLongPtrW(hwnd: HWND, index: i32) -> isize;
    pub fn SetWindowPos(
        hwnd: HWND,
        after: HWND,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    pub fn ShowWindow(hwnd: HWND, cmd: i32) -> i32;
    pub fn FindWindowW(class: *const u16, name: *const u16) -> HWND;
    pub fn EnumWindows(
        callback: Option<unsafe extern "system" fn(HWND, isize) -> i32>,
        data: isize,
    ) -> i32;
    pub fn GetClassNameW(hwnd: HWND, buffer: *mut u16, len: i32) -> i32;
    pub fn GetWindowTextW(hwnd: HWND, buffer: *mut u16, len: i32) -> i32;
    pub fn GetWindow(hwnd: HWND, cmd: u32) -> HWND;
    pub fn GetParent(hwnd: HWND) -> HWND;
    pub fn SetParent(hwnd: HWND, parent: HWND) -> HWND;
    pub fn ScreenToClient(hwnd: HWND, point: *mut POINT) -> i32;
    pub fn ClientToScreen(hwnd: HWND, point: *mut POINT) -> i32;
    pub fn SetLayeredWindowAttributes(hwnd: HWND, key: u32, alpha: u8, flags: u32) -> i32;
    pub fn GetCursorPos(p: *mut POINT) -> i32;
    pub fn WindowFromPoint(p: POINT) -> HWND;
    pub fn GetAsyncKeyState(key: i32) -> i16;
    pub fn MonitorFromRect(rect: *const RECT, flags: u32) -> isize;
    pub fn GetMonitorInfoW(monitor: isize, info: *mut MONITORINFO) -> i32;
    pub fn EnumDisplayMonitors(
        hdc: isize,
        clip: *const RECT,
        callback: MONITORENUMPROC,
        data: isize,
    ) -> i32;
    pub fn GetSystemMetrics(index: i32) -> i32;
    pub fn GetForegroundWindow() -> HWND;
    pub fn SetForegroundWindow(hwnd: HWND) -> i32;
    pub fn AttachThreadInput(id_attach: u32, id_attach_to: u32, attach: i32) -> i32;
    pub fn IsWindow(hwnd: HWND) -> i32;
    pub fn IsWindowVisible(hwnd: HWND) -> i32;
    pub fn IsIconic(hwnd: HWND) -> i32;
    pub fn GetWindowThreadProcessId(hwnd: HWND, pid: *mut u32) -> u32;
    pub fn IsZoomed(hwnd: HWND) -> i32;
    pub fn DestroyWindow(hwnd: HWND) -> i32;
    pub fn CreateWindowExW(
        ex_style: u32,
        class: *const u16,
        name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: HWND,
        menu: HMENU,
        instance: HINSTANCE,
        param: *mut c_void,
    ) -> HWND;
    pub fn DefWindowProcW(hwnd: HWND, msg: u32, w: usize, l: isize) -> isize;
    pub fn RegisterClassExW(class: *const WNDCLASSEXW) -> u16;
    pub fn GetMessageW(msg: *mut MSG, hwnd: HWND, min: u32, max: u32) -> i32;
    pub fn TranslateMessage(msg: *const MSG) -> i32;
    pub fn DispatchMessageW(msg: *const MSG) -> isize;
    pub fn PostMessageW(hwnd: HWND, msg: u32, w: usize, l: isize) -> i32;
    pub fn PostQuitMessage(code: i32);
    pub fn RegisterHotKey(hwnd: HWND, id: i32, modifiers: u32, key: u32) -> i32;
    pub fn UnregisterHotKey(hwnd: HWND, id: i32) -> i32;
    pub fn CreatePopupMenu() -> HMENU;
    pub fn AppendMenuW(menu: HMENU, flags: u32, id: usize, text: *const u16) -> i32;
    pub fn DestroyMenu(menu: HMENU) -> i32;
    pub fn TrackPopupMenu(
        menu: HMENU,
        flags: u32,
        x: i32,
        y: i32,
        reserved: i32,
        hwnd: HWND,
        rect: *const RECT,
    ) -> i32;
    pub fn GetDC(hwnd: HWND) -> isize;
    pub fn ReleaseDC(hwnd: HWND, dc: isize) -> i32;
    pub fn DrawIconEx(
        dc: isize,
        x: i32,
        y: i32,
        icon: HICON,
        cx: i32,
        cy: i32,
        istep: u32,
        brush: isize,
        flags: u32,
    ) -> i32;
    pub fn DestroyIcon(icon: HICON) -> i32;
    pub fn CreateIconFromResourceEx(
        bits: *const u8,
        size: u32,
        ficon: i32,
        version: u32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> HICON;
    pub fn MessageBoxW(hwnd: HWND, text: *const u16, caption: *const u16, kind: u32) -> i32;
    pub fn ExitWindowsEx(flags: u32, reason: u32) -> i32;
    /// Locks the workstation through the same call the Win+L shortcut uses.
    pub fn LockWorkStation() -> i32;
    pub fn SystemParametersInfoW(action: u32, param: u32, value: *mut c_void, win_ini: u32) -> i32;
    pub fn GetSystemPowerStatus(status: *mut SYSTEM_POWER_STATUS) -> i32;
    pub fn LoadIconW(instance: HINSTANCE, name: usize) -> HICON;
    pub fn CallWindowProcW(previous: isize, hwnd: HWND, msg: u32, w: usize, l: isize) -> isize;
    pub fn SendMessageW(hwnd: HWND, msg: u32, w: usize, l: isize) -> isize;
    pub fn SetCursorPos(x: i32, y: i32) -> i32;
    pub fn ReleaseCapture() -> i32;
    pub fn SetCapture(hwnd: HWND) -> HWND;
    pub fn GetClientRect(hwnd: HWND, rect: LPRECT) -> i32;
    pub fn CreateCompatibleDC(dc: isize) -> isize;
    pub fn DeleteDC(dc: isize) -> i32;
    pub fn SelectObject(dc: isize, object: isize) -> isize;
    pub fn DeleteObject(object: isize) -> i32;
    pub fn CreateDIBSection(
        dc: isize,
        info: *const BITMAPINFO,
        usage: u32,
        bits: *mut *mut c_void,
        section: isize,
        offset: u32,
    ) -> isize;
    pub fn UpdateLayeredWindow(
        hwnd: HWND,
        dst: isize,
        dst_pos: *const POINT,
        size: *const SIZE,
        src: isize,
        src_pos: *const POINT,
        key: u32,
        blend: *const BLENDFUNCTION,
        flags: u32,
    ) -> i32;
}

#[repr(C)]
#[derive(Default)]
pub struct SYSTEM_POWER_STATUS {
    pub ACLineStatus: u8,
    pub BatteryFlag: u8,
    pub BatteryLifePercent: u8,
    pub SystemStatusFlag: u8,
    pub BatteryLifeTime: u32,
    pub BatteryFullLifeTime: u32,
}

#[repr(C)]
pub struct WNDCLASSEXW {
    pub cbSize: u32,
    pub style: u32,
    pub lpfnWndProc: Option<unsafe extern "system" fn(HWND, u32, usize, isize) -> isize>,
    pub cbClsExtra: i32,
    pub cbWndExtra: i32,
    pub hInstance: HINSTANCE,
    pub hIcon: HICON,
    pub hCursor: isize,
    pub hbrBackground: isize,
    pub lpszMenuName: *const u16,
    pub lpszClassName: *const u16,
    pub hIconSm: HICON,
}

#[repr(C)]
#[derive(Default)]
pub struct MSG {
    pub hwnd: HWND,
    pub message: u32,
    pub wParam: usize,
    pub lParam: isize,
    pub time: u32,
    pub pt: POINT,
}

#[repr(C)]
#[derive(Default)]
pub struct SHFILEOPSTRUCTW {
    pub hwnd: HWND,
    pub wFunc: u32,
    pub pFrom: *const u16,
    pub pTo: *const u16,
    pub fFlags: u16,
    pub fAnyOperationsAborted: i32,
    pub hNameMappings: *mut std::ffi::c_void,
    pub lpszProgressTitle: *const u16,
}

const FO_DELETE: u32 = 3;
const FOF_ALLOWUNDO: u16 = 0x0040;
const FOF_NOCONFIRMATION: u16 = 0x0010;
const FOF_SILENT: u16 = 0x0004;
const FOF_NOERRORUI: u16 = 0x0400;

/// Moves a folder or file to the recycle bin. Returns false when the shell refused.
pub fn recycle_path(path: &std::path::Path) -> bool {
    let mut from: Vec<u16> = path.to_string_lossy().encode_utf16().collect();
    from.push(0);
    from.push(0);
    let mut op = SHFILEOPSTRUCTW {
        hwnd: 0,
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        ..Default::default()
    };
    let result = unsafe { SHFileOperationW(&mut op) };
    result == 0 && op.fAnyOperationsAborted == 0
}

#[link(name = "shell32")]
extern "system" {
    pub fn Shell_NotifyIconW(op: u32, data: *mut NOTIFYICONDATAW) -> i32;
    pub fn SHFileOperationW(op: *mut SHFILEOPSTRUCTW) -> i32;
    pub fn ShellExecuteW(
        hwnd: HWND,
        op: *const u16,
        file: *const u16,
        params: *const u16,
        dir: *const u16,
        show: i32,
    ) -> isize;
    pub fn SHGetFileInfoW(
        path: *const u16,
        attributes: u32,
        info: *mut SHFILEINFOW,
        size: u32,
        flags: u32,
    ) -> usize;
    pub fn SHQueryRecycleBinW(root: *const u16, info: *mut SHQUERYRBINFO) -> i32;
    pub fn SHEmptyRecycleBinW(hwnd: HWND, root: *const u16, flags: u32) -> i32;
    pub fn ExtractIconExW(
        file: *const u16,
        index: i32,
        large: *mut HICON,
        small: *mut HICON,
        count: u32,
    ) -> u32;
    pub fn SHGetKnownFolderPath(
        id: *const GUID,
        flags: u32,
        token: isize,
        path: *mut *mut u16,
    ) -> i32;
    pub fn CoTaskMemFree(p: *mut c_void);
}

#[repr(C)]
pub struct SHFILEINFOW {
    pub hIcon: HICON,
    pub iIcon: i32,
    pub dwAttributes: u32,
    pub szDisplayName: [u16; 260],
    pub szTypeName: [u16; 80],
}

#[repr(C)]
pub struct SHQUERYRBINFO {
    pub cbSize: u32,
    pub i64Size: i64,
    pub i64NumItems: i64,
}

#[repr(C)]
#[derive(Default)]
pub struct GUID {
    pub data1: u32,
    pub data2: u16,
    pub data3: u16,
    pub data4: [u8; 8],
}

#[repr(C)]
pub struct NOTIFYICONDATAW {
    pub cbSize: u32,
    pub hWnd: HWND,
    pub uID: u32,
    pub uFlags: u32,
    pub uCallbackMessage: u32,
    pub hIcon: HICON,
    pub szTip: [u16; 128],
    pub dwState: u32,
    pub dwStateMask: u32,
    pub szInfo: [u16; 256],
    pub uTimeoutOrVersion: u32,
    pub szInfoTitle: [u16; 64],
    pub dwInfoFlags: u32,
    pub guidItem: GUID,
    pub hBalloonIcon: HICON,
}

#[link(name = "dwmapi")]
extern "system" {
    pub fn DwmExtendFrameIntoClientArea(hwnd: HWND, margins: *const MARGINS) -> i32;
    pub fn DwmSetWindowAttribute(
        hwnd: HWND,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(name: *const u16) -> HINSTANCE;
    pub fn GetLocalTime(time: *mut SYSTEMTIME);
    pub fn GetTimeZoneInformation(info: *mut TIME_ZONE_INFORMATION) -> u32;
    pub fn GetUserDefaultLocaleName(name: *mut u16, size: i32) -> i32;
    pub fn LCMapStringEx(
        locale: *const u16,
        flags: u32,
        src: *const u16,
        src_len: i32,
        dest: *mut u16,
        dest_len: i32,
        version: *const c_void,
        reserved: isize,
        reserved2: isize,
    ) -> i32;
    pub fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    pub fn GlobalFree(mem: isize) -> isize;
    pub fn GlobalLock(mem: isize) -> *mut c_void;
    pub fn GlobalUnlock(mem: isize) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(reserved: *const c_void, model: u32) -> i32;
}

/// `COINIT_MULTITHREADED`.
pub const COINIT_MULTITHREADED: u32 = 0x0;

/// Marks the calling thread as an MTA apartment, which is what WinRT calls want.
///
/// A thread with no apartment at all gets `CO_E_NOTINITIALIZED` from every WinRT call, and a thread
/// that holds an STA (the window/event-loop thread) makes a blocking `.get()` on an async operation
/// wait forever: the completion is marshalled back to that very apartment, whose message pump
/// cannot run while the call is still on the stack. Returns true when the apartment is usable.
pub fn co_initialize_mta() -> bool {
    // S_OK (0) or S_FALSE (1) means "this thread is an apartment now / already was one".
    let hr = unsafe { CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED) };
    matches!(hr, 0 | 1)
}

#[repr(C)]
#[derive(Default)]
pub struct SYSTEMTIME {
    pub wYear: u16,
    pub wMonth: u16,
    pub wDayOfWeek: u16,
    pub wDay: u16,
    pub wHour: u16,
    pub wMinute: u16,
    pub wSecond: u16,
    pub wMilliseconds: u16,
}

#[repr(C)]
#[derive(Default)]
pub struct TIME_ZONE_INFORMATION {
    pub Bias: i32,
    pub StandardName: [u16; 32],
    pub StandardDate: SYSTEMTIME,
    pub StandardBias: i32,
    pub DaylightName: [u16; 32],
    pub DaylightDate: SYSTEMTIME,
    pub DaylightBias: i32,
}

#[link(name = "powrprof")]
extern "system" {
    pub fn SetSuspendState(hibernate: i32, force: i32, disable_wake: i32) -> i32;
}

// ── helpers ─────────────────────────────────────────────────────────────────

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn cursor_pos() -> POINT {
    let mut p = POINT::default();
    unsafe {
        GetCursorPos(&mut p);
    }
    p
}

pub fn set_cursor_pos(x: i32, y: i32) {
    unsafe {
        SetCursorPos(x, y);
    }
}

pub fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON) as u32 & 0x8000) != 0 }
}

pub fn progman() -> HWND {
    unsafe { FindWindowW(wide("Progman").as_ptr(), std::ptr::null()) }
}

/// Makes the window per-pixel transparent: the DWM frame covers the whole client area.
pub fn extend_frame(hwnd: HWND) {
    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    unsafe {
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

/// Turns the glass frame off again. Kept for a window that must lose per-pixel transparency, for
/// example before handing it back to the shell as a plain popup.
#[allow(dead_code)]
pub fn clear_frame(hwnd: HWND) {
    let margins = MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: 0,
        cyBottomHeight: 0,
    };
    unsafe {
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

/// Stops DWM from drawing the window's non-client frame. With the frame extended over the whole
/// window, DWM otherwise paints its caption — the window text on a pale strip — across the top of
/// the card, even though `WS_CAPTION` was never set and the margins are zero. Turning the
/// non-client rendering off leaves the per-pixel alpha alone, so the card stays transparent and
/// loses its "title bar" for good.
pub fn disable_nc_rendering(hwnd: HWND) {
    // `DWMWINDOWATTRIBUTE`: NCRENDERING_ENABLED is 1 and NCRENDERING_POLICY is 2. (9 is
    // EXTENDED_FRAME_BOUNDS, a read-only RECT: passing 4 bytes there is what made this call fail
    // with 0x8007007A and left DWM free to paint the caption.)
    const DWMWA_NCRENDERING_POLICY: u32 = 2;
    const DWMNCRP_DISABLED: i32 = 1;
    let value = DWMNCRP_DISABLED;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &value as *const i32 as *const c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// The desktop layer: a popup that the desktop owns, sitting directly above it. Ownership keeps a
/// card behind ordinary windows and on the desktop when Win+D is pressed, and the window stays
/// top-level because only a top-level window can carry the DWM frame that gives per-pixel alpha.
pub fn place_above_desktop(hwnd: HWND) {
    let prog = progman();
    if prog == 0 {
        return;
    }
    unsafe {
        if GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT) != prog {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, prog);
        }
        let mut rect = window_rect(hwnd);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style & WS_CHILD != 0 {
            SetWindowLongPtrW(hwnd, GWL_STYLE, (style & !WS_CHILD) | WS_POPUP);
            SetParent(hwnd, 0);
            let mut origin = POINT {
                x: rect.left,
                y: rect.top,
            };
            ScreenToClient(prog, &mut origin);
            rect.left = origin.x;
            rect.top = origin.y;
        }
        // Directly above the desktop and below every ordinary window, the way the shell stacks a
        // desktop widget.
        let above = GetWindow(prog, GW_HWNDPREV);
        SetWindowPos(
            hwnd,
            if above != 0 && above != hwnd {
                above
            } else {
                HWND_TOP
            },
            rect.left,
            rect.top,
            rect.width(),
            rect.height(),
            SWP_NOACTIVATE,
        );
        // Restacking re-composites the window, which is one of the moments DWM is happy to paint
        // its caption again: re-state the policy every time the card goes back to the desktop.
        disable_nc_rendering(hwnd);
    }
}

pub fn detach_from_desktop(hwnd: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style & WS_CHILD != 0 {
            SetParent(hwnd, 0);
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, (style & !WS_CHILD) | WS_POPUP);
        if GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT) != 0 {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
        }
    }
}

/// Puts a card in the topmost band, or back in with the ordinary windows.
///
/// This must not go through the toolkit's own "always on top" setter: that one routes the flag
/// through the window-flags diff, which re-creates the window — the card keeps no style of ours,
/// comes back hidden with a caption and border, and loses its web view. One `SetWindowPos` moves
/// the window between z-order bands and changes nothing else.
pub fn set_topmost(hwnd: HWND, on: bool) {
    unsafe {
        SetWindowPos(
            hwnd,
            if on { HWND_TOPMOST } else { HWND_NOTOPMOST },
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Click-through: layered + transparent hit-testing. Layered windows need an alpha, and the
/// content still composites through the DWM frame.
pub fn set_click_through(hwnd: HWND, on: bool) {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if on {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED | WS_EX_TRANSPARENT);
            SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
        } else {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !(WS_EX_LAYERED | WS_EX_TRANSPARENT));
        }
    }
}

type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(HWND, *mut WINDOWCOMPOSITIONATTRIBDATA) -> i32;

fn composition_fn() -> Option<SetWindowCompositionAttributeFn> {
    use std::sync::OnceLock;
    static FN: OnceLock<Option<usize>> = OnceLock::new();
    let addr = *FN.get_or_init(|| unsafe {
        let module = GetModuleHandleW(wide("user32.dll").as_ptr());
        if module == 0 {
            return None;
        }
        let proc = GetProcAddress(
            module as isize,
            wide("SetWindowCompositionAttribute").as_ptr(),
        );
        if proc.is_null() {
            None
        } else {
            Some(proc as usize)
        }
    });
    addr.map(|a| unsafe { std::mem::transmute::<usize, SetWindowCompositionAttributeFn>(a) })
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetProcAddress(module: isize, name: *const u16) -> *const c_void;
    pub fn CreateMutexW(attrs: *const c_void, initial: i32, name: *const u16) -> isize;
    pub fn GetLastError() -> u32;
    pub fn GetTickCount64() -> u64;
    pub fn GlobalMemoryStatusEx(buffer: *mut MEMORYSTATUSEX) -> i32;
}

#[repr(C)]
#[derive(Default)]
pub struct MEMORYSTATUSEX {
    pub dwLength: u32,
    pub dwMemoryLoad: u32,
    pub ullTotalPhys: u64,
    pub ullAvailPhys: u64,
    pub ullTotalPageFile: u64,
    pub ullAvailPageFile: u64,
    pub ullTotalVirtual: u64,
    pub ullAvailVirtual: u64,
    pub ullAvailExtendedVirtual: u64,
}

/// Frosted glass behind the card. Falls back to a plain blur, then to nothing.
pub fn set_acrylic(hwnd: HWND, tint_abgr: u32) {
    let Some(f) = composition_fn() else { return };
    let mut policy = ACCENT_POLICY {
        accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        accent_flags: 2,
        gradient_color: tint_abgr,
        animation_id: 0,
    };
    let mut data = WINDOWCOMPOSITIONATTRIBDATA {
        attribute: WCA_ACCENT_POLICY,
        data: &mut policy as *mut _ as *mut c_void,
        size_of_data: std::mem::size_of::<ACCENT_POLICY>() as u32,
    };
    // The policy is handed over as a raw pointer inside `data`, so the compiler cannot see the
    // second call reading the field we just changed.
    #[allow(unused_assignments)]
    unsafe {
        let ok = f(hwnd, &mut data);
        if ok == 0 {
            policy.accent_state = ACCENT_ENABLE_BLURBEHIND;
            let _ = f(hwnd, &mut data);
        }
    }
}

pub fn clear_acrylic(hwnd: HWND) {
    let Some(f) = composition_fn() else { return };
    let mut policy = ACCENT_POLICY {
        accent_state: ACCENT_DISABLED,
        accent_flags: 2,
        gradient_color: 0,
        animation_id: 0,
    };
    let mut data = WINDOWCOMPOSITIONATTRIBDATA {
        attribute: WCA_ACCENT_POLICY,
        data: &mut policy as *mut _ as *mut c_void,
        size_of_data: std::mem::size_of::<ACCENT_POLICY>() as u32,
    };
    unsafe {
        let _ = f(hwnd, &mut data);
    }
}

/// Rounded corners for the frosted style (Windows 11); a no-op elsewhere.
pub fn set_round_corner(hwnd: HWND, round: bool) {
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    let value: u32 = if round { 2 } else { 1 }; // DWMWCP_ROUND / DWMWCP_DONOTROUND
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &value as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

/// Removes the parts of the window frame Windows draws by itself: the 1px border around a card is
/// a DWM border, and it is the only thing that still made a borderless card look framed.
pub fn polish_frame(hwnd: HWND, round: bool) {
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
    unsafe {
        let dark: u32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
        let none: u32 = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &none as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
    set_round_corner(hwnd, round);
    // A rounded corner, a border colour and a new frame style are all reasons for the window to
    // recomposite, and a recomposite is where DWM goes back to painting a caption over the card.
    disable_nc_rendering(hwnd);
}

/// True while Ctrl is held: the drag then places the card freely, without snapping.
pub fn ctrl_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_CONTROL) as u32 & 0x8000) != 0 }
}

pub fn monitor_work_area(rect: &RECT) -> (RECT, RECT) {
    let monitor = unsafe { MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        GetMonitorInfoW(monitor, &mut info);
    }
    if info.rcWork.right == 0 && info.rcWork.bottom == 0 {
        let (w, h) = unsafe { (GetSystemMetrics(0), GetSystemMetrics(1)) };
        let full = RECT {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
        };
        (full, full)
    } else {
        (info.rcMonitor, info.rcWork)
    }
}

/// A parented card is positioned in its parent's client space; everything else in the app works in
/// screen coordinates, so the conversion happens here.
/// True only for a real child window: a popup owned by the desktop also answers `GetParent` with a
/// handle, yet its coordinates are screen coordinates and it keeps its own message loop.
pub fn is_child(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_CHILD != 0 }
}

fn parent_space(hwnd: HWND, x: i32, y: i32) -> (i32, i32) {
    unsafe {
        if !is_child(hwnd) {
            return (x, y);
        }
        let parent = GetParent(hwnd);
        if parent == 0 {
            return (x, y);
        }
        let mut pt = POINT { x, y };
        ScreenToClient(parent, &mut pt);
        (pt.x, pt.y)
    }
}

pub fn move_window(hwnd: HWND, x: i32, y: i32) {
    let (px, py) = parent_space(hwnd, x, y);
    unsafe {
        SetWindowPos(
            hwnd,
            0,
            px,
            py,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

pub fn resize_window(hwnd: HWND, x: i32, y: i32, w: i32, h: i32) {
    let (px, py) = parent_space(hwnd, x, y);
    unsafe {
        SetWindowPos(hwnd, 0, px, py, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

pub fn window_rect(hwnd: HWND) -> RECT {
    let mut r = RECT::default();
    if hwnd != 0 {
        unsafe {
            let _ = GetWindowRect(hwnd, &mut r);
        }
    }
    r
}

/// Size of a window, (-1, -1) when the handle is gone.
pub fn window_size(hwnd: HWND) -> (i32, i32) {
    if hwnd == 0 || unsafe { IsWindow(hwnd) } == 0 {
        return (-1, -1);
    }
    let r = window_rect(hwnd);
    (r.right - r.left, r.bottom - r.top)
}

pub fn foreground_window() -> HWND {
    unsafe { GetForegroundWindow() }
}

/// "class|title" of the foreground window — for log lines that must say where a keystroke went.
pub fn foreground_label() -> String {
    let hwnd = foreground_window();
    if hwnd == 0 {
        return "(none)".into();
    }
    let class = class_name(hwnd);
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    let title = if n > 0 {
        String::from_utf16_lossy(&buf[..n as usize])
    } else {
        String::new()
    };
    format!("{class}|{title}")
}

/// True when the window is in the maximized state — a maximized window is not "full screen".
pub fn is_zoomed(hwnd: HWND) -> bool {
    if hwnd == 0 {
        return false;
    }
    unsafe { IsZoomed(hwnd) != 0 }
}

/// Windows' own verdict on whether a full-screen app (game, video, presentation) is in front.
/// Only used as a fallback: it also fires for a live-wallpaper renderer that covers the desktop.
pub fn fullscreen_app_running() -> bool {
    #[link(name = "shell32")]
    extern "system" {
        fn SHQueryUserNotificationState(state: *mut i32) -> i32;
    }
    let mut state: i32 = -1;
    let hr = unsafe { SHQueryUserNotificationState(&mut state) };
    if hr != 0 {
        return false;
    }
    matches!(state, 2..=4)
}

/// The monitor covered by another app's full-screen window, if there is one.
///
/// Geometry decides, the way FullWidget did: a maximized window, one that still has a title bar,
/// the desktop shell itself, or our own windows never count. `SHQueryUserNotificationState` alone
/// is not enough here — a live wallpaper renders "full screen" all day and would hide the cards.
pub fn fullscreen_monitor(own_pid: u32) -> Option<RECT> {
    let hwnd = foreground_window();
    if hwnd == 0 || unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
        return None;
    }
    if is_zoomed(hwnd) {
        return None;
    }
    const WS_CAPTION: isize = 0x00C0_0000;
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    if style & WS_CAPTION == WS_CAPTION {
        return None;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == own_pid {
        return None;
    }
    let class = class_name(hwnd);
    if matches!(
        class.as_str(),
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    ) {
        return None;
    }
    // A live-wallpaper host covers the screen permanently; treating it as a fullscreen app would
    // hide every card for good, so wallpaper processes are never counted.
    let lower = class.to_ascii_lowercase();
    if lower.contains("wallpaper") {
        return None;
    }
    let rect = window_rect(hwnd);
    let (screen, _) = monitor_work_area(&rect);
    let covers = rect.left <= screen.left
        && rect.top <= screen.top
        && rect.right >= screen.right
        && rect.bottom >= screen.bottom;
    if covers {
        Some(screen)
    } else {
        None
    }
}

pub fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

/// Finds the first top-level window whose class name matches, hidden windows included.
pub fn find_window_by_class(class: &str) -> HWND {
    struct Search {
        want: Vec<u16>,
        found: HWND,
    }
    let mut search = Search {
        want: wide(class),
        found: 0,
    };
    unsafe extern "system" fn cb(hwnd: HWND, data: isize) -> i32 {
        let search = &mut *(data as *mut Search);
        let mut buf = [0u16; 256];
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if n > 0 {
            let name = &buf[..n as usize];
            let want = &search.want[..search.want.len().saturating_sub(1)];
            if name == want {
                search.found = hwnd;
                return 0; // stop enumerating
            }
        }
        1
    }
    unsafe {
        EnumWindows(Some(cb), &mut search as *mut Search as isize);
    }
    search.found
}

#[link(name = "user32")]
extern "system" {
    pub fn GetWindowRect(hwnd: HWND, rect: LPRECT) -> i32;
}

pub fn show_no_activate(hwnd: HWND) {
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE_ALT);
    }
}

pub fn hide(hwnd: HWND) {
    unsafe {
        ShowWindow(hwnd, SW_HIDE);
    }
}

/// Rectangle at `anchor` expanded by `margin` on every side — the window, while the card is the
/// inner rectangle.
pub fn inflate(card: RECT, margin: i32) -> RECT {
    RECT {
        left: card.left - margin,
        top: card.top - margin,
        right: card.right + margin,
        bottom: card.bottom + margin,
    }
}

pub fn file_icon_data_url(path: &str, size: i32) -> Option<String> {
    unsafe {
        let mut info = SHFILEINFOW {
            hIcon: 0,
            iIcon: 0,
            dwAttributes: 0,
            szDisplayName: [0; 260],
            szTypeName: [0; 80],
        };
        let flags = 0x0000_0100; // SHGFI_ICON (large icon)
        let ok = SHGetFileInfoW(
            wide(path).as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if ok == 0 || info.hIcon == 0 {
            return None;
        }
        let png = icon_to_png(info.hIcon, size).ok();
        DestroyIcon(info.hIcon);
        png.map(|bytes| format!("data:image/png;base64,{}", base64(&bytes)))
    }
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleBitmap(dc: isize, w: i32, h: i32) -> isize;
    fn GetDIBits(
        dc: isize,
        bitmap: isize,
        start: u32,
        lines: u32,
        bits: *mut c_void,
        info: *mut BITMAPINFO,
        usage: u32,
    ) -> i32;
}

fn icon_to_png(icon: HICON, size: i32) -> Result<Vec<u8>, String> {
    unsafe {
        let screen = GetDC(0);
        let dc = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, size, size);
        let old = SelectObject(dc, bitmap);
        let _ = DrawIconEx(dc, 0, 0, icon, size, size, 0, 0, 3 /* DI_NORMAL */);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                ..Default::default()
            },
            bmiColors: [0; 3],
        };
        let mut bits = vec![0u8; (size * size * 4) as usize];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            size as u32,
            bits.as_mut_ptr() as *mut c_void,
            &mut info,
            0,
        );
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        ReleaseDC(0, screen);
        if lines == 0 {
            return Err("the icon could not be read".into());
        }
        // BGRA → RGBA
        for px in bits.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        let buf = crate::core::img::encode_png(size as u32, size as u32, &bits);
        buf.map_err(|e| e.to_string())
    }
}

// ── clipboard, screen capture, known folders ────────────────────────────────
// The three capabilities widgets ask for through `widget.clipboard`, `widget.screen.capture()`
// and `widget.paths.named()`. Kept here next to the other hand-declared Win32 calls.

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(hwnd: HWND) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GetClipboardData(format: u32) -> HANDLE;
    fn SetClipboardData(format: u32, mem: HANDLE) -> HANDLE;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn BitBlt(dest: isize, x: i32, y: i32, w: i32, h: i32, src: isize, sx: i32, sy: i32, rop: u32)
        -> i32;
}

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 0x0002;
const SRCCOPY: u32 = 0x00CC_0020;
const SM_XVIRTUALSCREEN: i32 = 76;
const SM_YVIRTUALSCREEN: i32 = 77;
const SM_CXVIRTUALSCREEN: i32 = 78;
const SM_CYVIRTUALSCREEN: i32 = 79;

/// A NUL-terminated wide string, as Win32 hands them out.
unsafe fn read_wide(p: *const u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut n = 0usize;
    while *p.add(n) != 0 {
        n += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
}

/// The clipboard's text, or `None` when it is empty or holds something else than text.
pub fn clipboard_text() -> Option<String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            return None;
        }
        // Another process can hold the clipboard for a few hundred milliseconds; retry briefly
        // instead of reporting "no text" on a clipboard that does have text.
        for _ in 0..10 {
            if OpenClipboard(0) != 0 {
                let handle = GetClipboardData(CF_UNICODETEXT);
                let text = if handle == 0 {
                    None
                } else {
                    let p = GlobalLock(handle) as *const u16;
                    let text = if p.is_null() {
                        None
                    } else {
                        Some(read_wide(p))
                    };
                    GlobalUnlock(handle);
                    text
                };
                CloseClipboard();
                return text;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        None
    }
}

/// Replaces the clipboard with `text`. Returns false when Windows refused the clipboard.
pub fn set_clipboard_text(text: &str) -> bool {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if mem == 0 {
            return false;
        }
        let p = GlobalLock(mem) as *mut u16;
        if p.is_null() {
            GlobalFree(mem);
            return false;
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
        GlobalUnlock(mem);
        for _ in 0..10 {
            if OpenClipboard(0) != 0 {
                EmptyClipboard();
                let ok = SetClipboardData(CF_UNICODETEXT, mem) != 0;
                CloseClipboard();
                if ok {
                    return true;
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        // On success the clipboard owns the block; only free it when the handover failed.
        GlobalFree(mem);
        false
    }
}

/// The whole virtual desktop as PNG bytes. `None` when GDI refused.
pub fn capture_screen_png() -> Option<Vec<u8>> {
    unsafe {
        let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
        let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
        if w <= 0 || h <= 0 {
            return None;
        }
        let screen = GetDC(0);
        if screen == 0 {
            return None;
        }
        let dc = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        if dc == 0 || bitmap == 0 {
            if bitmap != 0 {
                DeleteObject(bitmap);
            }
            if dc != 0 {
                DeleteDC(dc);
            }
            ReleaseDC(0, screen);
            return None;
        }
        let old = SelectObject(dc, bitmap);
        let copied = BitBlt(dc, 0, 0, w, h, screen, x, y, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                ..Default::default()
            },
            bmiColors: [0; 3],
        };
        let mut bits = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            h as u32,
            bits.as_mut_ptr() as *mut c_void,
            &mut info,
            0,
        );
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        ReleaseDC(0, screen);
        if copied == 0 || lines == 0 {
            return None;
        }
        for px in bits.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        crate::core::img::encode_png(w as u32, h as u32, &bits).ok()
    }
}

const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> GUID {
    GUID {
        data1,
        data2,
        data3,
        data4,
    }
}

const FOLDERID_PROFILE: GUID = guid(
    0x5E6C_858F,
    0x0E22,
    0x4760,
    [0x9A, 0xFE, 0xEA, 0x33, 0x17, 0xB6, 0x71, 0x73],
);
const FOLDERID_DESKTOP: GUID = guid(
    0xB4BF_CC3A,
    0xDB2C,
    0x424C,
    [0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41],
);
const FOLDERID_DOCUMENTS: GUID = guid(
    0xFDD3_9AD0,
    0x238F,
    0x46AF,
    [0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7],
);
const FOLDERID_DOWNLOADS: GUID = guid(
    0x374D_E290,
    0x123F,
    0x4565,
    [0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B],
);
const FOLDERID_MUSIC: GUID = guid(
    0x4BD8_D571,
    0x6D19,
    0x48D3,
    [0xBE, 0x97, 0x42, 0x22, 0x20, 0x08, 0x0E, 0x43],
);
const FOLDERID_PICTURES: GUID = guid(
    0x33E2_8130,
    0x4E1E,
    0x4676,
    [0x83, 0x5A, 0x98, 0x39, 0x5C, 0x3B, 0xC3, 0xBB],
);
const FOLDERID_VIDEOS: GUID = guid(
    0x1898_9B1D,
    0x99B5,
    0x455B,
    [0x84, 0x1C, 0xAB, 0x7C, 0x74, 0xE4, 0xDD, 0xFC],
);

fn shell_known_folder(id: &GUID) -> Option<String> {
    unsafe {
        let mut path: *mut u16 = std::ptr::null_mut();
        let hr = SHGetKnownFolderPath(id, 0, 0, &mut path);
        if hr < 0 || path.is_null() {
            return None;
        }
        let text = read_wide(path);
        CoTaskMemFree(path as *mut c_void);
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

/// One of uTools' `getPath` names: home, desktop, documents, downloads, music, pictures, videos.
/// Resolved through Windows' own shell folders, so OneDrive-redirected folders come out right.
/// `temp` and `appData` are the process' own directories rather than shell folders.
pub fn known_folder_path(name: &str) -> Option<String> {
    let id = match name {
        "home" => FOLDERID_PROFILE,
        "desktop" => FOLDERID_DESKTOP,
        "documents" => FOLDERID_DOCUMENTS,
        "downloads" => FOLDERID_DOWNLOADS,
        "music" => FOLDERID_MUSIC,
        "pictures" => FOLDERID_PICTURES,
        "videos" => FOLDERID_VIDEOS,
        "temp" => {
            return Some(std::env::temp_dir().to_string_lossy().to_string());
        }
        "appData" => {
            return std::env::var("LOCALAPPDATA").ok().filter(|s| !s.is_empty());
        }
        _ => return None,
    };
    shell_known_folder(&id)
}

/// Classic base64 for the few data URLs we build (icons, covers).
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as u32;
        let b = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let c = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (a << 16) | (b << 8) | c;
        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

// ── clipboard pictures and files ────────────────────────────────────────────
// Windows keeps a picture as a DIB and a set of paths as CF_HDROP; both are handed over as one
// moveable block, which is why they are built and parsed by hand here.

const CF_DIB_FORMAT: u32 = 8;
const CF_HDROP_FORMAT: u32 = 15;

#[link(name = "shell32")]
extern "system" {
    fn DragQueryFileW(drop: HANDLE, index: u32, file: *mut u16, size: u32) -> u32;
}

/// The clipboard's picture, re-encoded as PNG. Only 24/32-bit uncompressed DIBs are read: that is
/// what Explorer, browsers and every screenshot tool put there.
pub fn clipboard_png() -> Option<Vec<u8>> {
    unsafe {
        if IsClipboardFormatAvailable(CF_DIB_FORMAT) == 0 {
            return None;
        }
        for _ in 0..10 {
            if OpenClipboard(0) == 0 {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            let handle = GetClipboardData(CF_DIB_FORMAT);
            if handle == 0 {
                CloseClipboard();
                return None;
            }
            let base = GlobalLock(handle) as *const u8;
            let result = if base.is_null() {
                None
            } else {
                dib_to_png(base)
            };
            GlobalUnlock(handle);
            CloseClipboard();
            return result;
        }
        None
    }
}

unsafe fn dib_to_png(base: *const u8) -> Option<Vec<u8>> {
    let header = std::slice::from_raw_parts(base, 40);
    let header_size = u32::from_le_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let width = i32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    let height = i32::from_le_bytes([header[8], header[9], header[10], header[11]]);
    let bits = u16::from_le_bytes([header[14], header[15]]);
    let compression = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    if width <= 0 || height == 0 || compression != 0 || (bits != 24 && bits != 32) {
        return None;
    }
    let w = width as usize;
    let h = height.unsigned_abs() as usize;
    let stride = (w * (bits as usize) / 8 + 3) & !3;
    let pixels = base.add(header_size);
    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        // A positive height means bottom-up, which is the usual case.
        let src_row = if height > 0 { h - 1 - y } else { y };
        let row = pixels.add(src_row * stride);
        for x in 0..w {
            let px = row.add(x * (bits as usize) / 8);
            let (b, g, r) = (*px, *px.add(1), *px.add(2));
            let a = if bits == 32 { *px.add(3) } else { 255 };
            let out = &mut rgba[(y * w + x) * 4..(y * w + x) * 4 + 4];
            out[0] = r;
            out[1] = g;
            out[2] = b;
            out[3] = a;
        }
    }
    crate::core::img::encode_png(w as u32, h as u32, &rgba).ok()
}

/// Puts a PNG/JPEG on the clipboard as a 32-bit DIB, which is what every Windows app reads.
pub fn set_clipboard_png(bytes: &[u8]) -> bool {
    let Ok(image) = ::image::load_from_memory(bytes) else {
        return false;
    };
    let rgba = image.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let pixels = w * h * 4;
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, 40 + pixels);
        if mem == 0 {
            return false;
        }
        let base = GlobalLock(mem) as *mut u8;
        if base.is_null() {
            GlobalFree(mem);
            return false;
        }
        let header = std::slice::from_raw_parts_mut(base, 40);
        header[0..4].copy_from_slice(&40u32.to_le_bytes());
        header[4..8].copy_from_slice(&(w as i32).to_le_bytes());
        // Negative height: top-down rows, so no flipping is needed.
        header[8..12].copy_from_slice(&(-(h as i32)).to_le_bytes());
        header[12..14].copy_from_slice(&1u16.to_le_bytes());
        header[14..16].copy_from_slice(&32u16.to_le_bytes());
        header[16..20].copy_from_slice(&0u32.to_le_bytes());
        header[20..24].copy_from_slice(&(pixels as u32).to_le_bytes());
        let data = base.add(40);
        for (i, px) in rgba.pixels().enumerate() {
            let out = data.add(i * 4);
            *out = px.0[2];
            *out.add(1) = px.0[1];
            *out.add(2) = px.0[0];
            *out.add(3) = px.0[3];
        }
        GlobalUnlock(mem);
        let mut ok = false;
        for _ in 0..10 {
            if OpenClipboard(0) != 0 {
                EmptyClipboard();
                ok = SetClipboardData(CF_DIB_FORMAT, mem) != 0;
                CloseClipboard();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !ok {
            GlobalFree(mem);
        }
        ok
    }
}

/// The paths currently on the clipboard, empty when it holds no files.
pub fn clipboard_files() -> Vec<String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP_FORMAT) == 0 {
            return Vec::new();
        }
        for _ in 0..10 {
            if OpenClipboard(0) == 0 {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            let handle = GetClipboardData(CF_HDROP_FORMAT);
            let mut out = Vec::new();
            if handle != 0 {
                let count = DragQueryFileW(handle, u32::MAX, std::ptr::null_mut(), 0);
                for index in 0..count {
                    let len = DragQueryFileW(handle, index, std::ptr::null_mut(), 0);
                    let mut buf = vec![0u16; len as usize + 1];
                    if DragQueryFileW(handle, index, buf.as_mut_ptr(), len + 1) > 0 {
                        let text = String::from_utf16_lossy(&buf[..len as usize]);
                        out.push(text);
                    }
                }
            }
            CloseClipboard();
            return out;
        }
        Vec::new()
    }
}

/// Replaces the clipboard with a set of paths (uTools' copyFile: paths only, not the contents).
pub fn set_clipboard_files(paths: &[String]) -> bool {
    if paths.is_empty() {
        return false;
    }
    // DROPFILES (20 bytes) + UTF-16 paths, each NUL terminated, then one more NUL for the list.
    let list_bytes = 2 + paths.iter().map(|p| p.encode_utf16().count() + 1).sum::<usize>() * 2;
    let total = 20 + list_bytes;
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, total);
        if mem == 0 {
            return false;
        }
        let base = GlobalLock(mem) as *mut u8;
        if base.is_null() {
            GlobalFree(mem);
            return false;
        }
        std::ptr::write_bytes(base, 0, total);
        let header = std::slice::from_raw_parts_mut(base, 20);
        header[0..4].copy_from_slice(&20u32.to_le_bytes());
        header[16..20].copy_from_slice(&1i32.to_le_bytes());
        let mut cursor = base.add(20) as *mut u16;
        for path in paths {
            for unit in path.encode_utf16() {
                *cursor = unit;
                cursor = cursor.add(1);
            }
            *cursor = 0;
            cursor = cursor.add(1);
        }
        GlobalUnlock(mem);
        let mut ok = false;
        for _ in 0..10 {
            if OpenClipboard(0) != 0 {
                EmptyClipboard();
                ok = SetClipboardData(CF_HDROP_FORMAT, mem) != 0;
                CloseClipboard();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !ok {
            GlobalFree(mem);
        }
        ok
    }
}

// ── per-monitor DPI, screen regions, one pixel ──────────────────────────────

#[link(name = "shcore")]
extern "system" {
    fn GetDpiForMonitor(monitor: isize, kind: i32, x: *mut u32, y: *mut u32) -> i32;
}

/// The effective scale of the display a rectangle sits on: 1.0 for 96 DPI, 1.5 for 144.
pub fn monitor_dpi(rect: &RECT) -> f64 {
    let monitor = unsafe { MonitorFromRect(rect, 2) };
    let (mut x, mut y) = (0u32, 0u32);
    // MDT_EFFECTIVE_DPI = 0: what Windows actually renders the desktop at.
    let ok = unsafe { GetDpiForMonitor(monitor, 0, &mut x, &mut y) };
    if ok == 0 && x > 0 {
        f64::from(x) / 96.0
    } else {
        1.0
    }
}

/// A rectangle of the desktop as PNG, for screen.captureDisplay.
pub fn capture_rect_png(rect: &RECT) -> Option<Vec<u8>> {
    let (x, y) = (rect.left, rect.top);
    let (w, h) = (rect.width(), rect.height());
    if w <= 0 || h <= 0 {
        return None;
    }
    unsafe {
        let screen = GetDC(0);
        if screen == 0 {
            return None;
        }
        let dc = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        if dc == 0 || bitmap == 0 {
            if bitmap != 0 {
                DeleteObject(bitmap);
            }
            if dc != 0 {
                DeleteDC(dc);
            }
            ReleaseDC(0, screen);
            return None;
        }
        let old = SelectObject(dc, bitmap);
        let copied = BitBlt(dc, 0, 0, w, h, screen, x, y, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                ..Default::default()
            },
            bmiColors: [0; 3],
        };
        let mut bits = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            h as u32,
            bits.as_mut_ptr() as *mut c_void,
            &mut info,
            0,
        );
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        ReleaseDC(0, screen);
        if copied == 0 || lines == 0 {
            return None;
        }
        for px in bits.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        crate::core::img::encode_png(w as u32, h as u32, &bits).ok()
    }
}

/// #RRGGBB of a screen pixel, or None when GDI cannot read the desktop (a locked session, say).
pub fn pixel_hex(x: i32, y: i32) -> Option<String> {
    unsafe {
        let dc = GetDC(0);
        if dc == 0 {
            return None;
        }
        let color = GetPixel(dc, x, y);
        ReleaseDC(0, dc);
        if color == u32::MAX {
            return None;
        }
        Some(format!(
            "#{:02X}{:02X}{:02X}",
            color & 0xFF,
            (color >> 8) & 0xFF,
            (color >> 16) & 0xFF
        ))
    }
}

#[link(name = "gdi32")]
extern "system" {
    fn GetPixel(dc: isize, x: i32, y: i32) -> u32;
}

// ── simulated keyboard and mouse (utools.simulate*) ─────────────────────────

#[link(name = "user32")]
extern "system" {
    fn keybd_event(key: u8, scan: u8, flags: u32, extra: usize);
    fn mouse_event(flags: u32, dx: i32, dy: i32, data: u32, extra: usize);
}

#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentThreadId() -> u32;
}

const KEYEVENTF_KEYUP: u32 = 0x0002;
const KEYEVENTF_UNICODE: u32 = 0x0004;
const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;

/// Virtual-key code for a key name, as uTools spells them (nter, 5, , ,).
fn vk_of(name: &str) -> Option<u8> {
    let lower = name.to_lowercase();
    let named = match lower.as_str() {
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "space" => 0x20,
        "esc" | "escape" => 0x1B,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "insert" | "ins" => 0x2D,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "pgup" => 0x21,
        "pagedown" | "pgdn" => 0x22,
        "capslock" => 0x14,
        "shift" => 0x10,
        "ctrl" | "control" => 0x11,
        "alt" => 0x12,
        "command" | "cmd" | "win" | "meta" => 0x5B,
        "printscreen" => 0x2C,
        "pause" => 0x13,
        "apps" | "contextmenu" => 0x5D,
        "" => return None,
        other => {
            if let Some(rest) = other.strip_prefix('f') {
                if let Ok(n) = rest.parse::<u8>() {
                    if (1..=24).contains(&n) {
                        return Some(0x70 + n - 1);
                    }
                }
            }
            let bytes = other.as_bytes();
            if bytes.len() == 1 {
                let ch = bytes[0];
                return match ch {
                    b'a'..=b'z' => Some(ch.to_ascii_uppercase()),
                    b'0'..=b'9' => Some(ch),
                    b',' => Some(0xBC),
                    b'.' => Some(0xBE),
                    b'/' => Some(0xBF),
                    b';' => Some(0xBA),
                    b':' => Some(0xBA),
                    b'-' => Some(0xBD),
                    b'=' => Some(0xBB),
                    b'[' => Some(0xDB),
                    b']' => Some(0xDD),
                    b'\\' => Some(0xDC),
                    _ => return None,
                };
            }
            return None;
        }
    };
    Some(named)
}

fn modifier_vk(name: &str) -> Option<u8> {
    match name.to_lowercase().as_str() {
        "shift" => Some(0x10),
        "ctrl" | "control" => Some(0x11),
        "alt" => Some(0x12),
        "command" | "cmd" | "win" | "meta" => Some(0x5B),
        _ => None,
    }
}

/// One key with optional modifiers held down, like uTools' simulateKeyboardTap(key, ...mods).
pub fn key_tap(key: &str, modifiers: &[String]) -> Result<(), String> {
    let vk = vk_of(key).ok_or_else(|| format!("unknown key '{key}'"))?;
    let mods: Vec<u8> = modifiers.iter().filter_map(|m| modifier_vk(m)).collect();
    unsafe {
        for m in &mods {
            keybd_event(*m, 0, 0, 0);
        }
        keybd_event(vk, 0, 0, 0);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        for m in mods.iter().rev() {
            keybd_event(*m, 0, KEYEVENTF_KEYUP, 0);
        }
    }
    Ok(())
}

/// A chord such as Ctrl+V, used by the paste APIs.
pub fn key_combo(vk: u8, ctrl: bool, shift: bool, alt: bool) {
    let mut mods = Vec::new();
    if ctrl {
        mods.push(0x11u8);
    }
    if shift {
        mods.push(0x10);
    }
    if alt {
        mods.push(0x12);
    }
    unsafe {
        for m in &mods {
            keybd_event(*m, 0, 0, 0);
        }
        keybd_event(vk, 0, 0, 0);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        for m in mods.iter().rev() {
            keybd_event(*m, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

/// Types text with KEYEVENTF_UNICODE, so any character works without an IME.
pub fn type_unicode(text: &str) {
    unsafe {
        for unit in text.encode_utf16() {
            keybd_event(0, unit as u8, KEYEVENTF_UNICODE, 0);
            keybd_event(0, unit as u8, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0);
        }
    }
}

/// The foreground window, if it belongs to another program. A card holding the focus is exactly
/// what must not be remembered as "where the user was".
pub fn foreign_foreground() -> HWND {
    let hwnd = foreground_window();
    if hwnd == 0 {
        return 0;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == std::process::id() {
        return 0;
    }
    hwnd
}

/// Whether `hwnd` can still take the keyboard back: alive, visible, not minimized, not ours.
pub fn can_take_focus(hwnd: HWND) -> bool {
    if hwnd == 0 || unsafe { IsWindow(hwnd) } == 0 || unsafe { IsWindowVisible(hwnd) } == 0 {
        return false;
    }
    if unsafe { IsIconic(hwnd) } != 0 {
        return false;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid != std::process::id()
}

/// `SetForegroundWindow` with the thread-input dance: Windows refuses a plain call from a process
/// that is not already in front, and a card that has just hidden itself is exactly that case.
pub fn force_foreground(hwnd: HWND) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        let fg = GetForegroundWindow();
        if fg == hwnd {
            return;
        }
        let mut fg_pid: u32 = 0;
        let fg_thread = if fg != 0 {
            GetWindowThreadProcessId(fg, &mut fg_pid)
        } else {
            0
        };
        let this = GetCurrentThreadId();
        if fg_thread != 0 && fg_thread != this {
            AttachThreadInput(fg_thread, this, 1);
            SetForegroundWindow(hwnd);
            AttachThreadInput(fg_thread, this, 0);
        } else {
            SetForegroundWindow(hwnd);
        }
    }
}

/// Gives the foreground back to the window behind `hwnd`, skipping our own windows.
///
/// Hiding a card so it can paste into the app underneath must land on another process: the plain
/// "next in z-order" window is often the control center or an invisible helper, and the keystroke
/// then goes nowhere.
pub fn activate_behind(hwnd: HWND) {
    let own = std::process::id();
    let mut next = unsafe { GetWindow(hwnd, GW_HWNDNEXT) };
    while next != 0 {
        let visible = unsafe { IsWindowVisible(next) } != 0;
        let iconic = unsafe { IsIconic(next) } != 0;
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(next, &mut pid) };
        let class = class_name(next);
        let shell = matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        );
        if visible && !iconic && pid != own && !shell {
            force_foreground(next);
            return;
        }
        next = unsafe { GetWindow(next, GW_HWNDNEXT) };
    }
}

pub fn mouse_move((x, y): (i32, i32)) {
    set_cursor_pos(x, y);
}

/// utton 1 = left, 2 = right; clicks 2 makes a double click with the usual interval.
pub fn mouse_button(button: u8, clicks: u32) {
    let (down, up) = if button == 2 {
        (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
    } else {
        (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    };
    for i in 0..clicks.max(1) {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
        unsafe {
            mouse_event(down, 0, 0, 0, 0);
            mouse_event(up, 0, 0, 0, 0);
        }
    }
}

/// Base64 back to bytes, for the data URLs a page sends (copyImage, postAttachment).
pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let clean: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3 + 3);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for ch in clean.chars() {
        let value = match ch {
            'A'..='Z' => ch as u32 - 'A' as u32,
            'a'..='z' => ch as u32 - 'a' as u32 + 26,
            '0'..='9' => ch as u32 - '0' as u32 + 52,
            '+' => 62,
            '/' | '-' | '_' => 63,
            _ => return None,
        };
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}