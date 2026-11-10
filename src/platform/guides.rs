//! The dashed alignment lines shown while a card is dragged: one per axis, telling the user what
//! the card lined up with. Each line is its own small top-most window painted with
//! `UpdateLayeredWindow`, so it never takes the focus and clicks pass straight through it.

use crate::platform::win32 as w;
use crate::runtime::snap::Guide;
use std::ffi::c_void;
use std::sync::Mutex;

/// One line window: a layered surface holding a dashed strip, re-drawn when it has to change.
struct Line {
    hwnd: w::HWND,
    vertical: bool,
    /// Surface size in pixels (the line's bounding box).
    len: i32,
    thick: i32,
    dc: isize,
    bitmap: isize,
    previous: isize,
    bits: *mut u32,
    shown: bool,
    ink: u32,
    dash: i32,
    space: i32,
}

// The raw pointers only refer to a DIB section this module owns and never hands out.
unsafe impl Send for Line {}

impl Line {
    fn new(vertical: bool) -> Option<Line> {
        let ex =
            (w::WS_EX_LAYERED | w::WS_EX_TRANSPARENT | w::WS_EX_NOACTIVATE | w::WS_EX_TOOLWINDOW)
                as u32;
        let hwnd = unsafe {
            w::CreateWindowExW(
                ex,
                w::wide("Static").as_ptr(),
                w::wide("").as_ptr(),
                0, // style, see below
                0,
                0,
                1,
                1,
                0,
                0,
                0,
                std::ptr::null_mut(),
            )
        };
        if hwnd == 0 {
            crate::core::logging::warn("Alignment guide: could not create its window");
            return None;
        }
        // A popup with no frame: only the pixels handed to UpdateLayeredWindow ever show.
        unsafe {
            let style = w::GetWindowLongPtrW(hwnd, w::GWL_STYLE);
            w::SetWindowLongPtrW(hwnd, w::GWL_STYLE, style | w::WS_POPUP);
        }
        Some(Line {
            hwnd,
            vertical,
            len: 0,
            thick: 1,
            dc: 0,
            bitmap: 0,
            previous: 0,
            bits: std::ptr::null_mut(),
            shown: false,
            ink: 0,
            dash: 5,
            space: 4,
        })
    }

    /// Grows the surface when the line gets longer; the DIB is reused between frames.
    fn reserve(&mut self, len: i32, thick: i32) -> bool {
        if self.bitmap != 0 && len <= self.len && thick == self.thick {
            return true;
        }
        let (width, height) = if self.vertical {
            (thick, len)
        } else {
            (len, thick)
        };
        unsafe {
            if self.bitmap != 0 {
                w::SelectObject(self.dc, self.previous);
                w::DeleteObject(self.bitmap);
                self.bitmap = 0;
            }
            if self.dc == 0 {
                self.dc = w::CreateCompatibleDC(0);
                if self.dc == 0 {
                    return false;
                }
            }
            let mut info = w::BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of::<w::BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width.max(1);
            info.bmiHeader.biHeight = -height.max(1); // top-down rows
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = w::BI_RGB;
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = w::CreateDIBSection(self.dc, &info, w::DIB_RGB_COLORS, &mut bits, 0, 0);
            if bitmap == 0 || bits.is_null() {
                return false;
            }
            self.previous = w::SelectObject(self.dc, bitmap);
            self.bitmap = bitmap;
            self.bits = bits as *mut u32;
            self.len = len;
            self.thick = thick;
        }
        true
    }

    /// Paints the dashes and pushes the surface to the screen at `at` along its axis.
    #[allow(clippy::too_many_arguments)]
    fn draw(&mut self, at: i32, from: i32, to: i32, ink: u32, thick: i32, dash: i32, space: i32) {
        let len = (to - from).max(1);
        let thick = thick.max(1);
        if !self.reserve(len, thick) {
            return;
        }
        let (width, height) = if self.vertical {
            (thick, len)
        } else {
            (len, thick)
        };
        let period = (dash + space).max(1);
        unsafe {
            let count = (width as usize) * (height as usize);
            let pixels = std::slice::from_raw_parts_mut(self.bits, count);
            let argb = 0xFF00_0000 | ink;
            for y in 0..height as usize {
                for x in 0..width as usize {
                    let along = if self.vertical { y } else { x } as i32;
                    let on = (along % period) < dash;
                    pixels[y * width as usize + x] = if on { argb } else { 0 };
                }
            }

            let position = if self.vertical {
                w::POINT {
                    x: at - thick / 2,
                    y: from,
                }
            } else {
                w::POINT {
                    x: from,
                    y: at - thick / 2,
                }
            };
            let size = w::SIZE {
                cx: width,
                cy: height,
            };
            let src = w::POINT::default();
            let blend = w::BLENDFUNCTION {
                BlendOp: 0, // AC_SRC_OVER
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: 1, // AC_SRC_ALPHA
            };
            let screen = w::GetDC(0);
            w::UpdateLayeredWindow(
                self.hwnd,
                screen,
                &position,
                &size,
                self.dc,
                &src,
                0,
                &blend,
                w::ULW_ALPHA,
            );
            w::ReleaseDC(0, screen);
            if !self.shown {
                w::ShowWindow(self.hwnd, w::SW_SHOWNOACTIVATE);
                self.shown = true;
            }
            w::SetWindowPos(
                self.hwnd,
                w::HWND_TOPMOST,
                position.x,
                position.y,
                size.cx,
                size.cy,
                w::SWP_NOACTIVATE | w::SWP_SHOWWINDOW,
            );
        }
        self.ink = ink;
        self.dash = dash;
        self.space = space;
    }

    fn hide(&mut self) {
        if self.shown {
            self.shown = false;
            unsafe {
                w::ShowWindow(self.hwnd, w::SW_HIDE);
            }
        }
    }
}

struct Guides {
    vertical: Option<Line>,
    horizontal: Option<Line>,
}

static GUIDES: Mutex<Option<Guides>> = Mutex::new(None);

/// Creates the two line windows up front, on the thread that owns the cards, so that any thread
/// can later push pixels to them without creating windows off the message loop.
pub fn init() {
    let mut slot = GUIDES.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_some() {
        return;
    }
    *slot = Some(Guides {
        vertical: Line::new(true),
        horizontal: Line::new(false),
    });
}

/// Shows the guides (at most one per axis); `ink` is a 0xRRGGBB colour.
pub fn show(guides: &[Guide], ink: u32, thickness: i32, dash: i32, space: i32) {
    let mut slot = GUIDES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(state) = slot.as_mut() else { return };
    for vertical in [true, false] {
        let guide = guides.iter().find(|g| g.vertical == vertical);
        let line = if vertical {
            &mut state.vertical
        } else {
            &mut state.horizontal
        };
        match (guide, line) {
            (Some(g), Some(l)) => l.draw(
                g.at,
                g.from,
                g.to,
                ink,
                thickness,
                dash.max(1),
                space.max(1),
            ),
            (None, Some(l)) => l.hide(),
            _ => {}
        }
    }
}

pub fn hide() {
    let mut slot = GUIDES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(state) = slot.as_mut() {
        if let Some(l) = state.vertical.as_mut() {
            l.hide();
        }
        if let Some(l) = state.horizontal.as_mut() {
            l.hide();
        }
    }
}
