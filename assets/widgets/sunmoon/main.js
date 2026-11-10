const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let place = null;

// ── astronomy: the standard low-precision formulas, good to about a minute ──
const PI = Math.PI, rad = PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545;
const e = rad * 23.4397; // tilt of the Earth's axis
const toDays = (date) => +date / DAY - 0.5 + J1970 - J2000;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY);
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}

/** Sunrise, solar noon and sunset (Dates; rise/set null when the sun never crosses the horizon). */
function sunTimes(date, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, J0 = 0.0009;
  const n = Math.round(toDays(date) - J0 - lw / (2 * PI));
  const ds = J0 + lw / (2 * PI) + n;
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
  const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW > 1) return { noon: fromJulian(noon), rise: null, set: null, polar: "night" };
  if (cosW < -1) return { noon: fromJulian(noon), rise: null, set: null, polar: "day" };
  const w = Math.acos(cosW);
  const set = J2000 + (J0 + (w + lw) / (2 * PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { noon: fromJulian(noon), rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}

/** How much of the moon is lit (0–1) and where it is in its month (0 new, .25 first quarter, .5 full, .75 last quarter). */
function moonPhase(date) {
  const d = toDays(date);
  const sM = solarMeanAnomaly(d), sL = eclipticLongitude(sM);
  const s = { ra: rightAscension(sL, 0), dec: declination(sL, 0) };
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  const m = { ra: rightAscension(l, b), dec: declination(l, b) };
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { lit: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI };
}

const PHASES = [
  { "zh-TW": "新月", "zh-CN": "新月", en: "New moon" },
  { "zh-TW": "眉月", "zh-CN": "蛾眉月", en: "Waxing crescent" },
  { "zh-TW": "上弦月", "zh-CN": "上弦月", en: "First quarter" },
  { "zh-TW": "盈凸月", "zh-CN": "盈凸月", en: "Waxing gibbous" },
  { "zh-TW": "滿月", "zh-CN": "满月", en: "Full moon" },
  { "zh-TW": "虧凸月", "zh-CN": "亏凸月", en: "Waning gibbous" },
  { "zh-TW": "下弦月", "zh-CN": "下弦月", en: "Last quarter" },
  { "zh-TW": "殘月", "zh-CN": "残月", en: "Waning crescent" },
];
/** New, quarters and full get about a day either side; the rest is crescent or gibbous. */
function phaseName(p) {
  const near = (x) => Math.abs(p - x) < 0.034 || Math.abs(p - x - 1) < 0.034;
  if (near(0)) return PHASES[0];
  if (near(0.25)) return PHASES[2];
  if (near(0.5)) return PHASES[4];
  if (near(0.75)) return PHASES[6];
  return PHASES[p < 0.25 ? 1 : p < 0.5 ? 3 : p < 0.75 ? 5 : 7];
}

/** The lit part of the moon as a path on a circle of radius r; mirrored south of the equator. */
function moonSvg(phase, r, south) {
  const k = Math.cos(2 * PI * phase), waxing = phase < 0.5;
  const limb = waxing ? 1 : 0;                       // right edge lit while waxing
  const term = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  const rx = Math.abs(k) * r;
  const lit = `M0 ${-r} A${r} ${r} 0 0 ${limb} 0 ${r} A${rx.toFixed(2)} ${r} 0 0 ${term} 0 ${-r}Z`;
  return `<svg class="mn" viewBox="${-r - 1} ${-r - 1} ${2 * r + 2} ${2 * r + 2}" aria-hidden="true"><g${south ? ' transform="scale(-1 1)"' : ""}>
    <circle class="dark" r="${r}"/><path class="lit" d="${lit}"/></g></svg>`;
}

// ── place ──

/** Where to show: the city from settings, or the network's location (see /__fw/places.js). */
const locate = () => places.locate(opts.city);

async function load() {
  try {
    place = await locate();
    render();
  } catch (err) {
    widget.log(`sunmoon: ${err.message}`);
    if (err instanceof places.NotFound) { place = null; showMessage(err.message, true); return; }
    place = await widget.storage.get("last");
    if (place) render();
    else showMessage(err instanceof places.NotFound || err.message.startsWith("permission") ? err.message
      : t({ "zh-TW": "暫時找不到你的位置", "zh-CN": "暂时找不到你的位置", en: "Can't find where you are" }), true);
    return;
  }
  widget.storage.set("last", place);
}

function showMessage(text, retry) {
  $("sm").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

// ── drawing ──
const tz = () => (place && place.tz) || undefined;
const hm = (d) => new Intl.DateTimeFormat(widget.locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz() }).format(d);
function length(ms) {
  const m = Math.round(ms / 6e4), h = Math.floor(m / 60);
  return t({ "zh-TW": `${h} 小時 ${m % 60} 分`, "zh-CN": `${h} 小时 ${m % 60} 分`, en: `${h} h ${m % 60} min` });
}
function change(ms) {
  const s = Math.round(Math.abs(ms) / 1000), m = Math.floor(s / 60), x = s % 60;
  if (s < 5) return t({ "zh-TW": "和昨天差不多", "zh-CN": "和昨天差不多", en: "about the same as yesterday" });
  const n = m ? t({ "zh-TW": `${m} 分 ${x} 秒`, "zh-CN": `${m} 分 ${x} 秒`, en: `${m}m ${x}s` }) : t({ "zh-TW": `${x} 秒`, "zh-CN": `${x} 秒`, en: `${x}s` });
  return ms > 0 ? t({ "zh-TW": `比昨天長 ${n}`, "zh-CN": `比昨天长 ${n}`, en: `${n} longer than yesterday` })
    : t({ "zh-TW": `比昨天短 ${n}`, "zh-CN": `比昨天短 ${n}`, en: `${n} shorter than yesterday` });
}

/** Local noon of the place's calendar day, `offset` days away. */
function placeNoon(offset) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz(), year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + offset, 12) - (place.lon / 15) * 36e5);
}

