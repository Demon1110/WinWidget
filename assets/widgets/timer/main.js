const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
const PRESETS = [1, 3, 5, 10, 15, 30, 45, 60];

/** Both tools' state; saved after every change, so a reload or restart carries on. */
let S = {
  mode: "cd",
  cd: { duration: 5 * MIN, remaining: 5 * MIN, running: false, endsAt: 0, done: false },
  sw: { running: false, startedAt: 0, elapsed: 0, laps: [] },
};
const save = () => widget.storage.set("state", S);

// ── formatting ──
const two = (n) => String(n).padStart(2, "0");
function clock(ms, tenths) {
  const total = tenths ? Math.floor(ms / 100) : Math.ceil(ms / SEC);
  const s = tenths ? Math.floor(total / 10) : total;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const body = h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
  return tenths ? `${body}<small>.${total % 10}</small>` : body;
}
function spoken(ms) {
  const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN), s = Math.round((ms % MIN) / SEC);
  const parts = [];
  if (h) parts.push(t({ "zh-TW": `${h} 小時`, "zh-CN": `${h} 小时`, en: `${h} h` }));
  if (m) parts.push(t({ "zh-TW": `${m} 分鐘`, "zh-CN": `${m} 分钟`, en: `${m} min` }));
  if (s || !parts.length) parts.push(t({ "zh-TW": `${s} 秒`, "zh-CN": `${s} 秒`, en: `${s} s` }));
  return parts.join(t({ zh: " ", en: " " }));
}

// ── countdown ──
const cdLeft = () => (S.cd.running ? Math.max(0, S.cd.endsAt - Date.now()) : S.cd.remaining);

let booking = Promise.resolve();
function book() {
  booking = booking.then(async () => {
    try {
      await widget.notify.cancel("cd");
      if (S.cd.running && opts.notify !== false) {
        await widget.notify({
          title: t({ "zh-TW": "計時器", "zh-CN": "计时器", en: "Timer" }),
          body: t({ "zh-TW": `${spoken(S.cd.duration)}倒數結束`, "zh-CN": `${spoken(S.cd.duration)}倒计时结束`, en: `${spoken(S.cd.duration)} is up` }),
          at: S.cd.endsAt, tag: "cd",
        });
      }
    } catch (e) { widget.log(`timer: ${e.message}`); }
  });
}

function cdStart() { S.cd.running = true; S.cd.done = false; S.cd.endsAt = Date.now() + S.cd.remaining; save(); book(); loop(); }
function cdPause() { S.cd.remaining = cdLeft(); S.cd.running = false; save(); book(); loop(); }
function cdReset() { S.cd.running = false; S.cd.done = false; S.cd.remaining = S.cd.duration; save(); book(); loop(); }
const LONGEST = 24 * HOUR - SEC; // 23:59:59
function cdSet(ms) {
  ms = Math.min(Math.max(ms, SEC), LONGEST);
  S.cd = { duration: ms, remaining: ms, running: false, endsAt: 0, done: false };
  save(); book(); loop();
}

function cdCheck() {
  if (!S.cd.running || Date.now() < S.cd.endsAt) return;
  const late = Date.now() - S.cd.endsAt;
  S.cd.running = false; S.cd.remaining = 0; S.cd.done = true;
  save();
  if (opts.sound !== false && late < 30 * SEC) chime();
}

/** "90" = 90 minutes, "5:30" = 5 min 30 s, "1:05:00" = 1 h 5 min. Anything else (a fourth part,
 *  an empty part, 60 or more minutes or seconds after the first part, zero) is null. */
