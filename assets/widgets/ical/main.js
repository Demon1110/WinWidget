const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let events = [];       // { start, end, allDay, title, where, repeat }
let loading = false;
let timer = 0;
let status = "";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const urlSetting = () => String(widget.settings.get("url") || "").trim();
const daysAhead = () => Math.max(1, Math.round(Number(widget.settings.get("days")) || 7));
const maxCount = () => Math.max(4, Math.round(Number(widget.settings.get("max")) || 12));

const pad = (n) => String(n).padStart(2, "0");
const dayStamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function unescapeText(v) {
  return String(v || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// CF unfolds by joining a line that starts with a space or tab to the previous one.
function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start != null) out.push({
        start: cur.start,
        end: cur.end != null ? cur.end : cur.start,
        allDay: !!cur.allDay,
        title: cur.title || L("未命名行程", "未命名行程", "Untitled event"),
        where: cur.where || "",
        repeat: !!cur.repeat,
        stamp: cur.stamp || 0,
      });
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(";")[0].toUpperCase();
    const params = left.toUpperCase();

    if (name === "DTSTART" || name === "DTEND") {
      const parsed = parseWhen(value, params);
      if (!parsed) continue;
      if (name === "DTSTART") { cur.start = parsed.at; cur.allDay = parsed.allDay; }
      else cur.end = parsed.at;
    } else if (name === "SUMMARY") {
      cur.title = unescapeText(value).replace(/\s+/g, " ");
    } else if (name === "LOCATION") {
      cur.where = unescapeText(value).replace(/\s+/g, " ");
    } else if (name === "RRULE") {
      cur.repeat = true;
    } else if (name === "DTSTAMP") {
      const p = parseWhen(value, "Z");
      if (p) cur.stamp = p.at;
    }
  }
  return out;
}

function parseWhen(value, params) {
  const v = String(value || "").trim();
  const allDay = /VALUE=DATE($|;)/.test(params) || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (allDay || m[4] === undefined) {
    return { at: new Date(y, mo - 1, d).getTime(), allDay: true };
  }
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6]);
  if (m[7]) return { at: Date.UTC(y, mo - 1, d, hh, mi, ss), allDay: false };
  // TZID is ignored on purpose: the card shows the times the file carries.
  return { at: new Date(y, mo - 1, d, hh, mi, ss).getTime(), allDay: false };
}

function groupTitle(ms) {
  const today = dayStamp(Date.now());
  const tomorrow = dayStamp(Date.now() + 86400000);
  const key = dayStamp(ms);
  if (key === today) return L("今天", "今天", "Today");
  if (key === tomorrow) return L("明天", "明天", "Tomorrow");
  const d = new Date(ms);
  const week = L("日一二三四五六"[d.getDay()], "日一二三四五六"[d.getDay()], "Sun,Monday".split(",")[0]);
  return L(`${d.getMonth() + 1}月${d.getDate()}日 週${week}`, `${d.getMonth() + 1}月${d.getDate()}日 周${week}`, d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
}

function render() {
  const url = urlSetting();
  $("src").textContent = url ? (() => { try { return new URL(url).hostname; } catch (e) { return ""; } })() : "";

  if (!url) {
    $("list").innerHTML = `<li class="empty">${esc(L("到設定裡填一條 .ics 訂閱網址", "到设置里填一条 .ics 订阅网址", "Add an .ics subscription URL in settings"))}</li>`;
    $("hint").textContent = L("Google 日曆：設定 → 日曆 → 訂閱網址", "Google 日历：设置 → 日历 → 订阅网址", "Google Calendar: Settings → your calendar → secret iCal address");
    return;
  }

  const shown = events.slice(0, maxCount());
  if (!shown.length) {
    $("list").innerHTML = `<li class="empty">${esc(loading ? L("讀取中…", "读取中…", "Loading…") : L(`接下來 ${daysAhead()} 天沒有行程`, `接下来 ${daysAhead()} 天没有行程`, `Nothing in the next ${daysAhead()} days`))}</li>`;
    $("hint").textContent = status;
    return;
  }

  let lastDay = "";
  const html = [];
  for (const ev of shown) {
    const day = dayStamp(ev.start);
    if (day !== lastDay) {
      lastDay = day;
      html.push(`<li class="day">${esc(groupTitle(ev.start))}</li>`);
    }
    const when = ev.allDay ? L("全天", "全天", "All day") : clock(ev.start);
    const where = ev.where ? `<span class="w">${esc(ev.where)}</span>` : "";
    const rep = ev.repeat ? `<span class="rep" title="${esc(L("重複行程", "重复行程", "Repeats"))}">↻</span>` : "";
    html.push(`<li class="ev${ev.allDay ? " is-allday" : ""}">
      <span class="tm">${esc(when)}</span>
      <span class="txt"><span class="tt">${esc(ev.title)}</span>${where}</span>${rep}
    </li>`);
  }
  $("list").innerHTML = html.join("");
  $("hint").textContent = status;
}

async function load() {
  const url = urlSetting();
  if (!url || loading) { render(); return; }
  loading = true;
  $("refresh").classList.add("is-busy");
  status = L("讀取中…", "读取中…", "Loading…");
  render();
  try {
    const r = await widget.fetch(url, { headers: { Accept: "text/calendar" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const all = parseIcs(text);
    const from = Date.now() - 3600000;
    const to = Date.now() + daysAhead() * 86400000;
    events = all
      .filter((e) => e.start >= from && e.start <= to)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    status = events.length
      ? L(`共 ${events.length} 條 · ${new Date().toLocaleTimeString()} 更新`, `共 ${events.length} 条 · ${new Date().toLocaleTimeString()} 更新`, `${events.length} events · updated ${new Date().toLocaleTimeString()}`)
      : L(`接下來 ${daysAhead()} 天沒有行程`, `接下来 ${daysAhead()} 天没有行程`, `Nothing in the next ${daysAhead()} days`);
  } catch (e) {
    events = [];
    status = L(`讀不到行事曆：${String(e.message || e)}`, `读不到日历：${String(e.message || e)}`, `Can't read the calendar: ${String(e.message || e)}`);
  } finally {
    loading = false;
    $("refresh").classList.remove("is-busy");
    render();
  }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, 3600000);
}

$("title").textContent = L("ICS 行程", "ICS 行程", "ICS agenda");
$("refresh").onclick = load;
$("list").onclick = (e) => {
  const row = e.target.closest(".ev");
  if (!row) return;
  const url = urlSetting();
  if (url) widget.shell.open(url).catch(() => {});
};

widget.settings.onChange(() => { render(); load(); });

render();
load();
schedule();
widget.on("unload", () => clearInterval(timer));
widget.on("summon", load);