function render() {
  $("msg").hidden = true;
  $("sm").hidden = false;
  const now = new Date();
  const today = sunTimes(placeNoon(0), place.lat, place.lon);
  const yesterday = sunTimes(placeNoon(-1), place.lat, place.lon);
  const tomorrow = sunTimes(placeNoon(1), place.lat, place.lon);

  $("place").textContent = place.name;

  const moon = moonPhase(now);
  $("moon").hidden = opts.showMoon === false;
  $("moon").innerHTML = `${moonSvg(moon.phase, 10, place.lat < 0)}<span>${t(phaseName(moon.phase))}</span><span class="w-num pct">${Math.round(moon.lit * 100)}%</span>`;

  const sunrise = t({ "zh-TW": "日出", "zh-CN": "日出", en: "Sunrise" }), sunset = t({ "zh-TW": "日落", "zh-CN": "日落", en: "Sunset" });
  const daylight = t({ "zh-TW": "白晝", "zh-CN": "白昼", en: "Daylight" });

  if (today.polar) {
    const word = today.polar === "day" ? t({ "zh-TW": "極晝：太陽整天不落", "zh-CN": "极昼：太阳整天不落", en: "Midnight sun: the sun stays up" })
      : t({ "zh-TW": "極夜：太陽整天不升", "zh-CN": "极夜：太阳整天不升", en: "Polar night: the sun stays down" });
    $("next").innerHTML = `<span class="ev">${word}</span>`;
    $("times").innerHTML = "";
    $("length").textContent = "";
    $("sky").innerHTML = "";
    return;
  }

  // what's next: sunrise, sunset, or tomorrow's sunrise
  const next = now < today.rise ? [sunrise, today.rise] : now < today.set ? [sunset, today.set] : [sunrise, tomorrow.rise];
  $("next").innerHTML = `<span class="tm w-display">${hm(next[1])}</span><span class="ev">${next[0]}${
    next[1] === tomorrow.rise ? t({ "zh-TW": "（明天）", "zh-CN": "（明天）", en: " tomorrow" }) : ""}</span>`;

  $("times").innerHTML = `<div class="col"><span class="k">${sunrise}</span><span class="v w-num">${today.rise ? hm(today.rise) : "—"}</span></div>
    <div class="col mid"><span class="k">${daylight}</span><span class="v">${length(today.set - today.rise)}</span></div>
    <div class="col end"><span class="k">${sunset}</span><span class="v w-num">${today.set ? hm(today.set) : "—"}</span></div>`;
  const diff = yesterday.polar ? 0 : (today.set - today.rise) - (yesterday.set - yesterday.rise);
  $("length").textContent = `${daylight} ${length(today.set - today.rise)} · ${change(diff)}`;

  // the sun's path over the horizon: travelled part lit, the sun where it is now
  const f = (now - today.rise) / (today.set - today.rise);
  const x0 = 14, x1 = 186, y0 = 66, top = 10;
  const at = (u) => [x0 + (x1 - x0) * u, y0 - (y0 - top) * Math.sin(PI * u)];
  const pts = (a, b) => Array.from({ length: 41 }, (_, i) => at(a + ((b - a) * i) / 40)).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const up = f > 0 && f < 1;
  const [sx, sy] = at(Math.min(1, Math.max(0, f)));
  $("sky").innerHTML = `<path class="horizon" d="M2 ${y0}H198"/><path class="path" d="${pts(0, 1)}"/>` +
    (up ? `<path class="done" d="${pts(0, f)}"/><circle class="halo" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="8"/><circle class="sun" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4.5"/>`
      : `<circle class="sun down" cx="${(f <= 0 ? x0 : x1).toFixed(1)}" cy="${y0}" r="3.5"/>`);
}

$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = () => { showMessage(t({ "zh-TW": "正在定位…", "zh-CN": "正在定位…", en: "Locating…" }), false); load(); };
widget.settings.onChange((s) => {
  const moved = (s.city || "") !== (opts.city || "");
  opts = s;
  if (moved) load(); else if (place) render();
});
widget.appearance.onChange(() => place && render());

function tick() {
  if (place) render();
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
}
showMessage(t({ "zh-TW": "正在定位…", "zh-CN": "正在定位…", en: "Locating…" }), false);
widget.storage.get("last").then((p) => { if (p) { place = p; render(); } load(); tick(); });