function parse(text) {
  const parts = text.trim().replace(/[：.]/g, ":").split(":").map((x) => x.trim());
  if (parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const n = parts.map(Number);
  if (n.slice(1).some((x) => x >= 60)) return null;
  const ms = n.length === 1 ? n[0] * MIN : n.length === 2 ? n[0] * MIN + n[1] * SEC : n[0] * HOUR + n[1] * MIN + n[2] * SEC;
  return ms > 0 ? ms : null;
}

function editTime() {
  if (S.cd.running || S.cd.done) return;
  const box = $("cd-edit");
  box.value = clock(S.cd.duration).replace(/<[^>]+>/g, "");
  box.hidden = false;
  $("cd-time").hidden = true;
  box.focus();
  box.select();
}
/** apply: Enter keeps the box open on a time it can't read and says why; leaving the box drops it. */
function endEdit(apply, leaving = false) {
  const box = $("cd-edit");
  if (box.hidden) return;
  let ms = apply ? parse(box.value) : null;
  // longer than the timer goes: say so instead of quietly cutting it short
  const tooLong = ms !== null && ms > LONGEST;
  if (tooLong) ms = null;
  if (apply && ms === null && !leaving) {
    box.classList.add("bad");
    box.setAttribute("aria-invalid", "true");
    $("cd-hint").textContent = tooLong
      ? t({ "zh-TW": "最長 23:59:59", "zh-CN": "最长 23:59:59", en: "23:59:59 at most" })
      : t({ "zh-TW": "寫成 分鐘、分:秒 或 時:分:秒", "zh-CN": "写成 分钟、分:秒 或 时:分:秒", en: "Use minutes, m:ss or h:mm:ss" });
    $("cd-hint").hidden = false;
    box.select();
    return;
  }
  clearBad();
  box.hidden = true;
  $("cd-time").hidden = false;
  if (ms) cdSet(ms); else render();
}

// ── stopwatch ──
const swNow = () => (S.sw.running ? S.sw.elapsed + (Date.now() - S.sw.startedAt) : S.sw.elapsed);
function swMain() {
  if (S.sw.running) { S.sw.elapsed = swNow(); S.sw.running = false; }
  else { S.sw.startedAt = Date.now(); S.sw.running = true; }
  save(); loop();
}
function swSecond() {
  if (S.sw.running) S.sw.laps.push(swNow());
  else { S.sw.elapsed = 0; S.sw.laps = []; }
  save(); loop();
}

// ── drawing ──
function render() {
  document.body.dataset.mode = S.mode;
  $("cd").hidden = S.mode !== "cd";
  $("sw").hidden = S.mode !== "sw";
  $("m-cd").classList.toggle("on", S.mode === "cd");
  $("m-sw").classList.toggle("on", S.mode === "sw");
  // a dot on the other tab while it is running
  $("m-cd").classList.toggle("busy", S.mode !== "cd" && S.cd.running);
  $("m-sw").classList.toggle("busy", S.mode !== "sw" && S.sw.running);

  const c = S.cd, left = cdLeft();
  const idle = !c.running && !c.done && left >= c.duration;
  document.body.classList.toggle("cd-idle", idle);
  document.body.classList.toggle("cd-done", c.done);
  document.body.classList.toggle("cd-running", c.running);
  $("cd-time").innerHTML = c.done ? t({ "zh-TW": "時間到", "zh-CN": "时间到", en: "Time's up" }) : clock(left);
  $("cd-time").title = idle ? t({ "zh-TW": "按一下輸入時間", "zh-CN": "点一下输入时间", en: "Click to type a time" }) : "";
  document.body.classList.toggle("cd-paused", !c.running && !c.done && !idle);
  if (c.running) {
    const end = new Intl.DateTimeFormat(widget.locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(c.endsAt);
    $("cd-ends").textContent = t({ "zh-TW": `${end} 結束`, "zh-CN": `${end} 结束`, en: `Ends at ${end}` });
  } else $("cd-ends").textContent = t({ "zh-TW": "已暫停", "zh-CN": "已暂停", en: "Paused" });
  $("cd-bar").style.width = `${((c.done ? 0 : left / c.duration) * 100).toFixed(2)}%`;
  $("presets").innerHTML = PRESETS.map((m) => `<button class="w-btn${c.duration === m * MIN ? " on" : ""}" data-min="${m}">${
    m === 60 ? t({ "zh-TW": "1 小時", "zh-CN": "1 小时", en: "1 h" }) : t({ "zh-TW": `${m} 分`, "zh-CN": `${m} 分`, en: `${m} min` })}</button>`).join("");
  $("cd-main").textContent = c.done ? t({ "zh-TW": "好", "zh-CN": "好", en: "OK" })
    : c.running ? t({ "zh-TW": "暫停", "zh-CN": "暂停", en: "Pause" })
    : idle ? t({ "zh-TW": "開始", "zh-CN": "开始", en: "Start" }) : t({ "zh-TW": "繼續", "zh-CN": "继续", en: "Resume" });
  $("cd-reset").hidden = idle || c.done;

  const sw = S.sw, now = swNow();
  $("sw-time").innerHTML = clock(now, true);
  $("sw-main").textContent = sw.running ? t({ "zh-TW": "暫停", "zh-CN": "暂停", en: "Stop" })
    : now ? t({ "zh-TW": "繼續", "zh-CN": "继续", en: "Resume" }) : t({ "zh-TW": "開始", "zh-CN": "开始", en: "Start" });
  $("sw-second").textContent = sw.running ? t({ "zh-TW": "計次", "zh-CN": "计次", en: "Lap" }) : t({ "zh-TW": "重設", "zh-CN": "重置", en: "Reset" });
  $("sw-second").hidden = !sw.running && !now;
  renderLaps(now);
}

function renderLaps(now) {
  const laps = S.sw.laps;
  if (!laps.length) { $("laps").innerHTML = ""; return; }
  const splits = laps.map((v, i) => v - (i ? laps[i - 1] : 0));
  const fast = splits.length > 2 ? Math.min(...splits) : -1, slow = splits.length > 2 ? Math.max(...splits) : -1;
  // the lap in progress first, then finished ones, newest at the top
  const rows = [`<li class="cur"><span>${t({ "zh-TW": `第 ${laps.length + 1} 圈`, "zh-CN": `第 ${laps.length + 1} 圈`, en: `Lap ${laps.length + 1}` })}</span>
    <span class="w-num">${clock(now - laps[laps.length - 1], true)}</span></li>`];
  for (let i = laps.length - 1; i >= 0; i--) {
    const cls = splits[i] === fast ? "fast" : splits[i] === slow ? "slow" : "";
    rows.push(`<li class="${cls}"><span>${t({ "zh-TW": `第 ${i + 1} 圈`, "zh-CN": `第 ${i + 1} 圈`, en: `Lap ${i + 1}` })}</span>
      <span class="w-num">${clock(splits[i], true)}</span></li>`);
  }
  $("laps").innerHTML = rows.join("");
}

/** A soft two-note bell, made on the spot. */
function chime() {
  try {
    const ctx = new AudioContext();
    [[988, 0], [1318.5, 0.16], [988, 0.32], [1318.5, 0.48]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + at);
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 1.1);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 1.2);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* no audio device */ }
}

