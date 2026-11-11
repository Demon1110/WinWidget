//! Now playing, through Windows' system media transport controls (what the volume flyout reads
//! when you press a media key). Covers are cached as PNG and served to the widget.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

/// A refresh asked for by a reader, or a control command; the worker runs both.
enum Job {
    Refresh,
    Control { action: String, position: i64 },
}

/// While a card is subscribed the worker re-reads this often; a reading older than `FRESH` makes a
/// plain `state()` call ask for a new one. Between them the session read stays off the UI thread
/// without polling WinRT when nothing is looking at it.
const WATCH_REFRESH: Duration = Duration::from_millis(900);
const FRESH: Duration = Duration::from_millis(800);

/// The last reading the worker published, with the moment it was taken.
static LATEST: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
static JOBS: OnceLock<Sender<Job>> = OnceLock::new();
static WATCHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LAST_TRACK: Mutex<Option<String>> = Mutex::new(None);
static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static MANAGER: Mutex<Option<GlobalSystemMediaTransportControlsSessionManager>> = Mutex::new(None);

/// Starts (once) the single thread that is allowed to talk to WinRT.
///
/// WinRT async completions are marshalled back to the apartment that issued them. The event-loop
/// thread holds an STA, so a blocking `.get()` there waits for a completion that can only be
/// delivered by the message pump currently blocked inside the call: the whole app freezes, which is
/// exactly what happened when a media card loaded. An MTA worker gets its completions from the
/// thread pool instead, so `.get()` returns. It also keeps the cover download and the lyrics
/// request off the UI thread.
fn worker() -> &'static Sender<Job> {
    JOBS.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        if let Err(e) = std::thread::Builder::new()
            .name("media".into())
            .spawn(move || run_worker(rx))
        {
            crate::core::logging::warn(&format!("Media: worker thread could not start: {e}"));
        }
        tx
    })
}

fn run_worker(rx: Receiver<Job>) {
    if !crate::platform::win32::co_initialize_mta() {
        crate::core::logging::warn("Media: worker could not enter an MTA apartment");
    }
    use std::sync::atomic::Ordering;
    loop {
        let job = if WATCHING.load(Ordering::Relaxed) {
            match rx.recv_timeout(WATCH_REFRESH) {
                Ok(job) => job,
                Err(RecvTimeoutError::Timeout) => Job::Refresh,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        } else {
            match rx.recv() {
                Ok(job) => job,
                Err(_) => return,
            }
        };
        if let Job::Control { action, position } = job {
            run_control(&action, position);
        }
        refresh();
    }
}

fn refresh() {
    let value = query_state();
    // One line per actual change: makes "the card looks empty" reports diagnosable from the log.
    let status = value
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("closed")
        .to_string();
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if let Ok(mut last) = LAST_TRACK.lock() {
        let now = format!("{status}\t{title}");
        if last.as_deref() != Some(now.as_str()) {
            let line = if title.is_empty() {
                format!("Media: {status}")
            } else {
                format!("Media: {status} — {title}")
            };
            crate::core::logging::info(&line);
            *last = Some(now);
        }
    }
    if let Ok(mut slot) = LATEST.lock() {
        *slot = Some((Instant::now(), value));
    }
}

/// The current media session, as the worker last read it.
///
/// Never blocks the caller beyond the very first call (which waits up to 600 ms so a freshly opened
/// card does not start blank); afterwards it is a mutex read and a clone.
pub fn state() -> Value {
    let cached = LATEST
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|(at, v)| (*at, v.clone())));
    match cached {
        Some((at, value)) if at.elapsed() < FRESH => value,
        Some((_, value)) => {
            let _ = worker().send(Job::Refresh);
            value
        }
        None => {
            let _ = worker().send(Job::Refresh);
            let deadline = Instant::now() + Duration::from_millis(600);
            while Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
                if let Some(value) = LATEST
                    .lock()
                    .ok()
                    .and_then(|slot| slot.as_ref().map(|(_, v)| v.clone()))
                {
                    return value;
                }
            }
            empty_state()
        }
    }
}

