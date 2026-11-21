#![allow(unused_imports)]

//! Tests for the rectangle a custom window takes when its grip is double-clicked.
//!
//! The window is never handed to `WS_MAXIMIZE`: a frameless, self-drawn window keeps its rounded
//! corners and its clipped region only as long as nothing rewrites its style, so the rectangle is
//! computed here instead. What can go wrong is arithmetic — a capped window hanging off the left
//! edge, or a `minWidth` silently stripped because the work area is smaller than it.

use winwidget::platform::win32::RECT;
use winwidget::runtime::window_category::maximize_rect;

fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
    RECT {
        left,
        top,
        right,
        bottom,
    }
}

/// `(left, top, width, height)` — the corner a window ends up at plus the size it takes.
fn boxed(r: RECT) -> (i32, i32, i32, i32) {
    (r.left, r.top, r.right - r.left, r.bottom - r.top)
}

#[test]
fn a_window_without_limits_fills_the_work_area() {
    let work = rect(0, 0, 1920, 1040);
    assert_eq!(
        boxed(maximize_rect(work, None, None, 1.0)),
        (0, 0, 1920, 1040)
    );
}

#[test]
fn a_capped_window_is_centred_not_dragged_to_the_corner() {
    let work = rect(0, 0, 1920, 1040);
    let out = maximize_rect(work, None, Some((1200.0, 800.0)), 1.0);
    assert_eq!(boxed(out), (360, 120, 1200, 800));
}

#[test]
fn a_floor_wins_even_when_the_work_area_is_smaller() {
    let work = rect(0, 0, 300, 200);
    let out = maximize_rect(work, Some((400.0, 300.0)), None, 1.0);
    assert_eq!(boxed(out), (-50, -50, 400, 300));
}

#[test]
fn limits_are_dip_and_get_scaled() {
    let work = rect(0, 0, 3840, 2080);
    let out = maximize_rect(work, None, Some((1200.0, 800.0)), 2.0);
    assert_eq!(boxed(out), (720, 240, 2400, 1600));
}

#[test]
fn a_cap_below_the_floor_keeps_the_floor() {
    // maxWidth 比 minWidth 还小时，先夹一遍再抬一遍：窗口不该缩成负尺寸。
    let work = rect(0, 0, 1920, 1040);
    let out = maximize_rect(work, Some((500.0, 400.0)), Some((200.0, 100.0)), 1.0);
    assert_eq!(boxed(out), (710, 320, 500, 400));
}
