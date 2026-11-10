const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let s = { available: false }; // what Windows reports, see widget.d.ts MediaState
let tick = 0;
const BARS = 44;

const PLAY = '<path d="M7.5 4.8v14.4L19.5 12z"/>';
const PAUSE = '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>';

$("wave").innerHTML = "<i></i>".repeat(BARS);

/** "3:07", or "1:02:45" past an hour. */
function clock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}

/** Bar heights for the instrument theme's waveform, the same for the same track. */
function shape(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [];
  for (let i = 0; i < BARS; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const env = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI); // fuller in the middle, like a song
    out.push(Math.round((0.25 + (h % 1000) / 1000 * 0.75) * env * 100));
  }
  return out;
}
let shaped = "";

function render() {
  const live = !!s.available && s.status !== "closed";
  document.body.classList.toggle("none", !live);
  document.body.classList.toggle("playing", live && !!s.playing);
  document.body.classList.toggle("no-app", !opts.app || !live || !s.app || !s.app.name);

  const title = live ? s.title || (s.app && s.app.name) || t({ "zh-TW": "正在播放", "zh-CN": "正在播放", en: "Playing" }) : t({ "zh-TW": "沒有正在播放的媒體", "zh-CN": "没有正在播放的媒体", en: "Nothing playing" });
  const artist = live ? [s.artist || s.albumArtist, s.album && s.album !== s.title ? s.album : ""].filter(Boolean).join(" · ") || s.subtitle || ""
    : t({ "zh-TW": "在音樂或影片程式裏播放，就會出現在這裏", "zh-CN": "在音乐或视频程序里播放，就会出现在这里", en: "Play something in a music or video app" });
  $("title").textContent = title;
  $("title").title = title;
  // with lyrics on the artist's line, the artist goes after the title
  $("title").dataset.by = live && lyr && lyr.lines.length ? s.artist || s.albumArtist || "" : "";
  $("artist").textContent = artist;
  $("artist").title = artist;

  if (live && s.app) {
    $("app-name").textContent = s.app.name;
    $("app-icon").hidden = $("badge").hidden = !s.app.icon;
    if (s.app.icon && $("app-icon").getAttribute("src") !== s.app.icon) $("app-icon").src = $("badge").src = s.app.icon;
    $("badge").title = s.app.name;
  }

  setCover(live ? s.cover : null);

  const can = (live && s.can) || {};
  $("prev").disabled = !can.previous;
  $("next").disabled = !can.next;
  $("play").disabled = !(can.toggle || (s.playing ? can.pause : can.play));
  $("play-icon").innerHTML = live && s.playing ? PAUSE : PLAY;
  $("play").title = live && s.playing ? t({ "zh-TW": "暫停", "zh-CN": "暂停", en: "Pause" }) : t({ "zh-TW": "播放", "zh-CN": "播放", en: "Play" });
  $("prev").title = t({ "zh-TW": "上一首", "zh-CN": "上一首", en: "Previous" });
  $("next").title = t({ "zh-TW": "下一首", "zh-CN": "下一首", en: "Next" });

  const seed = `${s.title}|${s.artist}`;
  if (seed !== shaped) {
    shaped = seed;
    shape(seed).forEach((v, i) => { $("wave").children[i].style.height = `${v}%`; });
  }
  document.body.classList.toggle("no-progress", !opts.progress || !live || !(s.duration > 0));
  document.body.classList.toggle("seekable", !!can.seek);
  renderPosition();

  clearInterval(tick);
  if (live && s.playing && s.duration > 0 && opts.progress) tick = setInterval(renderPosition, 1000);
  lyricsFor(live);
}

// ───────────────────────── lyrics ─────────────────────────

