const $ = (id) => document.getElementById(id);
const t = widget.t;

// Every sound is made here from noise and filters: nothing is downloaded.
const SOUNDS = [
  { k: "rain", name: { "zh-TW": "雨聲", "zh-CN": "雨声", en: "Rain" },
    icon: '<path d="M7 15.5a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 8a3.8 3.8 0 0 1-.3 7.5z"/><path d="M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>' },
  { k: "waves", name: { "zh-TW": "海浪", "zh-CN": "海浪", en: "Waves" },
    icon: '<path d="M3 9.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2M3 14.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2M3 19.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2"/>' },
  { k: "wind", name: { "zh-TW": "風聲", "zh-CN": "风声", en: "Wind" },
    icon: '<path d="M3 8.5h11a2.5 2.5 0 1 0-2.5-2.5M3 12.5h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16.5h8"/>' },
  { k: "fire", name: { "zh-TW": "爐火", "zh-CN": "炉火", en: "Fire" },
    icon: '<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 3-5 3.4-8.9 2.4 1.4 3.2 3.4 3.1 5.2 1-.6 1.7-1.7 1.9-3 2.1 1.6 3.6 4 3.6 6.7 0 3.2-2.4 5.6-6 5.6z"/>' },
  { k: "noise", name: { "zh-TW": "粉紅噪音", "zh-CN": "粉红噪音", en: "Pink noise" },
    icon: '<path d="M3 12h1.5l1.5-4 2 9 2-12 2 14 2-11 2 8 1.5-5 1 3H21"/>' },
];
const TIMERS = [0, 15, 30, 60, 90]; // minutes

let levels = { rain: 60, waves: 0, wind: 0, fire: 0, noise: 0 };
let playing = false;
let timerMin = 0, endsAt = 0, tick = 0;

// ───────────────────────── sound ─────────────────────────

let ctx = null, master = null, bufs = null;
const live = {}; // k → { out: GainNode, stop() }

/** Loops that join without a click: the last part is blended into the start. */
function seamless(raw, len) {
  const x = raw.length - len, out = raw.subarray(0, len);
  for (let i = 0; i < x; i++) {
    const f = i / x;
    out[i] = raw[i] * Math.sqrt(f) + raw[len + i] * Math.sqrt(1 - f);
  }
  return out;
}

function noiseBuffer(kind, seconds) {
  const sr = ctx.sampleRate, len = Math.round(sr * seconds), x = Math.round(sr * 0.25);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const raw = new Float32Array(len + x);
    let b0 = 0, b1 = 0, b2 = 0, last = 0, peak = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      let v = w;
      if (kind === "pink") { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; v = b0 + b1 + b2 + w * 0.1848; }
      else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; v = last; }
      raw[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i < raw.length; i++) raw[i] /= peak;
    buf.copyToChannel(seamless(raw, len), c);
  }
  return buf;
}

/** Short bursts scattered in time: rain drops (soft, many) or crackles of a fire (sharp, few). */
function burstBuffer(seconds, perSecond, ms, sharp) {
  const sr = ctx.sampleRate, len = Math.round(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(len);
    const n = Math.round(seconds * perSecond);
    for (let e = 0; e < n; e++) {
      const dur = Math.round(sr * (ms[0] + Math.random() * (ms[1] - ms[0])) / 1000);
      const at = Math.floor(Math.random() * (len - dur - 1));
      const amp = sharp ? (Math.random() < 0.12 ? 1 : 0.15 + Math.random() * 0.45) : 0.05 + Math.random() ** 2 * 0.5;
      const decay = sharp ? 7 : 4;
      for (let i = 0; i < dur; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-decay * i / dur);
    }
    buf.copyToChannel(d, c);
  }
  return buf;
}

let made = []; // sources and oscillators of the sound being built, to stop later
function source(buf) {
  const s = ctx.createBufferSource();
  made.push(s);
  s.buffer = buf;
  s.loop = true;
  s.start(0, Math.random() * buf.duration); // each starts somewhere else, so they don't line up
  return s;
}
function filter(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}
function gain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
function lfo(hz, depth, target) {
  const o = ctx.createOscillator(), g = gain(depth);
  o.frequency.value = hz;
  o.connect(g).connect(target);
  o.start();
  made.push(o);
  return o;
}
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

