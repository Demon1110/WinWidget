const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const MIN = 6e4;

const NAMES = {
  focus: { "zh-TW": "專注", "zh-CN": "专注", en: "Focus" },
  short: { "zh-TW": "休息", "zh-CN": "休息", en: "Break" },
  long: { "zh-TW": "長休息", "zh-CN": "长休息", en: "Long break" },
};
const SEALS = { focus: { zh: "專", "zh-CN": "专", en: "F" }, short: { zh: "休", en: "B" }, long: { zh: "休", en: "B" } };

const minutes = (phase) => Math.max(1, Number(phase === "focus" ? opts.focus : phase === "short" ? opts.shortBreak : opts.longBreak) || 1);
const length = (phase) => minutes(phase) * MIN;
const every = () => Math.max(2, Number(opts.longEvery) || 4);
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const today = () => dayOf(Date.now());

/** The whole timer; saved after every change so a reload or a restart picks up where it was. */
let S = { phase: "focus", running: false, endsAt: 0, remaining: length("focus"), done: 0, day: today(), count: 0 };

const remaining = () => (S.running ? Math.max(0, S.endsAt - Date.now()) : S.remaining);
const save = () => widget.storage.set("state", S);

/** What follows a phase that just ended. */
function next(phase, done) {
  if (phase === "focus") {
    const d = done + 1;
    return { phase: d % every() === 0 ? "long" : "short", done: d, auto: !!opts.autoBreak };
  }
  return { phase: "focus", done: phase === "long" ? 0 : done, auto: !!opts.autoFocus };
}

function endMessage(ended, after, auto) {
  if (ended === "focus") {
    return auto
      ? t({ "zh-TW": `專注 ${minutes("focus")} 分鐘完成，休息 ${minutes(after)} 分鐘`, "zh-CN": `专注 ${minutes("focus")} 分钟完成，休息 ${minutes(after)} 分钟`, en: `${minutes("focus")} minutes of focus done. Take ${minutes(after)}.` })
      : t({ "zh-TW": `專注 ${minutes("focus")} 分鐘完成，可以休息了`, "zh-CN": `专注 ${minutes("focus")} 分钟完成，可以休息了`, en: `${minutes("focus")} minutes of focus done. Time for a break.` });
  }
  return auto
    ? t({ "zh-TW": "休息結束，下一輪專注開始", "zh-CN": "休息结束，下一轮专注开始", en: "Break's over. Next focus has started." })
    : t({ "zh-TW": "休息結束，準備開始專注", "zh-CN": "休息结束，准备开始专注", en: "Break's over. Ready to focus?" });
}

/** Books a notification for each phase end that will happen without the user, so they arrive on time
    even while this page is paused. Stops at the first phase that waits for a click. Calls run one
    after another, so a quick pause-and-resume can't leave an old booking behind. */
let booking = Promise.resolve();
const book = () => (booking = booking.then(bookNow));
async function bookNow() {
  try {
    await widget.notify.cancel();
    if (!S.running || opts.notify === false) return;
    let phase = S.phase, done = S.done, at = S.endsAt;
    for (let i = 0; i < 12; i++) {
      const n = next(phase, done);
      await widget.notify({ title: t({ "zh-TW": "番茄鐘", "zh-CN": "番茄钟", en: "Pomodoro" }), body: endMessage(phase, n.phase, n.auto), at, tag: `end${i}` });
      if (!n.auto) break;
      phase = n.phase; done = n.done; at += length(n.phase);
    }
  } catch (e) { widget.log(`pomodoro: ${e.message}`); }
}

