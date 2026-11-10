//! Where a dragged card lands: within a few pixels it snaps to the nearest line — the screen's
//! edges and centre, the other cards' edges and centres — one line per axis, and a guide shows
//! what it lined up with. This is the same rule FullWidget used, ported from `SnapLayout.cs`.
//!
//! Every card keeps half the gap around it, so two cards dropped side by side end up one gap
//! apart and sit one gap from the screen edge, while edges and centres still line up exactly.

use crate::platform::win32::RECT;

/// A dashed line, in physical pixels: a vertical line sits at x = `at` and runs from `from` to `to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Guide {
    pub vertical: bool,
    pub at: i32,
    pub from: i32,
    pub to: i32,
}

/// The edges being dragged while resizing; none means the whole card is moving.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Edges(u8);

impl Edges {
    pub const NONE: Edges = Edges(0);
    pub const LEFT: Edges = Edges(1);
    pub const TOP: Edges = Edges(2);
    pub const RIGHT: Edges = Edges(4);
    pub const BOTTOM: Edges = Edges(8);

    #[must_use]
    pub fn has(self, edge: Edges) -> bool {
        self.0 & edge.0 != 0
    }

    #[must_use]
    pub fn any(self) -> bool {
        self.0 != 0
    }
}

/// One axis of a rectangle.
#[derive(Clone, Copy)]
struct Span {
    lo: i32,
    hi: i32,
}

