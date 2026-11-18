const $ = (id) => document.getElementById(id);
const t = widget.t;

// Every linear unit is a factor to the group's base unit; temperature converts through °C.
const GROUPS = [
  {
    id: "length", base: { "zh-TW": "公尺", "zh-CN": "米", en: "metre" },
    label: { "zh-TW": "長度", "zh-CN": "长度", en: "Length" },
    units: [
      { id: "mm", f: 0.001, label: { "zh-TW": "毫米", "zh-CN": "毫米", en: "mm" } },
      { id: "cm", f: 0.01, label: { "zh-TW": "公分", "zh-CN": "厘米", en: "cm" } },
      { id: "m", f: 1, label: { "zh-TW": "公尺", "zh-CN": "米", en: "m" } },
      { id: "km", f: 1000, label: { "zh-TW": "公里", "zh-CN": "公里", en: "km" } },
      { id: "in", f: 0.0254, label: { "zh-TW": "英寸", "zh-CN": "英寸", en: "inch" } },
      { id: "ft", f: 0.3048, label: { "zh-TW": "英尺", "zh-CN": "英尺", en: "foot" } },
      { id: "li", f: 500, label: { "zh-TW": "里", "zh-CN": "里", en: "li (500 m)" } },
      { id: "nmi", f: 1852, label: { "zh-TW": "海里", "zh-CN": "海里", en: "nautical mile" } },
    ],
  },
  {
    id: "weight", base: { "zh-TW": "公斤", "zh-CN": "千克", en: "kilogram" },
    label: { "zh-TW": "重量", "zh-CN": "重量", en: "Weight" },
    units: [
      { id: "mg", f: 1e-6, label: { "zh-TW": "毫克", "zh-CN": "毫克", en: "mg" } },
      { id: "g", f: 0.001, label: { "zh-TW": "公克", "zh-CN": "克", en: "g" } },
      { id: "jin", f: 0.5, label: { "zh-TW": "台斤", "zh-CN": "斤", en: "jin (500 g)" } },
      { id: "liang", f: 0.05, label: { "zh-TW": "兩", "zh-CN": "两", en: "liang (50 g)" } },
      { id: "kg", f: 1, label: { "zh-TW": "公斤", "zh-CN": "千克", en: "kg" } },
      { id: "lb", f: 0.45359237, label: { "zh-TW": "磅", "zh-CN": "磅", en: "pound" } },
      { id: "oz", f: 0.028349523125, label: { "zh-TW": "盎司", "zh-CN": "盎司", en: "ounce" } },
      { id: "ton", f: 1000, label: { "zh-TW": "公噸", "zh-CN": "吨", en: "tonne" } },
    ],
  },
  {
    id: "area", base: { "zh-TW": "平方公尺", "zh-CN": "平方米", en: "square metre" },
    label: { "zh-TW": "面積", "zh-CN": "面积", en: "Area" },
    units: [
      { id: "cm2", f: 1e-4, label: { "zh-TW": "平方公分", "zh-CN": "平方厘米", en: "cm²" } },
      { id: "m2", f: 1, label: { "zh-TW": "平方公尺", "zh-CN": "平方米", en: "m²" } },
      { id: "ping", f: 3.305785, label: { "zh-TW": "坪", "zh-CN": "坪", en: "ping (3.306 m²)" } },
      { id: "mu", f: 666.6667, label: { "zh-TW": "畝", "zh-CN": "亩", en: "mu (666.67 m²)" } },
      { id: "ha", f: 10000, label: { "zh-TW": "公頃", "zh-CN": "公顷", en: "hectare" } },
      { id: "km2", f: 1e6, label: { "zh-TW": "平方公里", "zh-CN": "平方公里", en: "km²" } },
      { id: "ft2", f: 0.09290304, label: { "zh-TW": "平方英尺", "zh-CN": "平方英尺", en: "ft²" } },
    ],
  },
  {
    id: "volume", base: { "zh-TW": "公升", "zh-CN": "升", en: "litre" },
    label: { "zh-TW": "體積", "zh-CN": "体积", en: "Volume" },
    units: [
      { id: "ml", f: 0.001, label: { "zh-TW": "毫升", "zh-CN": "毫升", en: "mL" } },
      { id: "l", f: 1, label: { "zh-TW": "公升", "zh-CN": "升", en: "L" } },
      { id: "m3", f: 1000, label: { "zh-TW": "立方公尺", "zh-CN": "立方米", en: "m³" } },
      { id: "cup", f: 0.2365882365, label: { "zh-TW": "杯 (美)", "zh-CN": "杯 (美)", en: "cup (US)" } },
      { id: "pt", f: 0.473176473, label: { "zh-TW": "品脫 (美)", "zh-CN": "品脱 (美)", en: "pint (US)" } },
      { id: "gal", f: 3.785411784, label: { "zh-TW": "加侖 (美)", "zh-CN": "加仑 (美)", en: "gallon (US)" } },
    ],
  },
  {
    id: "temp", temp: true, base: { "zh-TW": "攝氏", "zh-CN": "摄氏", en: "celsius" },
    label: { "zh-TW": "溫度", "zh-CN": "温度", en: "Temperature" },
    units: [
      { id: "C", label: { "zh-TW": "°C 攝氏", "zh-CN": "°C 摄氏", en: "°C" } },
      { id: "F", label: { "zh-TW": "°F 華氏", "zh-CN": "°F 华氏", en: "°F" } },
      { id: "K", label: { "zh-TW": "K 克耳文", "zh-CN": "K 开尔文", en: "K" } },
    ],
  },
  {
    id: "speed", base: { "zh-TW": "公尺/秒", "zh-CN": "米/秒", en: "metre/second" },
    label: { "zh-TW": "速度", "zh-CN": "速度", en: "Speed" },
    units: [
      { id: "ms", f: 1, label: { "zh-TW": "公尺/秒", "zh-CN": "米/秒", en: "m/s" } },
      { id: "kmh", f: 1 / 3.6, label: { "zh-TW": "公里/時", "zh-CN": "公里/时", en: "km/h" } },
      { id: "mph", f: 0.44704, label: { "zh-TW": "英里/時", "zh-CN": "英里/时", en: "mph" } },
      { id: "kn", f: 0.514444444, label: { "zh-TW": "節", "zh-CN": "节", en: "knot" } },
      { id: "mach", f: 0.343, label: { "zh-TW": "馬赫", "zh-CN": "马赫", en: "mach" } },
    ],
  },
  {
    id: "data", base: { "zh-TW": "位元組", "zh-CN": "字节", en: "byte" },
    label: { "zh-TW": "資料量", "zh-CN": "数据量", en: "Data" },
    units: [
      { id: "bit", f: 0.125, label: { "zh-TW": "位元", "zh-CN": "比特", en: "bit" } },
      { id: "b", f: 1, label: { "zh-TW": "位元組", "zh-CN": "字节", en: "B" } },
      { id: "kb", f: 1024, label: { "zh-TW": "KB", "zh-CN": "KB", en: "KB" } },
      { id: "mb", f: 1048576, label: { "zh-TW": "MB", "zh-CN": "MB", en: "MB" } },
      { id: "gb", f: 1073741824, label: { "zh-TW": "GB", "zh-CN": "GB", en: "GB" } },
      { id: "tb", f: 1099511627776, label: { "zh-TW": "TB", "zh-CN": "TB", en: "TB" } },
    ],
  },
  {
    id: "time", base: { "zh-TW": "秒", "zh-CN": "秒", en: "second" },
    label: { "zh-TW": "時間", "zh-CN": "时间", en: "Time" },
    units: [
      { id: "ms", f: 0.001, label: { "zh-TW": "毫秒", "zh-CN": "毫秒", en: "ms" } },
      { id: "s", f: 1, label: { "zh-TW": "秒", "zh-CN": "秒", en: "second" } },
      { id: "min", f: 60, label: { "zh-TW": "分", "zh-CN": "分钟", en: "minute" } },
      { id: "h", f: 3600, label: { "zh-TW": "小時", "zh-CN": "小时", en: "hour" } },
      { id: "d", f: 86400, label: { "zh-TW": "天", "zh-CN": "天", en: "day" } },
      { id: "wk", f: 604800, label: { "zh-TW": "週", "zh-CN": "周", en: "week" } },
    ],
  },
];

