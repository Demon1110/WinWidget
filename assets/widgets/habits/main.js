const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let habits = [];   // { id, name, done: ["2026-11-02", …] }
let editing = false;
const MAX = 8;

const DEFAULTS = [
  { "zh-TW": "喝八杯水", "zh-CN": "喝八杯水", en: "Eight glasses of water" },
  { "zh-TW": "運動 30 分鐘", "zh-CN": "运动 30 分钟", en: "30 minutes of exercise" },
  { "zh-TW": "讀書", "zh-CN": "读书", en: "Read" },
];

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const save = () => widget.storage.set("habits", habits);

/** Days in a row up to today (or up to yesterday, if today isn't ticked yet). */
function streak(h) {
  const set = new Set(h.done);
  let d = new Date();
  if (!set.has(dayKey(d))) d = shift(d, -1);
  let n = 0;
  while (set.has(dayKey(d))) { n++; d = shift(d, -1); }
  return n;
}

/** Keeps the last year, plus every day of the newest unbroken run, however long: the streak is
 *  counted from these days, so cutting into the run would cap it (it stopped at 367). */
function prune(days) {
  const set = new Set(days);
  const keep = new Set();
  const newest = [...set].sort().pop();
  if (newest) {
    const [y, m, d] = newest.split("-").map(Number);
    for (let day = new Date(y, m - 1, d); set.has(dayKey(day)); day = shift(day, -1)) keep.add(dayKey(day));
  }
  const cut = dayKey(shift(new Date(), -366));
  return [...set].filter((d) => d >= cut || keep.has(d)).sort();
}

function render() {
  const now = new Date();
  const today = dayKey(now);
  const days = Number(opts.days) || 14;
  const doneToday = habits.filter((h) => h.done.includes(today)).length;
  document.body.classList.toggle("editing", editing);
  $("today").textContent = new Intl.DateTimeFormat(widget.locale, { month: "long", day: "numeric", weekday: "short" }).format(now);
  $("sum").textContent = habits.length
    ? t({ "zh-TW": `今天 ${doneToday} / ${habits.length}`, "zh-CN": `今天 ${doneToday} / ${habits.length}`, en: `Today ${doneToday} / ${habits.length}` }) : "";
  $("list").style.setProperty("--days", days);
  $("list").innerHTML = habits.map((h, i) => {
    const set = new Set(h.done);
    const on = set.has(today);
    const s = streak(h);
    const cells = Array.from({ length: days }, (_, k) => {
      const d = shift(now, k - days + 1);
      const key = dayKey(d);
      const cls = [set.has(key) ? "on" : "", key === today ? "now" : "", d.getDay() === 1 ? "mon" : ""].join(" ");
      return `<i class="${cls}" title="${key}"></i>`;
    }).join("");
    return `<li class="habit${on ? " is-done" : ""}">
      <button class="w-check tick" data-i="${i}" aria-pressed="${on}" data-no-drag aria-label="${esc(h.name)}"></button>
      <span class="name">${esc(h.name)}</span>
      <span class="streak${s >= 3 ? " hot" : ""}">${s ? t({ "zh-TW": `連續 ${s} 天`, "zh-CN": `连续 ${s} 天`, en: s === 1 ? "1 day" : `${s} days` }) : ""}</span>
      <span class="cells">${cells}</span>
      ${editing ? `<button class="w-btn x" data-x="${i}" data-no-drag>${esc(t({ "zh-TW": "刪除", "zh-CN": "删除", en: "Delete" }))}</button>` : ""}
    </li>`;
  }).join("") || `<li class="empty">${esc(t({ "zh-TW": "按「編輯」加入想每天做的事", "zh-CN": "点“编辑”添加想每天做的事", en: "Click Edit to add something to do every day" }))}</li>`;
  $("edit").textContent = editing ? t({ "zh-TW": "完成", "zh-CN": "完成", en: "Done" }) : t({ "zh-TW": "編輯", "zh-CN": "编辑", en: "Edit" });
  $("edit").classList.toggle("is-primary", editing);
  $("add").hidden = !editing || habits.length >= MAX;
}

$("list").addEventListener("click", (e) => {
  const tick = e.target.closest(".tick");
  if (tick) {
    const h = habits[+tick.dataset.i];
    const key = dayKey(new Date());
    h.done = prune(h.done.includes(key) ? h.done.filter((d) => d !== key) : [...h.done, key]);
    save();
    render();
    if (h.done.includes(key)) {
      const box = $("list").children[+tick.dataset.i].querySelector(".tick");
      box.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(0.3, 1.45, 0.5, 1)" });
    }
    return;
  }
  const x = e.target.closest("[data-x]");
  if (x) { habits.splice(+x.dataset.x, 1); save(); render(); }
});

$("edit").onclick = () => { editing = !editing; render(); if (editing) $("new").focus(); };
$("add").onsubmit = (e) => {
  e.preventDefault();
  const name = $("new").value.trim();
  if (!name || habits.length >= MAX) return;
  habits.push({ id: Math.random().toString(36).slice(2, 10), name, done: [] });
  $("new").value = "";
  save();
  render();
  $("new").focus();
};
$("new").placeholder = t({ "zh-TW": "新的習慣，例如 早睡", "zh-CN": "新的习惯，例如 早睡", en: "A new habit, e.g. Sleep early" });
$("add-ok").textContent = t({ "zh-TW": "加入", "zh-CN": "添加", en: "Add" });

/** A new day: today's boxes start empty. */
function scheduleMidnight() {
  const now = new Date();
  setTimeout(() => { render(); scheduleMidnight(); }, shift(now, 1) - now + 2000);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
widget.storage.get("habits").then((saved) => {
  habits = Array.isArray(saved) ? saved : DEFAULTS.map((n, i) => ({ id: `d${i}`, name: t(n), done: [] }));
  if (!Array.isArray(saved)) save();
  render();
  scheduleMidnight();
});
