//! The event protocol between the app's worker threads and its single UI loop.
//!
//! `Ev` is plain data (strings/JSON), and [`post`] is the one way a thread hands an event
//! to the loop. Both live in `core` because the capability modules (`core::api::spawn_reply`,
//! `runtime::window_category`) need to post replies and IPC without reaching into `runtime::app`
//! for the protocol type. `runtime::app` re-exports them, so existing callers keep working.

use serde_json::Value;
use tao::event_loop::EventLoopProxy;

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

/// Marks the start of a window build; events posted meanwhile are held.
pub fn begin_build() {
    BUILDING.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Marks the end of a build and releases everything held during it.
pub fn end_build(proxy: &EventLoopProxy<Ev>) {
    BUILDING.store(false, std::sync::atomic::Ordering::SeqCst);
    let held = match HELD.lock() {
        Ok(mut held) => std::mem::take(&mut *held),
        Err(_) => Vec::new(),
    };
    for event in held {
        let _ = proxy.send_event(event);
    }
}

/// Events the loop understands. Nothing here holds a window or an `App`, which is what
/// lets it sit at the bottom of the dependency graph.
pub enum Ev {
    Ipc {
        win: String,
        msg: String,
    },
    Reply {
        win: String,
        body: String,
    },
    Sample(Value),
    Audio(Value),
    Media(Value),
    Command(String),
    Tick,
    /// A page queued something that has to be built on the loop (a custom window, today).
    Wake,
}
