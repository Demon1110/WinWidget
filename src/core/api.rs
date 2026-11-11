//! The dispatcher: one message in, one category module out.
//!
//! uTools splits its API into 16 categories (events, window, system, screen, input, copy, db, ai,
//! schedule, simulate, features, redirect, ubrowser, sharp, ffmpeg, payment) and every category has
//! its own page in the documentation. WinWidget follows the same split: one file per category under
//! `core/`, and this file only decides which of them gets the message — a chain of responsibility,
//! so adding a category is one line here plus its own module.
//!
//! Each module exposes the same shape:
//!
//! ```ignore
//! pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>>
//! ```
//!
//! `None` means "not mine, try the next module"; `Some` is the answer (or a spawned reply).

use crate::core::util::{BridgeError, BridgeResult};
use crate::model::manifest::Manifest;
use crate::runtime::app::{post, App, Ev};
use serde_json::{json, Value};

/// What a handler answers with: the value now, or a thread that will post the value later.
#[derive(Debug)]
pub enum Reply {
    Now(Value),
    Later,
}

/// One message being answered: the widget, its manifest, the permissions it holds right now, and
/// where the answer goes (`instance` for a card, `win:<id>` for a custom window).
pub struct Ctx<'a> {
    pub app: &'a mut App,
    pub instance: &'a str,
    pub manifest: Manifest,
    pub allowed: Vec<String>,
    pub id: i64,
    pub target: &'a str,
    pub win: Option<u32>,
}

impl<'a> Ctx<'a> {
    pub fn new(
        app: &'a mut App,
        instance: &'a str,
        target: &'a str,
        win: Option<u32>,
        manifest: Manifest,
        allowed: Vec<String>,
        id: i64,
    ) -> Self {
        Ctx {
            app,
            instance,
            manifest,
            allowed,
            id,
            target,
            win,
        }
    }

    /// The permission is declared and the user allowed it, or the call is refused with the line to
    /// add to `widget.json`.
    pub fn require(&self, permission: &str) -> BridgeResult<()> {
        if !self.manifest.declares(permission) {
            return Err(BridgeError::new(format!(
                "permission denied: add \"{permission}\" to permissions in widget.json"
            )));
        }
        if !crate::model::permissions::has(&self.allowed, permission) {
            return Err(BridgeError::new(format!(
                "permission denied: \"{permission}\" is not allowed yet — open the control center, choose \"{}\" and allow it",
                self.manifest.display_name()
            )));
        }
        Ok(())
    }

    pub fn builtin_only(&self) -> BridgeResult<()> {
        if self.manifest.builtin {
            Ok(())
        } else {
            Err(BridgeError::new(
                "only WinWidget's built-in widgets can do this",
            ))
        }
    }

    /// Answers `{ id, r }` or `{ id, e }` from a worker thread, for anything that blocks: reading
    /// disks, decoding a picture, a dialog, a network call.
    pub fn spawn_reply<F>(&self, work: F)
    where
        F: FnOnce() -> BridgeResult<Value> + Send + 'static,
    {
        let proxy = self.app.proxy.clone();
        let target = self.target.to_string();
        let id = self.id;
        std::thread::spawn(move || {
            let body = match work() {
                Ok(value) => json!({ "id": id, "r": value }),
                Err(e) => json!({ "id": id, "e": e.0 }),
            };
            post(&proxy, Ev::Reply { win: target, body: body.to_string() });
        });
    }

    /// The same, for work that cannot fail in a way the page should see.
    pub fn spawn_value<F>(&self, work: F)
    where
        F: FnOnce() -> Value + Send + 'static,
    {
        self.spawn_reply(move || Ok(work()));
    }
}

/// A handler: `None` when the method is not this category's business.
pub type Handler = fn(&mut Ctx, &str, &Value) -> Option<BridgeResult<Reply>>;

/// The categories, in the order they are asked. The uTools ones come first in the order the
/// documentation lists them; `widget` last, because it is WinWidget's own protocol rather than a
/// uTools category, and `payment` is there even though it has nothing to answer yet.
pub const CHAIN: &[(&str, Handler)] = &[
    ("window", crate::core::window::call),
    ("system", crate::core::system::call),
    ("screen", crate::core::screen::call),
    ("input", crate::core::input::call),
    ("clipboard", crate::core::clipboard::call),
    ("db", crate::core::db::call),
    ("schedule", crate::core::schedule::call),
    ("simulate", crate::core::simulate::call),
    ("features", crate::core::features::call),
    ("redirect", crate::core::redirect::call),
    ("ubrowser", crate::core::ubrowser::call),
    ("sharp", crate::core::sharp::call),
    ("ai", crate::core::ai::call),
    ("ffmpeg", crate::core::ffmpeg::call),
    ("payment", crate::core::payment::call),
    ("widget", crate::core::widget::call),
];

/// Asks every category in turn. The last one to be asked answers unknown methods for real, so a
/// typo still reads `unknown method 'x'` instead of getting a silent `null`.
pub fn dispatch(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    for (_name, handler) in CHAIN {
        if let Some(result) = handler(ctx, method, p) {
            return result;
        }
    }
    Err(BridgeError::new(format!("unknown method '{method}'")))
}
