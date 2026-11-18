const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let days = {};                // { "2026-11-18": 6 }
let armAt = 0;                // when the next nudge is booked

const goal = () => Math.max(1, Math.round(Number(widget.settings.get("goal")) || 8));
const cupMl = () => Math.max(50, Math.round(Number(widget.settings.get("cup")) || 250));
const remindMin = () => Math.max(0, Math.round(Number(widget.settings.get("remind")) || 60));

const dayKey = (d) => {
  const x = d || new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const today = () => Math.max(0, Math.round(Number(days[dayKey()]) || 0));

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
}

function save() {
  // keep two weeks so the file stays tiny
  const keys = Object.keys(days).sort().slice(-14);
  const trimmed = {};
  for (const k of keys) trimmed[k] = days[k];
  days = trimmed;
  widget.storage.set("days", days).catch(() => {});
}

const drop = (on) => `<svg viewBox="0 0 24 24" class="drop${on ? " is-on" : ""}" data-no-drag>
  <path d="M12 3.5c3.6 3.9 5.5 6.7 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2.8 1.9-5.6 5.5-9.5z"/></svg>`;

function renderRow() {
  const n = goal();
  const got = today();
  let html = "";
  for (let i = 0; i < n; i++) html += drop(i < got);
  $("row").innerHTML = html;
  $("row").style.gridTemplateColumns = `repeat(${Math.min(n, 8)}, 1fr)`;
}

function render() {
  const n = goal();
  const got = today();
  const done = got >= n;
  $("cups").textContent = String(got);
  $("goal").textContent = `${got} / ${n}`;
  $("sub").textContent = `${got * cupMl()} ml / ${n * cupMl()} ml`;
  $("plus").textContent = L("＋1 杯", "＋1 杯", "+1 cup");
  renderRow();

  const left = n - got;
  if (done) {
    $("hint").textContent = L("今天達標了，別忘了收尾再喝一口", "今天达标了，别忘了收尾再喝一口", "Goal reached — a last sip is a bonus");
  } else if (remindMin() === 0) {
    $("hint").textContent = L(`還差 ${left} 杯，提醒已關閉`, `还差 ${left} 杯，提醒已关闭`, `${left} to go · reminders off`);
  } else {
    $("hint").textContent = L(`還差 ${left} 杯，每 ${remindMin()} 分鐘提醒`, `还差 ${left} 杯，每 ${remindMin()} 分钟提醒`, `${left} to go · nudge every ${remindMin()} min`);
  }
  arm();
}

// Notifications are booked ahead of time, so a closed-but-visible card still nudges.
function arm() {
  const min = remindMin();
  const done = today() >= goal();
  if (min <= 0 || done) {
    widget.notify.cancel("water").catch(() => {});
    armAt = 0;
    return;
  }
  armAt = Date.now() + min * 60 * 1000;
  try {
    widget.notify({
      title: L("喝水時間", "喝水时间", "Time for water"),
      body: L(`今天 ${today()}/${goal()} 杯，起來喝一杯吧`, `今天 ${today()}/${goal()} 杯，起来喝一杯吧`, `${today()}/${goal()} cups so far — take one now`),
      at: armAt,
      tag: "water",
    }).catch(() => {});
  } catch (e) {
    widget.log(`water: notify ${e.message}`);
  }
}

function addCup(delta) {
  const got = Math.max(0, today() + delta);
  days[dayKey()] = got;
  save();
  render();
  if (delta > 0) toast(L("記下了", "记下了", "Logged"));
}

$("title").textContent = L("飲水", "饮水", "Water");
$("plus").onclick = () => addCup(1);
$("minus").onclick = () => addCup(-1);
$("row").onclick = (e) => {
  const el = e.target.closest(".drop");
  if (!el) return;
  const idx = [...$("row").children].indexOf(el);
  if (idx >= 0) addCup(idx + 1 - today());
};

widget.settings.onChange(render);

// a once-a-minute tick just keeps the hint honest after midnight
setInterval(() => {
  if (!document.hidden) render();
}, 60000);

widget.storage.get("days").then((v) => {
  if (v && typeof v === "object") {
    days = {};
    for (const k of Object.keys(v)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = Math.max(0, Math.round(Number(v[k]) || 0));
  }
  render();
}).catch((e) => widget.log(`water: load ${e.message}`));

widget.on("summon", render);
