const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let data = null; // last good result: { at, place, forecast }
let failed = false;

const REFRESH = 15 * 60e3;

// WMO weather codes used by Open-Meteo.
const CODES = {
  0: { "zh-TW": "晴", "zh-CN": "晴", en: "Clear" },
  1: { "zh-TW": "晴時多雲", "zh-CN": "晴间多云", en: "Mainly clear" },
  2: { "zh-TW": "多雲", "zh-CN": "多云", en: "Partly cloudy" },
  3: { "zh-TW": "陰", "zh-CN": "阴", en: "Overcast" },
  45: { "zh-TW": "霧", "zh-CN": "雾", en: "Fog" },
  48: { "zh-TW": "霧凇", "zh-CN": "雾凇", en: "Rime fog" },
  51: { "zh-TW": "毛毛雨", "zh-CN": "毛毛雨", en: "Light drizzle" },
  53: { "zh-TW": "毛毛雨", "zh-CN": "毛毛雨", en: "Drizzle" },
  55: { "zh-TW": "濃毛毛雨", "zh-CN": "浓毛毛雨", en: "Dense drizzle" },
  56: { "zh-TW": "凍毛毛雨", "zh-CN": "冻毛毛雨", en: "Freezing drizzle" },
  57: { "zh-TW": "凍毛毛雨", "zh-CN": "冻毛毛雨", en: "Freezing drizzle" },
  61: { "zh-TW": "小雨", "zh-CN": "小雨", en: "Light rain" },
  63: { "zh-TW": "中雨", "zh-CN": "中雨", en: "Rain" },
  65: { "zh-TW": "大雨", "zh-CN": "大雨", en: "Heavy rain" },
  66: { "zh-TW": "凍雨", "zh-CN": "冻雨", en: "Freezing rain" },
  67: { "zh-TW": "凍雨", "zh-CN": "冻雨", en: "Freezing rain" },
  71: { "zh-TW": "小雪", "zh-CN": "小雪", en: "Light snow" },
  73: { "zh-TW": "中雪", "zh-CN": "中雪", en: "Snow" },
  75: { "zh-TW": "大雪", "zh-CN": "大雪", en: "Heavy snow" },
  77: { "zh-TW": "霰", "zh-CN": "霰", en: "Snow grains" },
  80: { "zh-TW": "陣雨", "zh-CN": "阵雨", en: "Showers" },
  81: { "zh-TW": "陣雨", "zh-CN": "阵雨", en: "Showers" },
  82: { "zh-TW": "強陣雨", "zh-CN": "强阵雨", en: "Heavy showers" },
  85: { "zh-TW": "陣雪", "zh-CN": "阵雪", en: "Snow showers" },
  86: { "zh-TW": "陣雪", "zh-CN": "阵雪", en: "Snow showers" },
  95: { "zh-TW": "雷雨", "zh-CN": "雷雨", en: "Thunderstorm" },
  96: { "zh-TW": "雷雨伴冰雹", "zh-CN": "雷雨伴冰雹", en: "Thunderstorm, hail" },
  99: { "zh-TW": "雷雨伴冰雹", "zh-CN": "雷雨伴冰雹", en: "Thunderstorm, hail" },
};
const cond = (code) => t(CODES[code] || { "zh-TW": "—", "zh-CN": "—", en: "—" });

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
    const forecast = await json(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,weather_code" +
      "&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min" +
      `&forecast_days=2&timezone=auto${unit}`);
    data = { at: Date.now(), place, forecast };
    failed = false;
    await widget.storage.set("last", data);
  } catch (e) {
    // a city that doesn't exist: say so, rather than keep showing the old place
    if (e instanceof places.NotFound) { data = null; showMessage(e.message, true); return; }
    failed = true;
    widget.log(`weather: ${e.message}`);
    if (!data) showMessage(e instanceof places.NotFound || e.message.startsWith("permission") ? e.message : t({ "zh-TW": "暫時取不到天氣", "zh-CN": "暂时取不到天气", en: "Weather unavailable" }), true);
  }
  if (data) render();
}

