const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
let opts = widget.settings.get();

$("ticks").innerHTML = "<i></i>".repeat(24);

/** Wall-clock parts in the chosen time zone. */
function partsNow() {
  const zone = opts.timezone && opts.timezone !== "local" ? opts.timezone : undefined;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  // A date object whose *local* fields match the zone's wall clock, for formatting.
  const wall = new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { h: +p.hour, m: +p.minute, s: +p.second, wall };
}

function dayOfYear(d) {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

function zoneLabel() {
  if (!opts.timezone || opts.timezone === "local") return "";
  const names = {
    "Asia/Taipei": { "zh-TW": "台北", "zh-CN": "台北", en: "Taipei" },
    "Asia/Shanghai": { "zh-TW": "上海", "zh-CN": "上海", en: "Shanghai" },
    "Asia/Hong_Kong": { "zh-TW": "香港", "zh-CN": "香港", en: "Hong Kong" },
    "Asia/Tokyo": { "zh-TW": "東京", "zh-CN": "东京", en: "Tokyo" },
    "Asia/Singapore": { "zh-TW": "新加坡", "zh-CN": "新加坡", en: "Singapore" },
    "Europe/London": { "zh-TW": "倫敦", "zh-CN": "伦敦", en: "London" },
    "Europe/Paris": { "zh-TW": "巴黎", "zh-CN": "巴黎", en: "Paris" },
    "America/New_York": { "zh-TW": "紐約", "zh-CN": "纽约", en: "New York" },
    "America/Los_Angeles": { "zh-TW": "洛杉磯", "zh-CN": "洛杉矶", en: "Los Angeles" },
    "Australia/Sydney": { "zh-TW": "雪梨", "zh-CN": "悉尼", en: "Sydney" },
  };
  return names[opts.timezone] ? widget.t(names[opts.timezone]) : opts.timezone;
}

function render() {
  const { h, m, s, wall } = partsNow();
  const loc = widget.locale;
  let hour = h;
  if (!opts.use24h) hour = h % 12 || 12;
  $("hh").textContent = opts.use24h ? pad(hour) : String(hour);
  $("mm").textContent = pad(m);
  $("sec").textContent = opts.showSeconds ? pad(s) : "";
  $("ampm").textContent = opts.use24h ? "" : h < 12 ? widget.t({ zh: "上午", en: "AM" }) : widget.t({ zh: "下午", en: "PM" });

  const zone = zoneLabel();
  const weekday = new Intl.DateTimeFormat(loc, { weekday: "short" }).format(wall);
  const monthDay = new Intl.DateTimeFormat(loc, { month: "long", day: "numeric" }).format(wall);
  const full = new Intl.DateTimeFormat(loc, { year: "numeric", month: "long", day: "numeric" }).format(wall);
  const theme = widget.theme;
  const date = theme === "paper" ? full : theme === "type" ? `${weekday} · ${monthDay}` : `${weekday} ${monthDay}`;
  $("date").textContent = zone ? `${zone} · ${date}` : date;

  // The seal holds the weekday's last character in Chinese (日, 一 …), the short name otherwise.
  $("seal").textContent = loc.startsWith("zh") ? weekday.slice(-1) : weekday.slice(0, 2);
  $("seal").classList.toggle("latin", !loc.startsWith("zh"));
  $("foot").innerHTML = widget.t({
    "zh-TW": `<span>第 ${dayOfYear(wall)} 天</span><span>第 ${isoWeek(wall)} 週</span>`,
    "zh-CN": `<span>第 ${dayOfYear(wall)} 天</span><span>第 ${isoWeek(wall)} 周</span>`,
    en: `<span>Day ${dayOfYear(wall)}</span><span>Week ${isoWeek(wall)}</span>`,
  });

  const cells = $("ticks").children;
  for (let i = 0; i < 24; i++) cells[i].className = i < h ? "past" : i === h ? "now" : "";
  document.body.classList.toggle("no-date", !opts.showDate);
}

// Tick exactly on the second so the display never lags.
function schedule() {
  render();
  setTimeout(schedule, 1000 - (Date.now() % 1000) + 5);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
schedule();
