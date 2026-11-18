const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

const DEFAULT_CITIES = "Asia/Taipei=台北\nAsia/Tokyo=東京\nEurope/London=倫敦\nAmerica/New_York=紐約\nAmerica/Los_Angeles=洛杉磯";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");

function localInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localMinutes(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

function cities() {
  const raw = String(widget.settings.get("cities") || DEFAULT_CITIES);
  const out = [];
  for (const line of raw.split(/[\n;]+/)) {
    const s = line.trim();
    if (!s) continue;
    const eq = s.indexOf("=");
    const zone = (eq > 0 ? s.slice(0, eq) : s).trim();
    let label = eq > 0 ? s.slice(eq + 1).trim() : zone.split("/").pop().replace(/_/g, " ");
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch (e) {
      continue;                       // a typo in the zone just drops that line
    }
    out.push({ zone: zone, label: label || zone });
  }
  if (!out.length) out.push({ zone: "Asia/Taipei", label: L("台北", "台北", "Taipei") });
  return out.slice(0, 8);
}

function hhmm(ms, zone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

function dayDelta(ms, zone) {
  const base = new Date(ms);
  const dayHere = `${base.getFullYear()}-${base.getMonth()}-${base.getDate()}`;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const dayThere = parts;
  // en-CA gives YYYY-MM-DD; compare by turning both into a day number
  const num = (y, m, d) => y * 372 + m * 31 + d;
  const [ty, tm, td] = dayThere.split("-").map(Number);
  return num(ty, tm, td) - num(base.getFullYear(), base.getMonth() + 1, base.getDate());
}

function zoneOffsetMinutes(zone, ms) {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value;
    const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch (e) {
    return 0;
  }
}

const localOffsetMinutes = (ms) => -new Date(ms).getTimezoneOffset();

function render() {
  const raw = $("when").value;
  const ms = raw ? new Date(raw).getTime() : Date.now();
  const valid = Number.isFinite(ms);
  const at = valid ? ms : Date.now();
  const minutes = Math.max(15, Math.round(Number(widget.settings.get("minutes")) || 60));
  const end = at + minutes * 60000;

  $("len").textContent = L(`${minutes} 分鐘`, `${minutes} 分钟`, `${minutes} min`);
  const hereOff = localOffsetMinutes(at);

  $("cities").innerHTML = cities().map((c) => {
    const start = hhmm(at, c.zone);
    const finish = hhmm(end, c.zone);
    const shift = dayDelta(at, c.zone);
    const off = Math.round((zoneOffsetMinutes(c.zone, at) - hereOff) / 60);
    const local = hhmm(at, c.zone);
    const hour = Number(local.slice(0, 2)) * 60 + Number(local.slice(3, 5));
    const clue = hour >= 9 * 60 && hour < 18 * 60 ? "ok" : hour >= 7 * 60 && hour < 22 * 60 ? "edge" : "night";
    const shiftTag = shift !== 0 ? `<span class="day">${shift > 0 ? "+1" : "−1"}</span>` : "";
    const offTag = off === 0 ? L("同時區", "同时区", "same") : `${off > 0 ? "+" : "−"}${Math.abs(off)}h`;
    return `<li class="city is-${clue}">
      <span class="dot"></span>
      <span class="cn">${esc(c.label)}</span>
      <span class="tm">${esc(start)}<span class="end">–${esc(finish)}</span>${shiftTag}</span>
      <span class="of">${esc(offTag)}</span>
    </li>`;
  }).join("");

  const good = cities().filter((c) => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: c.zone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(at));
    const m = Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
    return m >= 9 * 60 && m < 18 * 60;
  }).length;

  $("hint").textContent = L(
    `${good} 個城市在上班時間 · 綠點＝9:00–18:00`,
    `${good} 个城市在上班时间 · 绿点＝9:00–18:00`,
    `${good} in office hours · dot = 9:00–18:00`
  );
}

$("title").textContent = L("會議時間", "会议时间", "Meeting time");
$("now").textContent = L("現在", "现在", "Now");

$("when").value = localInputValue(Math.round(Date.now() / 1800000) * 1800000 + 1800000);
$("when").addEventListener("input", render);
$("now").onclick = () => {
  $("when").value = localInputValue(Date.now());
  render();
};

widget.settings.onChange(() => { render(); });
render();
setInterval(() => { if (!document.hidden && !$("when").value) render(); }, 60000);