/// Keeps the worker reading the session while a card is subscribed, and lets it go idle once the
/// last one is gone.
pub fn set_watching(on: bool) {
    WATCHING.store(on, std::sync::atomic::Ordering::Relaxed);
    if on {
        let _ = worker().send(Job::Refresh);
    }
}

/// `play` / `pause` / `toggle` / `next` / `previous` / `seek`: queued to the worker.
///
/// The answer is optimistic — a subscribed card gets the real status with the next push; waiting for
/// the worker here would put a WinRT round trip back on the UI thread, which is what this worker
/// exists to avoid.
pub fn control(action: &str, position_ms: i64) -> Value {
    if !matches!(
        action,
        "play" | "pause" | "toggle" | "next" | "previous" | "seek"
    ) {
        return json!({ "ok": false, "error": format!("unknown media action '{action}'") });
    }
    match worker().send(Job::Control {
        action: action.to_string(),
        position: position_ms,
    }) {
        Ok(()) => json!({ "ok": true }),
        Err(_) => json!({ "ok": false, "error": "media worker is not running" }),
    }
}

fn empty_state() -> Value {
    json!({
        "available": false,
        "status": "closed",
        "playing": false,
        "title": "",
        "artist": "",
        "album": "",
        "albumArtist": "",
        "subtitle": "",
        "duration": 0,
        "position": 0,
        "updated": crate::core::util::now_ms(),
        "cover": Value::Null,
        "app": { "name": "", "icon": Value::Null },
        "can": { "play": false, "pause": false, "toggle": false, "next": false, "previous": false, "seek": false },
    })
}

fn manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
    let mut guard = MANAGER.lock().unwrap();
    if let Some(m) = guard.as_ref() {
        return Some(m.clone());
    }
    let m = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;
    *guard = Some(m.clone());
    Some(m)
}

fn session() -> Option<GlobalSystemMediaTransportControlsSession> {
    manager()?.GetCurrentSession().ok()
}

fn status_name(
    s: windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus,
) -> &'static str {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus as S;
    match s {
        S::Closed => "closed",
        S::Opened => "opened",
        S::Changing => "changing",
        S::Stopped => "stopped",
        S::Playing => "playing",
        S::Paused => "paused",
        _ => "closed",
    }
}

fn ticks_to_ms(t: windows::Foundation::TimeSpan) -> i64 {
    t.Duration / 10_000
}

fn ms_to_ticks(ms: i64) -> i64 {
    ms.saturating_mul(10_000)
}

/// The reading itself. WinRT lives here, and this is only ever called from the worker thread.
fn query_state() -> Value {
    let empty = empty_state();
    let Some(session) = session() else {
        return empty;
    };
    let info = match session.GetPlaybackInfo() {
        Ok(i) => i,
        Err(_) => return empty,
    };
    let status = info.PlaybackStatus().unwrap_or(
        windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed,
    );
    let name = status_name(status);
    if name == "closed" {
        return empty;
    }
    let controls = info.Controls().ok();
    let can = |f: fn(
        &windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls,
    ) -> windows::core::Result<bool>| {
        controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false)
    };
    let playing = name == "playing";

    let props = session
        .TryGetMediaPropertiesAsync()
        .ok()
        .and_then(|op| op.get().ok());
    let (title, artist, album, album_artist, subtitle) = match props.as_ref() {
        Some(p) => (
            p.Title().map(|s| s.to_string()).unwrap_or_default(),
            p.Artist().map(|s| s.to_string()).unwrap_or_default(),
            p.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
            p.AlbumArtist().map(|s| s.to_string()).unwrap_or_default(),
            p.Subtitle().map(|s| s.to_string()).unwrap_or_default(),
        ),
        None => (
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        ),
    };

    let (position, duration) = match session.GetTimelineProperties() {
        Ok(t) => (
            ticks_to_ms(t.Position().unwrap_or_default()),
            ticks_to_ms(t.EndTime().unwrap_or_default()),
        ),
        Err(_) => (0, 0),
    };

    let cover = props
        .as_ref()
        .and_then(|p| p.Thumbnail().ok())
        .and_then(|thumb| cover_url(&thumb, &title, &artist));

    let app_id = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app_name = friendly_app_name(&app_id);

    json!({
        "available": true,
        "status": name,
        "playing": playing,
        "title": title,
        "artist": artist,
        "album": album,
        "albumArtist": album_artist,
        "subtitle": subtitle,
        "duration": duration.max(0),
        "position": position.max(0),
        "updated": crate::core::util::now_ms(),
        "cover": cover,
        "app": { "name": app_name, "icon": Value::Null },
        "can": {
            "play": can(|c| c.IsPlayEnabled()),
            "pause": can(|c| c.IsPauseEnabled()),
            "toggle": can(|c| c.IsPlayPauseToggleEnabled()),
            "next": can(|c| c.IsNextEnabled()),
            "previous": can(|c| c.IsPreviousEnabled()),
            "seek": can(|c| c.IsPlaybackPositionEnabled()),
        },
    })
}

