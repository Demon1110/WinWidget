#![allow(unused_imports)]

//! Tests for `src/model/appearance.rs`.
//!
//! The card's 1px inner ring is generated here, so this is where its behaviour is pinned: a solid
//! card keeps the theme's border colour untouched, a faint card fades it, and a card with no body
//! at all draws no line (the "glass with text" theme).

use serde_json::json;
use winwidget::core::config::{AppConfig, InstanceConfig};
use winwidget::model::appearance::page_css;
use winwidget::model::themes::Themes;

/// CSS for one instance with the given appearance overrides.
fn css_for(appearance: serde_json::Value) -> String {
    let inst = InstanceConfig {
        width: 380.0,
        height: 640.0,
        appearance: appearance.as_object().cloned().unwrap_or_default(),
        ..InstanceConfig::default()
    };
    let (_, user) = page_css(&Themes::default(), &AppConfig::default(), &inst);
    user
}

#[test]
fn a_card_with_no_body_draws_no_ring() {
    let css = css_for(json!({ "backgroundOpacity": 0.0 }));
    assert!(css.contains("--w-card-ring:transparent"), "{css}");
}

#[test]
fn a_solid_card_left_the_ring_to_the_theme() {
    // 0.62 and 0.8 are the two values themes actually use; neither may emit its own ring colour.
    for op in [0.62, 0.8, 1.0] {
        let css = css_for(json!({ "backgroundOpacity": op }));
        assert!(!css.contains("--w-card-ring"), "{op}: {css}");
    }
}

#[test]
fn a_faint_card_fades_the_ring_with_its_body() {
    // Half of the solid threshold -> half the ring, never a hard line over a see-through body.
    let css = css_for(json!({ "backgroundOpacity": 0.2 }));
    assert!(
        css.contains("--w-card-ring:color-mix(in srgb,var(--w-border) 50%,transparent)"),
        "{css}"
    );
}

#[test]
fn a_frosted_card_fades_by_what_is_actually_drawn() {
    // Frosted keeps only 45% of the asked opacity, and the ring follows what the eye gets: 0.4 * 0.45.
    let css = css_for(json!({ "backgroundOpacity": 0.4, "style": "frosted" }));
    assert!(
        css.contains("--w-card-ring:color-mix(in srgb,var(--w-border) 45%,transparent)"),
        "{css}"
    );
}