let lyr = null;        // { key, lines: [{ t, text, tr }], source } for the track playing
let lyrKey = "";       // the track lyrics were last asked for
let lyrIndex = -2;     // the line shown
let lyrTimer = 0;
const LEAD = 150;      // a line shows a moment early, which reads as on time
const SOURCES = { netease: { "zh-TW": "網易雲音樂", "zh-CN": "网易云音乐", en: "NetEase Cloud Music" }, qqmusic: { "zh-TW": "QQ 音樂", "zh-CN": "QQ 音乐", en: "QQ Music" }, kugou: { "zh-TW": "酷狗音樂", "zh-CN": "酷狗音乐", en: "Kugou" } };
const trackKey = () => `${s.title}\n${s.artist}`;

/** Some players never report where in the song they are; then time is counted from when the
 *  track started, held while paused. */
let own = { key: "", elapsed: 0, since: 0 };
function trackTime() {
  if (s.duration > 0) return widget.media.position(s);
  return own.elapsed + (own.since ? Date.now() - own.since : 0);
}
function followOwnClock() {
  const key = trackKey();
  if (own.key !== key) own = { key, elapsed: 0, since: s.playing ? Date.now() : 0 };
  else if (s.playing && !own.since) own.since = Date.now();
  else if (!s.playing && own.since) { own.elapsed += Date.now() - own.since; own.since = 0; }
}

// The same song name and singer with another length is another recording (live, remix, cut…),
// whose lyrics and timing differ. A couple of seconds either way is the same one.
let lyrLen = 0;        // the track length lyrics were asked for, ms (0: not known then)
const sameLength = (a, b) => Math.abs(a - b) <= 2000;

function lyricsFor(live) {
  followOwnClock();
  const want = live && opts.lyrics !== false && !!s.title;
  const key = want ? trackKey() : "";
  const len = want && s.duration > 0 ? s.duration : 0;
  if (key !== lyrKey) {
    lyrKey = key;
    lyrLen = len;
    showLyrics(null);
    if (key) fetchLyrics(key, len, 0);
  } else if (key && len && !sameLength(len, lyrLen)) {
    // another version; when the length simply wasn't known yet, keep what's shown until the answer comes
    if (lyrLen) showLyrics(null);
    lyrLen = len;
    fetchLyrics(key, len, 0);
  }
  scheduleLyrics();
}

function fetchLyrics(key, len, attempt) {
  const current = () => key === lyrKey && len === lyrLen;
  widget.media.lyrics().then((r) => {
    if (!current()) return; // the song changed meanwhile
    // Windows may not have told the app about the new song yet: ask again in a moment
    if (r.title !== s.title || (len && !sameLength(r.duration || 0, len))) {
      if (attempt < 3) setTimeout(() => current() && fetchLyrics(key, len, attempt + 1), 800);
      return;
    }
    showLyrics(r.lyrics && r.lyrics.found ? { key, lines: r.lyrics.lines, source: r.lyrics.source } : null);
  }).catch((e) => widget.log(`media: lyrics: ${e.message}`));
}

function showLyrics(next) {
  lyr = next;
  lyrIndex = -2;
  const has = !!(lyr && lyr.lines.length);
  document.body.classList.toggle("lyrics", has);
  $("lyr").innerHTML = has ? lyr.lines.map((l) =>
    `<p><span class="l">${esc(l.text) || "♪"}</span>${l.tr ? `<span class="tr">${esc(l.tr)}</span>` : ""}</p>`).join("") : "";
  $("lyric").title = has ? t({ "zh-TW": "歌詞來自", "zh-CN": "歌词来自", en: "Lyrics from" }) + " " + t(SOURCES[lyr.source] || { en: lyr.source }) : "";
  $("title").dataset.by = has ? s.artist || s.albumArtist || "" : "";
  placeLyrics(true);
  scheduleLyrics();
}