/** Moves past every phase that has ended (several, if the page was asleep). */
function catchUp() {
  let changed = false, ended = 0;
  if (S.day !== today()) { S.day = today(); S.count = 0; changed = true; }
  while (S.running && Date.now() >= S.endsAt) {
    const n = next(S.phase, S.done);
    // counted on the day it ended: one that ended before midnight (the PC asleep overnight) isn't today's
    if (S.phase === "focus" && dayOf(S.endsAt) === S.day) S.count++;
    ended = S.endsAt;
    S.phase = n.phase; S.done = n.done;
    if (n.auto) S.endsAt = ended + length(n.phase);
    else { S.running = false; S.remaining = length(n.phase); }
    changed = true;
  }
  // a chime only for an end just now, not for one long past (the PC was asleep)
  if (ended && opts.sound !== false && Date.now() - ended < 30e3) chime();
  if (changed) save();
}

// ── controls ──
function start() { S.running = true; S.endsAt = Date.now() + S.remaining; save(); book(); tick(); }
function pause() { S.remaining = remaining(); S.running = false; save(); book(); tick(); }
function reset() { S.running = false; S.remaining = length(S.phase); save(); book(); tick(); }
function skip() {
  const n = next(S.phase, S.done);
  S.phase = n.phase; S.done = n.done; S.running = false; S.remaining = length(n.phase);
  save(); book(); tick();
}

$("main").onclick = () => (S.running ? pause() : start());
$("reset").onclick = reset;
$("skip").onclick = skip;

// ── drawing ──
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

function render() {
  const left = remaining();
  const full = length(S.phase);
  $("time").textContent = fmt(left);
  $("phase").textContent = t(NAMES[S.phase]);
  $("seal").textContent = t(SEALS[S.phase]);
  document.body.dataset.phase = S.phase;
  document.body.classList.toggle("running", S.running);
  // the ring empties as the phase runs out
  $("arc").style.strokeDashoffset = String(1000 * (1 - left / full));

  const n = every(), inCycle = S.done % n;
  $("cycle").innerHTML = Array.from({ length: n }, (_, i) =>
    `<i class="${i < inCycle ? "on" : i === inCycle && S.phase === "focus" ? "now" : ""}"></i>`).join("");
  $("today").textContent = t({ "zh-TW": `今天完成 ${S.count} 個`, "zh-CN": `今天完成 ${S.count} 个`, en: S.count === 1 ? "1 done today" : `${S.count} done today` });

  $("main").textContent = S.running ? t({ "zh-TW": "暫停", "zh-CN": "暂停", en: "Pause" })
    : left < full ? t({ "zh-TW": "繼續", "zh-CN": "继续", en: "Resume" })
    : S.phase === "focus" ? t({ "zh-TW": "開始專注", "zh-CN": "开始专注", en: "Start" }) : t({ "zh-TW": "開始休息", "zh-CN": "开始休息", en: "Start break" });
  // two buttons at most: pause + skip while running, resume + reset when paused, start + skip before
  const paused = !S.running && left < full;
  $("reset").hidden = !paused;
  $("skip").hidden = paused;
}

/** A soft two-note bell, made on the spot. */
function chime() {
  try {
    const ctx = new AudioContext();
    [[880, 0], [1318.5, 0.18]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + at);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 1.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 1.5);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch { /* no audio device */ }
}

/** Every second while running; otherwise once a minute, just to start a new day's count. */
let timer = 0;
function tick() {
  clearTimeout(timer);
  catchUp();
  render();
  timer = setTimeout(tick, S.running ? 1000 - (Date.now() % 1000) + 10 : 60e3);
}

$("reset").textContent = t({ "zh-TW": "重設", "zh-CN": "重置", en: "Reset" });
$("skip").textContent = t({ "zh-TW": "跳過", "zh-CN": "跳过", en: "Skip" });

widget.settings.onChange((s) => {
  const old = length(S.phase);
  opts = s;
  // a new length applies at once if this phase hasn't started yet
  if (!S.running && S.remaining === old) S.remaining = length(S.phase);
  save(); book(); tick();
});
widget.appearance.onChange(render);

widget.storage.get("state").then((saved) => {
  if (saved && typeof saved === "object" && NAMES[saved.phase]) S = { ...S, ...saved };
  catchUp();
  book();
  tick();
});