const TEMP = {
  C: { to: (v) => v, from: (v) => v },
  F: { to: (v) => ((v - 32) * 5) / 9, from: (v) => (v * 9) / 5 + 32 },
  K: { to: (v) => v - 273.15, from: (v) => v + 273.15 },
};

let group = GROUPS[0];
let fromId = group.units[0].id;
let toId = group.units[2].id;

function findUnit(g, id) {
  return g.units.find((u) => u.id === id) || g.units[0];
}
function toBase(g, u, v) {
  if (g.temp) return TEMP[u.id].to(v);
  return v * u.f;
}
function fromBase(g, u, v) {
  if (g.temp) return TEMP[u.id].from(v);
  return v / u.f;
}
function convert(v) {
  return fromBase(group, findUnit(group, toId), toBase(group, findUnit(group, fromId), v));
}

function fmt(x) {
  const digits = String(widget.settings.get("digits") || "auto");
  if (!isFinite(x)) return "—";
  if (digits !== "auto") {
    const d = Number(digits);
    return Number(x.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });
  }
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 1e12 || a < 1e-6) return x.toExponential(3).replace("e+", "e");
  const s = x.toPrecision(6);
  return String(Number(s)).includes("e") ? s : Number(s).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function paintTabs() {
  $("tabs").innerHTML = GROUPS.map((g) => `
    <button class="w-btn tab${g === group ? " is-on" : ""}" data-id="${g.id}" data-no-drag>${t(g.label)}</button>`).join("");
}