/** Redraws as often as what's running needs: tenths for the stopwatch, seconds for the countdown. */
let timer = 0;
function loop() {
  clearTimeout(timer);
  cdCheck();
  render();
  const waits = [];
  if (S.sw.running && S.mode === "sw") waits.push(100);
  if (S.sw.running) waits.push(SEC);
  if (S.cd.running) waits.push((cdLeft() % SEC || SEC) + 15);
  if (waits.length) timer = setTimeout(loop, Math.min(...waits));
}

// ── events ──
$("m-cd").textContent = t({ "zh-TW": "倒數", "zh-CN": "倒计时", en: "Timer" });
$("m-sw").textContent = t({ "zh-TW": "碼錶", "zh-CN": "秒表", en: "Stopwatch" });
$("modes").onclick = (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b || S.mode === b.dataset.mode) return;
  endEdit(false);
  S.mode = b.dataset.mode;
  save(); loop();
};
$("presets").onclick = (e) => { const b = e.target.closest("button[data-min]"); if (b) cdSet(+b.dataset.min * MIN); };
$("cd-main").onclick = () => (S.cd.done ? cdReset() : S.cd.running ? cdPause() : cdStart());
$("cd-reset").onclick = cdReset;
$("cd-time").onclick = editTime;
$("cd-time").onkeydown = (e) => { if (e.key === "Enter") editTime(); };
$("cd-edit").onkeydown = (e) => {
  if (e.key === "Enter") { e.preventDefault(); endEdit(true); }
  if (e.key === "Escape") endEdit(false);
};
$("cd-edit").onblur = () => endEdit(true, true);
$("cd-edit").oninput = () => clearBad();
function clearBad() {
  $("cd-edit").classList.remove("bad");
  $("cd-edit").removeAttribute("aria-invalid");
  $("cd-hint").hidden = true;
}
$("sw-main").onclick = swMain;
$("sw-second").onclick = swSecond;

widget.settings.onChange((s) => { opts = s; book(); });
widget.appearance.onChange(render);
widget.storage.get("state").then((saved) => {
  if (saved && saved.cd && saved.sw) S = { ...S, ...saved };
  cdCheck();
  book();
  loop();
});