/** Builds one sound's graph into `out`. */
const BUILD = {
  rain(out) {
    chain(source(bufs.pink), filter("highpass", 400), filter("lowpass", 7500), gain(0.5), out);
    chain(source(bufs.drops), filter("bandpass", 2600, 0.6), gain(1.1), out);
    chain(source(bufs.brown), filter("lowpass", 260), gain(0.3), out);
  },
  waves(out) {
    const body = gain(0.32), lp = filter("lowpass", 520);
    const foam = gain(0.05), hp = filter("highpass", 1800);
    chain(source(bufs.brown), lp, body, out);
    chain(source(bufs.pink), hp, foam, out);
    // two slow swells that drift against each other, so no two waves are the same
    lfo(0.075, 0.24, body.gain); lfo(0.113, 0.1, body.gain); lfo(0.075, 330, lp.frequency); lfo(0.075, 0.045, foam.gain);
  },
  wind(out) {
    const bp = filter("bandpass", 520, 0.9), level = gain(0.8), whistle = filter("bandpass", 950, 9);
    chain(source(bufs.pink), bp, level, out);
    chain(source(bufs.pink), whistle, gain(0.12), out);
    lfo(0.06, 300, bp.frequency); lfo(0.17, 110, bp.frequency); lfo(0.09, 0.4, level.gain); lfo(0.045, 220, whistle.frequency);
  },
  fire(out) {
    const roar = gain(0.55);
    chain(source(bufs.brown), filter("lowpass", 380), roar, out);
    chain(source(bufs.crackle), filter("highpass", 1300), gain(0.9), out);
    lfo(0.33, 0.12, roar.gain);
  },
  noise(out) {
    chain(source(bufs.pink), filter("lowpass", 8500), gain(0.42), out);
  },
};

function ensureAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = gain(0);
  // a gentle limiter: five sounds turned all the way up still don't clip
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -12; limit.knee.value = 8; limit.ratio.value = 6; limit.attack.value = 0.01; limit.release.value = 0.3;
  master.connect(limit).connect(ctx.destination);
  bufs = {
    pink: noiseBuffer("pink", 5), brown: noiseBuffer("brown", 5),
    drops: burstBuffer(7.3, 38, [4, 14], false), crackle: burstBuffer(9.1, 7, [1, 4], true),
  };
}

/** Starts, re-levels or stops each sound's graph to match the faders. */
function sync(ramp = 0.25) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const { k } of SOUNDS) {
    const v = playing ? (levels[k] / 100) ** 1.7 * 2.6 : 0; // curved: the fader feels even to the ear
    if (v > 0 && !live[k]) {
      const out = gain(0);
      out.connect(master);
      made = [];
      BUILD[k](out);
      live[k] = { out, nodes: made };
    }
    const ch = live[k];
    if (!ch) continue;
    clearTimeout(ch.stopper);
    ch.out.gain.cancelScheduledValues(now);
    ch.out.gain.setValueAtTime(ch.out.gain.value, now);
    ch.out.gain.linearRampToValueAtTime(v, now + ramp);
    // a sound turned all the way down is taken apart, so it costs nothing
    if (v === 0) ch.stopper = setTimeout(() => { for (const n of ch.nodes) try { n.stop(); } catch { } ch.out.disconnect(); delete live[k]; }, (ramp + 0.1) * 1000);
  }
}

async function setPlaying(on) {
  if (on && !SOUNDS.some((s) => levels[s.k] > 0)) { levels.rain = 50; save(); }
  ensureAudio();
  playing = on;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  if (on) {
    await ctx.resume();
    sync(0.05);
    master.gain.linearRampToValueAtTime(0.9, now + 1.5); // fade in
    if (timerMin) endsAt = Date.now() + timerMin * 60e3;
  } else {
    master.gain.linearRampToValueAtTime(0, now + 0.8); // fade out, then let the sound card rest
    setTimeout(() => { if (!playing) { sync(0); ctx.suspend(); } }, 900);
  }
  render();
}

// ───────────────────────── faces ─────────────────────────

$("mixer").innerHTML = SOUNDS.map((s) => `
  <div class="ch" data-k="${s.k}">
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg>
    <span class="nm">${t(s.name)}</span>
    <div class="fader" data-k="${s.k}" role="slider" tabindex="0" aria-label="${t(s.name)}" aria-valuemin="0" aria-valuemax="100" data-no-drag>
      <i class="fill"></i><b class="knob"></b>
    </div>
    <span class="val w-num"></span>
  </div>`).join("");

const PLAY = '<path d="M7.5 4.8v14.4L19.5 12z"/>';
const PAUSE = '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>';

