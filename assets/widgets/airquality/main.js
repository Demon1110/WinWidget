const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let data = null; // last good result: { at, place, current }
let failed = false;
const REFRESH = 30 * 60e3;

/** Six levels per index: where each ends, what it's called, what to do. */
const SCALES = {
  us: {
    ends: [50, 100, 150, 200, 300, 500],
    names: [
      { "zh-TW": "良好", "zh-CN": "优", en: "Good" },
      { "zh-TW": "普通", "zh-CN": "良", en: "Moderate" },
      { "zh-TW": "對敏感族群不健康", "zh-CN": "轻度污染", en: "Unhealthy for sensitive groups" },
      { "zh-TW": "對所有族群不健康", "zh-CN": "中度污染", en: "Unhealthy" },
      { "zh-TW": "非常不健康", "zh-CN": "重度污染", en: "Very unhealthy" },
      { "zh-TW": "危害", "zh-CN": "严重污染", en: "Hazardous" },
    ],
  },
  eu: {
    ends: [20, 40, 60, 80, 100, 150],
    names: [
      { "zh-TW": "良好", "zh-CN": "良好", en: "Good" },
      { "zh-TW": "尚可", "zh-CN": "尚可", en: "Fair" },
      { "zh-TW": "中等", "zh-CN": "中等", en: "Moderate" },
      { "zh-TW": "差", "zh-CN": "差", en: "Poor" },
      { "zh-TW": "很差", "zh-CN": "很差", en: "Very poor" },
      { "zh-TW": "極差", "zh-CN": "极差", en: "Extremely poor" },
    ],
  },
};
const ADVICE = [
  { "zh-TW": "適合戶外活動", "zh-CN": "适合户外活动", en: "Fine for being outdoors" },
  { "zh-TW": "敏感的人留意身體狀況", "zh-CN": "敏感人群留意身体状况", en: "Sensitive people: take it easy" },
  { "zh-TW": "敏感族群減少戶外活動", "zh-CN": "敏感人群减少户外活动", en: "Sensitive groups: limit time outside" },
  { "zh-TW": "減少戶外活動", "zh-CN": "减少户外活动", en: "Limit time outside" },
  { "zh-TW": "避免戶外活動", "zh-CN": "避免户外活动", en: "Avoid being outside" },
  { "zh-TW": "留在室內，關好門窗", "zh-CN": "留在室内，关好门窗", en: "Stay inside, windows shut" },
];

const scale = () => SCALES[opts.scale === "eu" ? "eu" : "us"];
function level(v) {
  const ends = scale().ends;
  const i = ends.findIndex((e) => v <= e);
  return i < 0 ? ends.length - 1 : i;
}
/** Where a value sits on a bar of six equal steps, 0–1. */
function position(v) {
  const ends = scale().ends, i = level(v);
  const from = i ? ends[i - 1] : 0;
  return Math.min(1, (i + Math.min(1, (v - from) / (ends[i] - from))) / ends.length);
}


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
    const r = await json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=us_aqi,european_aqi,pm2_5,pm10,ozone&timezone=auto");
    data = { at: Date.now(), place, current: r.current };
    failed = false;
    await widget.storage.set("last", data);
  } catch (e) {
    // a city that doesn't exist: say so, rather than keep showing the old place
    if (e instanceof places.NotFound) { data = null; showMessage(e.message, true); return; }
    failed = true;
    widget.log(`airquality: ${e.message}`);
    if (!data) showMessage(e instanceof places.NotFound || e.message.startsWith("permission")
      ? e.message : t({ "zh-TW": "暫時取不到空氣品質", "zh-CN": "暂时取不到空气质量", en: "Air quality unavailable" }), true);
  }
  if (data) render();
}

function showMessage(text, retry) {
  $("aq").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

function render() {
  const c = data.current;
  const v = Math.round(opts.scale === "eu" ? c.european_aqi : c.us_aqi);
  if (!Number.isFinite(v)) { showMessage(t({ "zh-TW": "這裏沒有空氣品質數據", "zh-CN": "这里没有空气质量数据", en: "No air quality data here" }), true); return; }
  const lv = level(v);
  $("msg").hidden = true;
  $("aq").hidden = false;
  document.body.dataset.level = lv;

  $("place").textContent = widget.theme === "paper"
    ? t({ "zh-TW": `空氣品質・${data.place.name}`, "zh-CN": `空气质量・${data.place.name}`, en: `Air quality · ${data.place.name}` })
    : data.place.name;
  $("stale").textContent = failed ? t({ "zh-TW": "離線", "zh-CN": "离线", en: "offline" }) : "";
  $("value").textContent = v;
  $("level").textContent = t(scale().names[lv]);
  $("advice").textContent = t(ADVICE[lv]);
  $("scale").innerHTML = scale().ends.map((_, i) => `<i class="l${i}${i === lv ? " on" : ""}"></i>`).join("") +
    `<b class="mark" style="left:${(position(v) * 100).toFixed(1)}%"></b>`;
  const unit = "µg/m³";
  $("parts").innerHTML = [["PM2.5", c.pm2_5], ["PM10", c.pm10], ["O₃", c.ozone]]
    .map(([k, x]) => `<div><dt>${k}</dt><dd class="w-num">${x == null ? "—" : Math.round(x)}<small>${unit}</small></dd></div>`).join("");
}

$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = () => { showMessage(t({ "zh-TW": "正在取得空氣品質…", "zh-CN": "正在获取空气质量…", en: "Loading…" }), false); refresh(); };
widget.settings.onChange((s) => {
  const moved = (s.city || "") !== (opts.city || "");
  opts = s;
  if (moved) refresh(); else if (data) render();
});
widget.appearance.onChange(() => data && render());

(async () => {
  data = await widget.storage.get("last");
  if (data) render();
  else showMessage(t({ "zh-TW": "正在取得空氣品質…", "zh-CN": "正在获取空气质量…", en: "Loading…" }), false);
  if (!data || Date.now() - data.at > REFRESH) await refresh();
  setInterval(refresh, REFRESH);
})();
