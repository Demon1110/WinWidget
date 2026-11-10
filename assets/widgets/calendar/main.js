const $ = (id) => document.getElementById(id);
let opts = widget.settings.get();
let shown = null; // first day of the month on screen; null = this month

const DAYS = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

const zh = widget.locale.toLowerCase().startsWith("zh");
const hans = /^zh-(cn|sg|hans)/i.test(widget.locale);
const lunarFmt = zh ? new Intl.DateTimeFormat(hans ? "zh-CN-u-ca-chinese" : "zh-TW-u-ca-chinese", { month: "long", day: "numeric" }) : null;

/** { month: "九月", day: "廿三", text } — the 1st of a lunar month shows the month's name. */
function lunar(d) {
  if (!lunarFmt) return null;
  const p = Object.fromEntries(lunarFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const day = DAYS[+p.day - 1] || p.day;
  return { month: p.month, day, cell: +p.day === 1 ? p.month : day };
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function render() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = shown || new Date(today.getFullYear(), today.getMonth(), 1);
  const loc = widget.locale;
  const mondayFirst = opts.weekStart !== "sunday";
  const showLunar = zh && opts.showLunar !== false;
  document.body.classList.toggle("no-lunar", !showLunar);

  // header: today, and the month on screen
  $("dnum").textContent = today.getDate();
  $("wk").textContent = new Intl.DateTimeFormat(loc, widget.theme === "type"
    ? { weekday: "long", month: "long" } : { weekday: "short", month: "long", day: "numeric" }).format(today);
  const lu = showLunar ? lunar(today) : null;
  $("lunar").textContent = lu ? `${widget.t({ "zh-TW": "農曆", "zh-CN": "农历" })}${lu.month}${lu.day}` : "";
  $("month").textContent = widget.theme === "paper"
    ? new Intl.DateTimeFormat(loc, { year: "numeric", month: "long" }).format(first)
    : `${first.getFullYear()}.${String(first.getMonth() + 1).padStart(2, "0")}`;
  $("month").title = widget.t({ "zh-TW": "回到本月", "zh-CN": "回到本月", en: "Back to this month" });

  // how much of this month has gone by
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  $("prog").style.width = `${((today.getDate() - 0.5) / daysInMonth) * 100}%`;

  // grid: weekday names, then just enough weeks to cover the month
  const names = [];
  const base = new Date(2024, 0, mondayFirst ? 1 : 7); // a Monday / a Sunday
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    names.push(`<span class="h${d.getDay() === 0 ? " sun" : ""}">${new Intl.DateTimeFormat(loc, { weekday: "narrow" }).format(d)}</span>`);
  }
  const offset = (first.getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
  const start = new Date(first); start.setDate(1 - offset);
  const monthDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + monthDays) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const cls = ["c",
      d.getMonth() !== first.getMonth() ? "out" : "",
      sameDay(d, today) ? "today" : d < today ? "past" : "",
      d.getDay() === 0 ? "sun" : ""].join(" ");
    const l = showLunar ? lunar(d) : null;
    cells.push(`<div class="${cls}"><b>${d.getDate()}</b>${l ? `<small>${l.cell}</small>` : ""}</div>`);
  }
  $("grid").innerHTML = names.join("") + cells.join("");
  $("grid").style.gridTemplateRows = `auto repeat(${weeks}, 1fr)`;
}

function move(delta) {
  const base = shown || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  shown = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  render();
}

$("prev").onclick = () => move(-1);
$("next").onclick = () => move(1);
$("month").onclick = () => { shown = null; render(); };

// Re-render just after midnight, and whenever settings or theme change.
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { render(); scheduleMidnight(); }, next - now);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
render();
scheduleMidnight();
