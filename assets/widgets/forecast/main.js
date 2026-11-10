const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let data = null; // last good result: { at, place, daily, unit }
let failed = false;
const REFRESH = 30 * 60e3;

// WMO weather codes used by Open-Meteo → words and a drawing.
const CODES = {
  0: [{ "zh-TW": "晴", "zh-CN": "晴", en: "Clear" }, "sun"],
  1: [{ "zh-TW": "晴時多雲", "zh-CN": "晴间多云", en: "Mainly clear" }, "partly"],
  2: [{ "zh-TW": "多雲", "zh-CN": "多云", en: "Partly cloudy" }, "partly"],
  3: [{ "zh-TW": "陰", "zh-CN": "阴", en: "Overcast" }, "cloud"],
  45: [{ "zh-TW": "霧", "zh-CN": "雾", en: "Fog" }, "fog"],
  48: [{ "zh-TW": "霧凇", "zh-CN": "雾凇", en: "Rime fog" }, "fog"],
  51: [{ "zh-TW": "毛毛雨", "zh-CN": "毛毛雨", en: "Drizzle" }, "drizzle"],
  53: [{ "zh-TW": "毛毛雨", "zh-CN": "毛毛雨", en: "Drizzle" }, "drizzle"],
  55: [{ "zh-TW": "濃毛毛雨", "zh-CN": "浓毛毛雨", en: "Dense drizzle" }, "drizzle"],
  56: [{ "zh-TW": "凍毛毛雨", "zh-CN": "冻毛毛雨", en: "Freezing drizzle" }, "drizzle"],
  57: [{ "zh-TW": "凍毛毛雨", "zh-CN": "冻毛毛雨", en: "Freezing drizzle" }, "drizzle"],
  61: [{ "zh-TW": "小雨", "zh-CN": "小雨", en: "Light rain" }, "rain"],
  63: [{ "zh-TW": "中雨", "zh-CN": "中雨", en: "Rain" }, "rain"],
  65: [{ "zh-TW": "大雨", "zh-CN": "大雨", en: "Heavy rain" }, "rain"],
  66: [{ "zh-TW": "凍雨", "zh-CN": "冻雨", en: "Freezing rain" }, "rain"],
  67: [{ "zh-TW": "凍雨", "zh-CN": "冻雨", en: "Freezing rain" }, "rain"],
  71: [{ "zh-TW": "小雪", "zh-CN": "小雪", en: "Light snow" }, "snow"],
  73: [{ "zh-TW": "中雪", "zh-CN": "中雪", en: "Snow" }, "snow"],
  75: [{ "zh-TW": "大雪", "zh-CN": "大雪", en: "Heavy snow" }, "snow"],
  77: [{ "zh-TW": "霰", "zh-CN": "霰", en: "Snow grains" }, "snow"],
  80: [{ "zh-TW": "陣雨", "zh-CN": "阵雨", en: "Showers" }, "rain"],
  81: [{ "zh-TW": "陣雨", "zh-CN": "阵雨", en: "Showers" }, "rain"],
  82: [{ "zh-TW": "強陣雨", "zh-CN": "强阵雨", en: "Heavy showers" }, "rain"],
  85: [{ "zh-TW": "陣雪", "zh-CN": "阵雪", en: "Snow showers" }, "snow"],
  86: [{ "zh-TW": "陣雪", "zh-CN": "阵雪", en: "Snow showers" }, "snow"],
  95: [{ "zh-TW": "雷雨", "zh-CN": "雷雨", en: "Thunderstorm" }, "storm"],
  96: [{ "zh-TW": "雷雨伴冰雹", "zh-CN": "雷雨伴冰雹", en: "Thunderstorm, hail" }, "storm"],
  99: [{ "zh-TW": "雷雨伴冰雹", "zh-CN": "雷雨伴冰雹", en: "Thunderstorm, hail" }, "storm"],
};

