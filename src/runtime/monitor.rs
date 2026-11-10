//! Background readers: system counters, the volume control and now-playing. Each runs on its own
//! thread so a slow provider never blocks the UI, and only while some card is listening.

use crate::platform::sysinfo::Sampler;
use crate::runtime::app::Ev;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopProxy;

#[derive(Clone, Default)]
pub struct Request {
    pub topics: Vec<String>,
    pub interval_ms: u64,
    pub audio: bool,
    pub media: bool,
}

#[derive(Clone)]
pub struct Monitor {
    req: Arc<Mutex<Request>>,
}

impl Monitor {
    pub fn configure(&self, next: Request) {
        *self.req.lock().unwrap() = next;
    }
}

pub fn start(proxy: EventLoopProxy<Ev>) -> Monitor {
    let req = Arc::new(Mutex::new(Request::default()));

    // system counters
    {
        let req = req.clone();
        let proxy = proxy.clone();
        std::thread::spawn(move || {
            let mut sampler = Sampler::new();
            let mut last = Instant::now() - Duration::from_secs(5);
            loop {
                std::thread::sleep(Duration::from_millis(100));
                let r = req.lock().unwrap().clone();
                if r.topics.is_empty() {
                    continue;
                }
                if last.elapsed() < Duration::from_millis(r.interval_ms.min(60_000)) {
                    continue;
                }
                last = Instant::now();
                let snapshot = sampler.sample(&r.topics);
                if proxy.send_event(Ev::Sample(snapshot)).is_err() {
                    return;
                }
            }
        });
    }

    // volume
    {
        let req = req.clone();
        let proxy = proxy.clone();
        std::thread::spawn(move || {
            let mut last_value = Value::Null;
            loop {
                std::thread::sleep(Duration::from_millis(400));
                if !req.lock().unwrap().audio {
                    last_value = Value::Null;
                    continue;
                }
                let state = crate::platform::audio::state();
                if state != last_value {
                    last_value = state.clone();
                    if proxy.send_event(Ev::Audio(state)).is_err() {
                        return;
                    }
                }
            }
        });
    }

    // now playing
    {
        let req = req.clone();
        std::thread::spawn(move || {
            let mut last_value = Value::Null;
            loop {
                std::thread::sleep(Duration::from_millis(900));
                if !req.lock().unwrap().media {
                    last_value = Value::Null;
                    continue;
                }
                let state = crate::platform::media::state();
                // Position moves on its own between updates; skip it when comparing.
                let mut comparable = state.clone();
                if let Some(obj) = comparable.as_object_mut() {
                    obj.remove("updated");
                }
                if comparable != last_value {
                    last_value = comparable;
                    let _ = proxy.send_event(Ev::Media(state));
                }
            }
        });
    }

    Monitor { req }
}