impl Span {
    fn of_x(r: RECT) -> Span {
        Span { lo: r.left, hi: r.right }
    }
    fn of_y(r: RECT) -> Span {
        Span { lo: r.top, hi: r.bottom }
    }
    fn mid(self) -> i32 {
        (self.lo + self.hi) / 2
    }
    fn size(self) -> i32 {
        self.hi - self.lo
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Part {
    Start,
    Middle,
    End,
}

#[derive(Clone, Copy, Debug)]
struct Hit {
    part: Part,
    shift: i32,
    line: i32,
    screen: bool,
}

impl Hit {
    fn better_than(self, other: Hit) -> bool {
        let (da, db) = (self.shift.abs(), other.shift.abs());
        if da != db {
            return da < db;
        }
        if self.screen != other.screen {
            return self.screen;
        }
        if self.line != other.line {
            return self.line < other.line;
        }
        self.part < other.part
    }
}

/// Snaps a card being moved or resized and returns the guides to draw.
/// `card`, `work` and `peers` are physical pixels; `min`/`max` limit the card while resizing.
pub fn snap(
    card: RECT,
    work: RECT,
    peers: &[RECT],
    gap: i32,
    reach: i32,
    resizing: Edges,
    min: (i32, i32),
    max: (i32, i32),
) -> (RECT, Vec<Guide>) {
    let half = gap / 2;
    let moving = !resizing.any();
    let mut guides = Vec::new();

    let peer_x: Vec<Span> = peers.iter().map(|p| Span::of_x(*p)).collect();
    let peer_y: Vec<Span> = peers.iter().map(|p| Span::of_y(*p)).collect();

    let x = nearest(
        Span::of_x(card),
        Span::of_x(work),
        &peer_x,
        half,
        reach,
        moving,
        resizing.has(Edges::LEFT),
        resizing.has(Edges::RIGHT),
        min.0,
        max.0,
    );
    let y = nearest(
        Span::of_y(card),
        Span::of_y(work),
        &peer_y,
        half,
        reach,
        moving,
        resizing.has(Edges::TOP),
        resizing.has(Edges::BOTTOM),
        min.1,
        max.1,
    );

    let (mut left, mut right, mut top, mut bottom) = (card.left, card.right, card.top, card.bottom);
    if let Some(hit) = x {
        apply(&mut left, &mut right, hit, moving);
    }
    if let Some(hit) = y {
        apply(&mut top, &mut bottom, hit, moving);
    }
    let result = RECT {
        left,
        top,
        right,
        bottom,
    };

    if let Some(hit) = x {
        let (from, to) = extent(hit, Span::of_y(result), Span::of_y(work), peers, false, half);
        guides.push(Guide {
            vertical: true,
            at: hit.line,
            from,
            to,
        });
    }
    if let Some(hit) = y {
        let (from, to) = extent(hit, Span::of_x(result), Span::of_x(work), peers, true, half);
        guides.push(Guide {
            vertical: false,
            at: hit.line,
            from,
            to,
        });
    }
    (result, guides)
}

/// Each guide runs across the card and everything it lined up with.
fn extent(hit: Hit, card: Span, work: Span, peers: &[RECT], across_x: bool, half: i32) -> (i32, i32) {
    if hit.screen {
        return (work.lo, work.hi);
    }
    let mut from = card.lo - half;
    let mut to = card.hi + half;
    for peer in peers {
        let along = if across_x {
            Span::of_y(*peer)
        } else {
            Span::of_x(*peer)
        };
        let on = match hit.part {
            Part::Middle => along.mid() == hit.line,
            _ => along.lo - half == hit.line || along.hi + half == hit.line,
        };
        if !on {
            continue;
        }
        let cross = if across_x {
            Span::of_x(*peer)
        } else {
            Span::of_y(*peer)
        };
        from = from.min(cross.lo - half);
        to = to.max(cross.hi + half);
    }
    (from, to)
}

fn apply(lo: &mut i32, hi: &mut i32, hit: Hit, moving: bool) {
    if moving {
        *lo += hit.shift;
        *hi += hit.shift;
    } else if hit.part == Part::Start {
        *lo += hit.shift;
    } else {
        *hi += hit.shift;
    }
}

fn nearest(
    card: Span,
    work: Span,
    peers: &[Span],
    half: i32,
    reach: i32,
    moving: bool,
    start_edge: bool,
    end_edge: bool,
    min: i32,
    max: i32,
) -> Option<Hit> {
    let mut best: Option<Hit> = None;

    let mut sources: Vec<(Part, i32)> = Vec::new();
    if moving || start_edge {
        sources.push((Part::Start, card.lo - half));
    }
    if moving || end_edge {
        sources.push((Part::End, card.hi + half));
    }
    if moving {
        sources.push((Part::Middle, card.mid()));
    }

    for (part, at) in sources {
        let mut consider = |line: i32, screen: bool, best: &mut Option<Hit>| {
            let shift = line - at;
            if shift.abs() > reach {
                return;
            }
            if !moving {
                let size = match part {
                    Part::Start => card.hi - (card.lo + shift),
                    _ => card.hi + shift - card.lo,
                };
                if size < min || (max > 0 && size > max) {
                    return;
                }
            }
            let hit = Hit {
                part,
                shift,
                line,
                screen,
            };
            match *best {
                Some(b) if !hit.better_than(b) => {}
                _ => *best = Some(hit),
            }
        };

        if part == Part::Middle {
            consider(work.mid(), true, &mut best);
            for peer in peers {
                consider(peer.mid(), false, &mut best);
            }
        } else {
            consider(work.lo + half, true, &mut best);
            consider(work.hi - half, true, &mut best);
            for peer in peers {
                consider(peer.lo - half, false, &mut best);
                consider(peer.hi + half, false, &mut best);
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let (card, guides) = snap(rect(5, 400, 300, 150), work, &[], 12, 8, Edges::NONE, (0, 0), (0, 0));
        assert_eq!(card.left, 12, "one whole gap from the edge");
        assert!(guides.iter().any(|g| g.vertical && g.at == 6));
        // the guide spans the whole screen when it snapped to the screen
        let v = guides.iter().find(|g| g.vertical).unwrap();
        assert_eq!((v.from, v.to), (0, 1040));
    }

    #[test]
    fn a_centre_lines_up_with_the_screen_centre() {
        let work = rect(0, 0, 1920, 1040);
        let (card, _) = snap(rect(810, 400, 300, 150), work, &[], 12, 8, Edges::NONE, (0, 0), (0, 0));
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
        let (card, guides) = snap(rect(700, 400, 300, 150), work, &[], 12, 8, Edges::NONE, (0, 0), (0, 0));
        assert_eq!((card.left, card.top), (700, 400));
        assert!(guides.is_empty());
    }
}