// Line drawings on a 24×24 grid, in the text colour.
const CLOUD = "M7.6 18h9.1a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-9.9-1.1A3.7 3.7 0 0 0 7.6 18z";
const RAYS = "M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M5.8 18.2l1.4-1.4M16.8 7.2l1.4-1.4";
const DRAW = {
  sun: `<circle cx="12" cy="12" r="3.7"/><path d="${RAYS}"/>`,
  partly: `<circle cx="8.3" cy="8.3" r="2.7"/><path d="M8.3 3.2v1.2M3.2 8.3h1.2M4.7 4.7l.85.85M11.9 4.7l-.85.85M4.7 11.9l.85-.85"/><path transform="translate(2.2 1.6)" d="${CLOUD}"/>`,
  cloud: `<path d="${CLOUD}"/>`,
  fog: `<path d="M4 9h13M7 13h13M4 17h11"/>`,
  drizzle: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M8.5 18.5v.5M12 19.5v.5M15.5 18.5v.5"/>`,
  rain: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M8.6 17.6l-1 2.6M12.1 17.6l-1 2.6M15.6 17.6l-1 2.6"/>`,
  snow: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M8.5 18.2v2M7.6 19.2h1.8M12 18.8v2M11.1 19.8h1.8M15.5 18.2v2M14.6 19.2h1.8"/>`,
  storm: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M12.6 15.4l-2 3.3h2.6l-1.8 3"/>`,
};
const icon = (code) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${DRAW[(CODES[code] || [null, "cloud"])[1]]}</svg>`;
const words = (code) => t((CODES[code] || [{ "zh-TW": "—", "zh-CN": "—", en: "—" }])[0]);

async function json(url) {
  const r = await widget.fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Where to show: the city from settings, or the network's location (see /__fw/places.js). */
const locate = () => places.locate(opts.city);

async function refresh() {
  try {
    const place = await locate();
    const unit = opts.unit === "fahrenheit" ? "&temperature_unit=fahrenheit" : "";
    const f = await json(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=auto${unit}`);
    data = { at: Date.now(), place, daily: f.daily, unit: opts.unit };
    failed = false;
    await widget.storage.set("last", data);
  } catch (e) {
    // a city that doesn't exist: say so, rather than keep showing the old place
    if (e instanceof places.NotFound) { data = null; showMessage(e.message, true); return; }
    failed = true;
    widget.log(`forecast: ${e.message}`);
    if (!data) showMessage(e instanceof places.NotFound || e.message.startsWith("permission")
      ? e.message : t({ "zh-TW": "暫時取不到天氣", "zh-CN": "暂时取不到天气", en: "Forecast unavailable" }), true);
  }
  if (data) render();
}

function showMessage(text, retry) {
  $("fc").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

function dayName(iso, i) {
  if (i === 0) return t({ "zh-TW": "今天", "zh-CN": "今天", en: "Today" });
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(widget.locale, { weekday: "short" }).format(new Date(y, m - 1, d));
}

function render() {
  const d = data.daily;
  $("msg").hidden = true;
  $("fc").hidden = false;
  // skip days already over (the forecast may be from yesterday's refresh)
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const start = Math.max(0, d.time.indexOf(todayIso));
  const idx = d.time.map((_, i) => i).slice(start);
  const lo = Math.min(...idx.map((i) => d.temperature_2m_min[i])), hi = Math.max(...idx.map((i) => d.temperature_2m_max[i]));
  const span = Math.max(1, hi - lo);

  $("place").textContent = widget.theme === "paper"
    ? t({ "zh-TW": `${data.place.name}・一週天氣`, "zh-CN": `${data.place.name}・一周天气`, en: `${data.place.name} · 7 days` })
    : data.place.name;
  $("stale").textContent = failed ? t({ "zh-TW": "離線", "zh-CN": "离线", en: "offline" }) : "";
  $("days").style.setProperty("--n", idx.length);
  $("days").innerHTML = idx.map((i, k) => {
    const max = Math.round(d.temperature_2m_max[i]), min = Math.round(d.temperature_2m_min[i]);
    const rain = d.precipitation_probability_max[i] ?? 0;
    const top = ((hi - d.temperature_2m_max[i]) / span) * 100, bottom = ((d.temperature_2m_min[i] - lo) / span) * 100;
    return `<li class="day${k === 0 ? " today" : ""}" title="${words(d.weather_code[i])}">
      <span class="dn">${dayName(d.time[i], k)}</span>
      ${icon(d.weather_code[i])}
      <span class="cond">${words(d.weather_code[i])}</span>
      <span class="hi w-num">${max}°</span>
      <span class="range"><i style="top:${top.toFixed(1)}%;bottom:${bottom.toFixed(1)}%"></i></span>
      <span class="lo w-num">${min}°</span>
      <span class="both w-num">${min}° – ${max}°</span>
      <span class="rain w-num${rain >= 50 ? " wet" : ""}">${rain >= 10 ? `${rain}%` : ""}</span>
    </li>`;
  }).join("");
}

$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = () => { showMessage(t({ "zh-TW": "正在取得天氣…", "zh-CN": "正在获取天气…", en: "Loading…" }), false); refresh(); };
widget.settings.onChange((s) => { opts = s; refresh(); });
widget.appearance.onChange(() => data && render());

(async () => {
  data = await widget.storage.get("last");
  if (data && data.unit !== opts.unit) data = null;
  if (data) render();
  else showMessage(t({ "zh-TW": "正在取得天氣…", "zh-CN": "正在获取天气…", en: "Loading…" }), false);
  if (!data || Date.now() - data.at > REFRESH) await refresh();
  setInterval(refresh, REFRESH);
})();