/** The line playing now: the last one that has started. */
function currentLine() {
  const now = trackTime() + LEAD;
  const L = lyr.lines;
  let i = -1;
  for (let lo = 0, hi = L.length - 1; lo <= hi;) {
    const mid = (lo + hi) >> 1;
    if (L[mid].t <= now) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return i;
}

function scheduleLyrics() {
  clearTimeout(lyrTimer);
  if (!lyr || document.hidden) return;
  const i = currentLine();
  if (i !== lyrIndex) { lyrIndex = i; placeLyrics(false); }
  if (!s.playing) return;
  // wake up when the next line is due
  const next = lyr.lines[i + 1];
  const wait = next ? next.t - (trackTime() + LEAD) : 1000;
  lyrTimer = setTimeout(scheduleLyrics, Math.max(40, Math.min(wait + 5, 1000)));
}

/** Slides the list so the line playing sits in the middle (or on top, when there's room for one). */
function placeLyrics(jump) {
  if (!lyr) return;
  const box = $("lyric"), list = $("lyr");
  const rows = list.children;
  for (let k = 0; k < rows.length; k++) {
    rows[k].classList.toggle("on", k === lyrIndex);
    rows[k].classList.toggle("past", k < lyrIndex);
  }
  const row = rows[Math.max(0, lyrIndex)];
  if (!row) return;
  const h = box.clientHeight, many = h > row.offsetHeight * 2.4;
  const y = many ? h / 2 - (row.offsetTop + row.offsetHeight / 2) : -row.offsetTop;
  list.classList.toggle("jump", jump);
  list.style.transform = `translateY(${Math.round(y)}px)`;
  box.classList.toggle("many", many);
}
new ResizeObserver(() => placeLyrics(true)).observe(document.body);

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderPosition() {
  if (!s.available || !(s.duration > 0)) { $("times").textContent = ""; return; }
  const p = widget.media.position(s);
  const f = Math.min(1, p / s.duration);
  $("fill").style.width = `${f * 100}%`;
  $("knob").style.left = `${f * 100}%`;
  const lit = Math.round(f * BARS);
  const bars = $("wave").children;
  for (let i = 0; i < BARS; i++) bars[i].classList.toggle("on", i < lit);
  $("times").textContent = `${clock(p)} / ${clock(s.duration)}`;
}

// The new cover replaces the old one only once it has loaded, so it never flashes empty.
let coverUrl = null;
function setCover(url) {
  if (url === coverUrl) return;
  coverUrl = url;
  if (!url) { $("art").classList.remove("has"); $("cover").removeAttribute("src"); return; }
  const img = new Image();
  img.onload = () => {
    if (coverUrl !== url) return;
    $("cover").src = url;
    $("art").classList.add("has");
  };
  img.onerror = () => { if (coverUrl === url) $("art").classList.remove("has"); };
  img.src = url;
}

function act(fn) {
  fn().catch((e) => widget.log(`media: ${e.message}`));
}
$("play").onclick = () => {
  // answer at once; Windows confirms a moment later
  if (s.available) { s = { ...s, playing: !s.playing, position: widget.media.position(s), updated: Date.now() }; render(); }
  act(() => (s.can && s.can.toggle ? widget.media.toggle() : s.playing ? widget.media.play() : widget.media.pause()));
};
$("prev").onclick = () => act(widget.media.previous);
$("next").onclick = () => act(widget.media.next);
$("progress").addEventListener("click", (e) => {
  if (!s.available || !s.can || !s.can.seek || !(s.duration > 0)) return;
  const r = $("progress").getBoundingClientRect();
  const ms = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * s.duration;
  s = { ...s, position: ms, updated: Date.now() };
  renderPosition();
  scheduleLyrics();
  act(() => widget.media.seek(ms));
});
document.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "MediaPlayPause") { e.preventDefault(); $("play").click(); }
  else if (e.key === "ArrowRight" || e.key === "MediaTrackNext") $("next").click();
  else if (e.key === "ArrowLeft" || e.key === "MediaTrackPrevious") $("prev").click();
});

widget.media.onChange((state) => { s = state || { available: false }; render(); });
widget.settings.onChange((o) => {
  const translation = o.translation !== opts.translation;
  opts = o;
  document.body.classList.toggle("no-tr", opts.translation === false);
  render();
  if (translation) placeLyrics(true);
});
document.body.classList.toggle("no-tr", opts.translation === false);
// no ticking while the widget is hidden
document.addEventListener("visibilitychange", () => { if (document.hidden) { clearInterval(tick); clearTimeout(lyrTimer); } else render(); });
render();