function paintSelect(which, g, selected) {
  const el = $(which);
  el.innerHTML = g.units.map((u) => `<option value="${u.id}"${u.id === selected ? " selected" : ""}>${t(u.label)}</option>`).join("");
}

function paintHint() {
  const uf = findUnit(group, fromId);
  const ut = findUnit(group, toId);
  $("hint").textContent = "";
  $("hint").textContent = t({ "zh-TW": "換算方向：", "zh-CN": "换算方向：", en: "Direction: " }) +
    `1 ${t(uf.label)} = ${fmt(fromBase(group, ut, toBase(group, uf, 1)))} ${t(ut.label)}`;
}

function recalc() {
  const raw = $("value").value.trim();
  const v = raw === "" ? NaN : Number(raw.replace(/,/g, "").replace("，", ""));
  $("out").textContent = isFinite(v) ? fmt(convert(v)) : "—";
  $("out").classList.toggle("is-empty", !isFinite(v));
}

function setGroup(g) {
  group = g;
  fromId = g.units[0].id;
  toId = g.units[Math.min(1, g.units.length - 1)].id;
  paintTabs();
  paintSelect("fromUnit", g, fromId);
  paintSelect("toUnit", g, toId);
  paintHint();
  recalc();
  persist();
}

function persist() {
  widget.storage.set("state", { group: group.id, fromId, toId, value: $("value").value })
    .catch((e) => widget.log(`units: ${e.message}`));
}

$("tabs").onclick = (e) => {
  const btn = e.target.closest("[data-id]");
  if (!btn) return;
  const g = GROUPS.find((x) => x.id === btn.dataset.id);
  if (g) setGroup(g);
};

$("fromUnit").onchange = () => { fromId = $("fromUnit").value; paintHint(); recalc(); persist(); };
$("toUnit").onchange = () => { toId = $("toUnit").value; paintHint(); recalc(); persist(); };
$("value").oninput = () => { recalc(); persist(); };

$("swap").onclick = () => {
  const cur = $("out").textContent;
  const a = fromId, b = toId;
  fromId = b;
  toId = a;
  $("fromUnit").value = fromId;
  $("toUnit").value = toId;
  if (cur && cur !== "—") $("value").value = String(cur).replace(/,/g, "");
  paintHint();
  recalc();
  persist();
};

$("swap").title = t({ "zh-TW": "對調單位", "zh-CN": "对调单位", en: "Swap units" });
widget.settings.onChange(recalc);

widget.storage.get("state").then((s) => {
  if (s && typeof s === "object") {
    const g = GROUPS.find((x) => x.id === s.group) || GROUPS[0];
    group = g;
    fromId = findUnit(g, s.fromId).id;
    toId = findUnit(g, s.toId).id;
    if (s.value !== undefined) $("value").value = s.value;
  } else {
    $("value").value = "1";
  }
  paintTabs();
  paintSelect("fromUnit", group, fromId);
  paintSelect("toUnit", group, toId);
  paintHint();
  recalc();
});