function showMessage(text, retry) {
  $("wx").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

/** The next seven hourly points, starting with the current hour. */
function nextHours(f) {
  const h = f.hourly;
  const nowKey = f.current.time.slice(0, 13); // "2026-11-01T14"
  let i = h.time.findIndex((x) => x.slice(0, 13) === nowKey);
  if (i < 0) i = 0;
  return h.time.slice(i, i + 7).map((time, k) => ({
    label: k === 0 ? t({ "zh-TW": "現在", "zh-CN": "现在", en: "Now" }) : String(+time.slice(11, 13)),
    temp: Math.round(k === 0 ? f.current.temperature_2m : h.temperature_2m[i + k]),
    rain: h.precipitation_probability[i + k] ?? 0,
  }));
}

function drawCurve(points) {
  const svg = $("curve");
  const w = svg.clientWidth, h = svg.clientHeight;
  if (!w || !h) return;
  const vs = points.map((p) => p.temp);
  const min = Math.min(...vs) - 1, max = Math.max(...vs) + 1;
  const pad = 6, top = 16;
  const xy = vs.map((v, i) => [pad + (i * (w - 2 * pad)) / (vs.length - 1), top + (1 - (v - min) / (max - min)) * (h - top - pad)]);
  const line = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  svg.innerHTML = `
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop class="stop" offset="0" stop-opacity=".3"/><stop class="stop" offset="1" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${line} L${xy[xy.length - 1][0]} ${h} L${xy[0][0]} ${h} Z"/>
    <path class="line" d="${line}"/>
    ${xy.map((p, i) => `<circle class="pt${i ? "" : " first"}" cx="${p[0]}" cy="${p[1]}" r="${i ? 2.5 : 4}"/>
      <text x="${p[0]}" y="${p[1] - 8}">${vs[i]}°</text>`).join("")}`;
}

function render() {
  const f = data.forecast;
  $("msg").hidden = true;
  $("wx").hidden = false;
  const c = cond(f.current.weather_code);
  const place = data.place.name;
  const hi = Math.round(f.daily.temperature_2m_max[0]), lo = Math.round(f.daily.temperature_2m_min[0]);
  const hours = nextHours(f);

  $("place").textContent = widget.theme === "paper" ? `${place}・${c}` : `${place} · ${c}`;
  $("temp").textContent = `${Math.round(f.current.temperature_2m)}°`;
  $("hl").innerHTML = widget.theme === "paper"
    ? `${lo}° – ${hi}°`
    : `<span class="city">${place} ${c}</span>` +
      t({ "zh-TW": `最高 <b>${hi}°</b>`, "zh-CN": `最高 <b>${hi}°</b>`, en: `High <b>${hi}°</b>` }) +
      (widget.theme === "type" ? " · " : "<br>") +
      t({ "zh-TW": `最低 <b>${lo}°</b>`, "zh-CN": `最低 <b>${lo}°</b>`, en: `Low <b>${lo}°</b>` });

  const rain = Math.max(...hours.map((x) => x.rain));
  const feels = Math.round(f.current.apparent_temperature);
  const notes = [];
  if (rain >= 20) notes.push(t({ "zh-TW": `降雨機率 ${rain}%`, "zh-CN": `降雨概率 ${rain}%`, en: `${rain}% chance of rain` }));
  if (Math.abs(feels - f.current.temperature_2m) >= 3) notes.push(t({ "zh-TW": `體感 ${feels}°`, "zh-CN": `体感 ${feels}°`, en: `Feels like ${feels}°` }));
  if (!notes.length) notes.push(t({ "zh-TW": "接下來幾小時沒有雨", "zh-CN": "接下来几小时没有雨", en: "No rain in the next hours" }));
  $("note").textContent = notes.join(t({ zh: "，", en: ", " }));

  $("hours").innerHTML = hours.map((x) => `<span>${x.label}</span>`).join("");
  $("table").innerHTML =
    `<tr><td>${t({ "zh-TW": "時", "zh-CN": "时", en: "h" })}</td>${hours.slice(1).map((x) => `<td>${x.label}</td>`).join("")}</tr>` +
    `<tr><td>${t({ "zh-TW": "溫", "zh-CN": "温", en: "°" })}</td>${hours.slice(1).map((x) => `<td>${x.temp}°</td>`).join("")}</tr>`;
  $("stale").textContent = failed ? t({ "zh-TW": "離線", "zh-CN": "离线", en: "offline" }) : "";
  requestAnimationFrame(() => drawCurve(hours));
}

$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = () => { showMessage(t({ "zh-TW": "正在取得天氣…", "zh-CN": "正在获取天气…", en: "Loading…" }), false); refresh(); };

new ResizeObserver(() => data && drawCurve(nextHours(data.forecast))).observe($("chart"));
widget.settings.onChange((s) => { opts = s; refresh(); });
widget.appearance.onChange(() => data && render());

(async () => {
  data = await widget.storage.get("last");
  if (data) render();
  else showMessage(t({ "zh-TW": "正在取得天氣…", "zh-CN": "正在获取天气…", en: "Loading…" }), false);
  if (!data || Date.now() - data.at > REFRESH) await refresh();
  setInterval(refresh, REFRESH);
})();