fn friendly_app_name(aumid: &str) -> String {
    if aumid.is_empty() {
        return String::new();
    }
    let known = [
        ("Microsoft.ZuneMusic", "Media Player"),
        ("Microsoft.MediaPlayer", "Media Player"),
        ("SpotifyAB.SpotifyMusic", "Spotify"),
        ("Spotify", "Spotify"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
    ];
    for (needle, name) in known {
        if aumid.eq_ignore_ascii_case(needle) || aumid.contains(needle) {
            return name.to_string();
        }
    }
    let base = aumid.split('!').next_back().unwrap_or(aumid);
    let base = base.split('_').next().unwrap_or(base);
    let last = base.rsplit('.').next().unwrap_or(base);
    // A desktop player reports the file it plays — "C:\…\foobar2000.exe" — and the last dot segment
    // of that is "exe". The name the user recognizes is the file's own name.
    if last.eq_ignore_ascii_case("exe")
        || last.eq_ignore_ascii_case("com")
        || last.eq_ignore_ascii_case("dll")
        || last.eq_ignore_ascii_case("app")
    {
        let file = aumid.rsplit(['\\', '/']).next().unwrap_or(aumid);
        let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
        let stem = stem.split('!').next_back().unwrap_or(stem);
        return stem.rsplit('.').next().unwrap_or(stem).to_string();
    }
    last.to_string()
}

/// Reads the session thumbnail into `<local>\media\<key>.png` and returns the URL for it.
fn cover_url(thumb: &IRandomAccessStreamReference, title: &str, artist: &str) -> Option<String> {
    let key = cache_key(title, artist);
    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(HashMap::new);
    if let Some(url) = map.get(&key) {
        return Some(url.clone());
    }
    let stream = thumb.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as usize;
    if size == 0 || size > 8 * 1024 * 1024 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size as u32).ok()?.get().ok()?;
    let mut bytes = vec![0u8; size];
    reader.ReadBytes(&mut bytes).ok()?;
    let dir = crate::core::paths::get().local_dir.join("media");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join(format!("{key}.png"));
    // Already a PNG in most cases; re-encode only when the session hands us something else.
    let _ = std::fs::write(&file, &bytes);
    let url = format!("/__media/cover/{key}");
    map.insert(key, url.clone());
    Some(url)
}