function render() {
  document.body.classList.toggle("playing", playing);
  $("play-icon").innerHTML = playing ? PAUSE : PLAY;
  $("play").title = playing ? t({ "zh-TW": "暫停", "zh-CN": "暂停", en: "Pause" }) : t({ "zh-TW": "播放", "zh-CN": "播放", en: "Play" });
  const on = SOUNDS.filter((s) => levels[s.k] > 0).map((s) => t(s.name));
  $("status").textContent = !on.length ? t({ "zh-TW": "把想聽的聲音推上去", "zh-CN": "把想听的声音推上去", en: "Raise a sound to play it" })
    : playing ? on.join(" · ") : t({ "zh-TW": "已暫停", "zh-CN": "已暂停", en: "Paused" });
  for (const ch of $("mixer").children) {
    const v = levels[ch.dataset.k];
    ch.classList.toggle("on", v > 0);
    ch.style.setProperty("--v", v / 100);
    ch.querySelector(".val").textContent = v;
    ch.querySelector(".fader").setAttribute("aria-valuenow", v);
  }
  renderTimer();
}

function renderTimer() {
  const left = timerMin && playing ? Math.max(0, endsAt - Date.now()) : 0;
  $("timer").classList.toggle("set", !!timerMin);
  $("timer-text").textContent = !timerMin ? "" : playing
    ? `${Math.floor(left / 60e3)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`
    : t({ "zh-TW": `${timerMin} 分`, "zh-CN": `${timerMin} 分`, en: `${timerMin} min` });
  $("timer").title = timerMin ? t({ "zh-TW": `${timerMin} 分鐘後停止（按一下換時間）`, "zh-CN": `${timerMin} 分钟后停止（按一下换时间）`, en: `Stops after ${timerMin} min (click to change)` })
    : t({ "zh-TW": "定時停止", "zh-CN": "定时停止", en: "Sleep timer" });
  clearInterval(tick);
  if (timerMin && playing) tick = setInterval(() => {
    if (Date.now() >= endsAt) { timerMin = 0; save(); setPlaying(false); return; }
    renderTimer();
  }, 1000);
}

function save() { widget.storage.set("mix", { levels, timer: timerMin }); }

function setLevel(k, v) {
  levels[k] = Math.max(0, Math.min(100, Math.round(v)));
  if (!playing && levels[k] > 0) setPlaying(true); // raising a sound plays it
  else { sync(); render(); }
  save();
}

// faders: vertical in the instrument theme, across in the others
let drag = null;
function fromPointer(el, e) {
  const r = el.getBoundingClientRect();
  return r.height > r.width ? (1 - (e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
}
$("mixer").addEventListener("pointerdown", (e) => {
  const f = e.target.closest(".fader");
  if (!f || e.button !== 0) return;
  drag = f;
  f.setPointerCapture(e.pointerId);
  setLevel(f.dataset.k, fromPointer(f, e));
});
$("mixer").addEventListener("pointermove", (e) => { if (drag) setLevel(drag.dataset.k, fromPointer(drag, e)); });
$("mixer").addEventListener("pointerup", () => { drag = null; });
$("mixer").addEventListener("wheel", (e) => {
  const ch = e.target.closest(".ch");
  if (!ch) return;
  e.preventDefault();
  setLevel(ch.dataset.k, levels[ch.dataset.k] + (e.deltaY < 0 ? 5 : -5));
}, { passive: false });
$("mixer").addEventListener("keydown", (e) => {
  const f = e.target.closest(".fader");
  if (!f) return;
  const d = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 }[e.key];
  if (d) { e.preventDefault(); setLevel(f.dataset.k, levels[f.dataset.k] + d); }
});
// clicking a sound's icon or name turns it on or off
$("mixer").addEventListener("click", (e) => {
  const lab = e.target.closest(".ic, .nm");
  if (!lab) return;
  const k = lab.closest(".ch").dataset.k;
  if (levels[k] > 0) { widget.storage.set(`was-${k}`, levels[k]); setLevel(k, 0); }
  else widget.storage.get(`was-${k}`).then((v) => setLevel(k, v || 50));
});

$("play").onclick = () => setPlaying(!playing);
$("timer").onclick = () => {
  timerMin = TIMERS[(TIMERS.indexOf(timerMin) + 1) % TIMERS.length];
  endsAt = Date.now() + timerMin * 60e3;
  save();
  render();
};

(async () => {
  const m = await widget.storage.get("mix");
  if (m && m.levels) { levels = { ...levels, ...m.levels }; timerMin = m.timer || 0; }
  render(); // it never starts by itself: sound out of nowhere at login would be unkind
})();
