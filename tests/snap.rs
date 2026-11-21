#![allow(unused_imports)]

//! Tests for `src/runtime/snap.rs`.
//!
//! Moved here so `src/` holds code only: these exercise the module from the outside,
//! through whatever the crate makes public. The parent module's imports come along so
//! `json!`, `Path` and friends still resolve; unused ones are allowed here.

use winwidget::platform::win32::RECT;
use winwidget::runtime::snap::*;

fn rect(l: i32, t: i32, w: i32, h: i32) -> RECT {
    RECT {
        left: l,
        top: t,
        right: l + w,
        bottom: t + h,
    }
}

#[test]
fn a_card_near_the_screen_edge_snaps_one_gap_in() {
    let work = rect(0, 0, 1920, 1040);
    let (card, guides) = snap(
        rect(5, 400, 300, 150),
        work,
        &[],
        12,
        8,
        Edges::NONE,
        (0, 0),
        (0, 0),
    );
    assert_eq!(card.left, 12, "one whole gap from the edge");
    assert!(guides.iter().any(|g| g.vertical && g.at == 6));
    // the guide spans the whole screen when it snapped to the screen
    let v = guides.iter().find(|g| g.vertical).unwrap();
    assert_eq!((v.from, v.to), (0, 1040));
}

#[test]
fn a_centre_lines_up_with_the_screen_centre() {
    let work = rect(0, 0, 1920, 1040);
    let (card, _) = snap(
        rect(810, 400, 300, 150),
        work,
        &[],
        12,
        8,
        Edges::NONE,
        (0, 0),
        (0, 0),
    );
    assert_eq!(card.left + card.width() / 2, 960);
}

#[test]
fn two_cards_side_by_side_keep_one_gap() {
    let work = rect(0, 0, 1920, 1040);
    let peer = rect(300, 100, 300, 150);
    let (card, guides) = snap(
        rect(600 + 4, 103, 300, 150),
        work,
        &[peer],
        12,
        8,
        Edges::NONE,
        (0, 0),
        (0, 0),
    );
    assert_eq!(card.left, 612, "the neighbour's edge plus the whole gap");
    assert_eq!(card.top, 100, "tops line up");
    assert_eq!(guides.len(), 2, "one line per axis");
}

#[test]
fn ctrl_free_placement_is_not_snapped_far_away() {
    let work = rect(0, 0, 1920, 1040);
    let (card, guides) = snap(
        rect(700, 400, 300, 150),
        work,
        &[],
        12,
        8,
        Edges::NONE,
        (0, 0),
        (0, 0),
    );
    assert_eq!((card.left, card.top), (700, 400));
    assert!(guides.is_empty());
}