fn cache_key(title: &str, artist: &str) -> String {
    // FNV-1a over "artist|title": stable for the same track, cheap, no crate needed.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in format!("{artist}|{title}").as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

pub fn cover_path(key: &str) -> Option<std::path::PathBuf> {
    if !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let file = crate::core::paths::get()
        .local_dir
        .join("media")
        .join(format!("{key}.png"));
    file.is_file().then_some(file)
}

/// Runs one control command against the current session. Worker thread only.
fn run_control(action: &str, position_ms: i64) -> Value {
    let Some(session) = session() else {
        return json!({ "ok": false, "error": "no media session" });
    };
    let result = match action {
        "play" => session.TryPlayAsync().and_then(|op| op.get()),
        "pause" => session.TryPauseAsync().and_then(|op| op.get()),
        "toggle" => session.TryTogglePlayPauseAsync().and_then(|op| op.get()),
        "next" => session.TrySkipNextAsync().and_then(|op| op.get()),
        "previous" => session.TrySkipPreviousAsync().and_then(|op| op.get()),
        "seek" => session
            .TryChangePlaybackPositionAsync(ms_to_ticks(position_ms))
            .and_then(|op| op.get()),
        _ => return json!({ "ok": false, "error": format!("unknown media action '{action}'") }),
    };
    json!({ "ok": result.is_ok() })
}

// ── lyrics ──────────────────────────────────────────────────────────────────

/// Looks the current track up on NetEase Cloud Music (the source FullWidget uses) and returns its
/// lyric lines. Anything that fails just reports "not found" — the widget keeps the title.
pub fn lyrics() -> Value {
    let st = state();
    let title = st
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let artist = st
        .get("artist")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let duration = st.get("duration").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut out = json!({
        "title": title,
        "artist": artist,
        "duration": duration,
        "lyrics": { "found": false, "source": Value::Null, "lines": [] },
    });
    if title.is_empty() {
        return out;
    }
    let query = format!("{title} {artist}").trim().to_string();
    let search_url = format!(
        "https://music.163.com/api/search/get/web?s={}&type=1&offset=0&total=true&limit=5",
        urlencode(&query)
    );
    let Some(search) = http_json(&search_url) else {
        return out;
    };
    let id = search
        .get("result")
        .and_then(|r| r.get("songs"))
        .and_then(|s| s.as_array())
        .and_then(|a| a.first())
        .and_then(|s| s.get("id"))
        .and_then(|i| i.as_i64());
    let Some(id) = id else { return out };
    let lyric_url = format!("https://music.163.com/api/song/lyric?id={id}&lv=-1&kv=-1&tv=-1");
    let Some(body) = http_json(&lyric_url) else {
        return out;
    };
    let lrc = body
        .get("lrc")
        .and_then(|l| l.get("lyric"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    if lrc.is_empty() {
        return out;
    }
    let translation = body
        .get("tlyric")
        .and_then(|l| l.get("lyric"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let tr_map: std::collections::HashMap<i64, String> =
        parse_lrc(translation).into_iter().collect();
    let lines: Vec<Value> = parse_lrc(lrc)
        .into_iter()
        .map(|(t, text)| {
            let tr = tr_map.get(&t).cloned().unwrap_or_default();
            json!({ "t": t, "text": text, "tr": tr })
        })
        .collect();
    out["lyrics"] = json!({ "found": !lines.is_empty(), "source": "netease", "lines": lines });
    out
}

fn parse_lrc(text: &str) -> Vec<(i64, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('[') {
            continue;
        }
        let Some(end) = line.find(']') else { continue };
        let stamp = &line[1..end];
        let body = line[end + 1..].trim().to_string();
        let mut parts = stamp.split(':');
        let minutes: i64 = match parts.next().and_then(|p| p.parse().ok()) {
            Some(m) => m,
            None => continue,
        };
        let seconds: f64 = match parts.next().and_then(|p| p.parse().ok()) {
            Some(s) => s,
            None => continue,
        };
        if body.is_empty() {
            continue;
        }
        out.push(((((minutes * 60) as f64 + seconds) * 1000.0) as i64, body));
    }
    out.sort_by_key(|(t, _)| *t);
    out
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn http_json(url: &str) -> Option<Value> {
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(8))
        .build();
    let response = agent
        .get(url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinWidget",
        )
        .set("Referer", "https://music.163.com/")
        .call()
        .ok()?;
    let text = response.into_string().ok()?;
    serde_json::from_str(&text).ok()
}
