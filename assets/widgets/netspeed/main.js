const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const N = 60; // seconds of history
const hist = [];  // [down, up] bytes per second, oldest first

/** "2.4" + "MB/s": one decimal under 10, whole numbers above. */
function rate(bytes) {
  const bits = opts.unit === "bits";
  let v = bits ? bytes * 8 : bytes;
  const units = bits ? ["bps", "Kbps", "Mbps", "Gbps"] : ["B/s", "KB/s", "MB/s", "GB/s"];
  const base = bits ? 1000 : 1024;
  let i = 0;
  while (v >= base * 0.95 && i < units.length - 1) { v /= base; i++; }
  return [v < 10 && i > 0 ? v.toFixed(1) : String(Math.round(v)), units[i]];
}
function size(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 * 0.95 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** A round top for the chart, at least 100 KB/s so a quiet line stays quiet. */
function scaleTop() {
  const max = Math.max(100 * 1024, ...hist.map(([d, u]) => Math.max(d, u)));
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= max);
}

// columns are made once; each second only their heights change
$("chart").innerHTML = Array.from({ length: N }, () => `<span><i class="d"></i><i class="u"></i></span>`).join("");
const cols = [...$("chart").children];

function render(net) {
  const [dv, du] = rate(net.down), [uv, uu] = rate(net.up);
  $("down").textContent = dv; $("down-u").textContent = du;
  $("up").textContent = uv; $("up-u").textContent = uu;
  $("total").textContent = t({ "zh-TW": "開機以來", "zh-CN": "开机以来", en: "Since start-up" }) +
    `  ↓ ${size(net.totalDown ?? 0)}  ↑ ${size(net.totalUp ?? 0)}`;
  const top = scaleTop();
  cols.forEach((c, i) => {
    const h = hist[i - (N - hist.length)];
    c.children[0].style.height = h ? `${Math.min(100, (h[0] / top) * 100).toFixed(1)}%` : "0";
    c.children[1].style.height = h ? `${Math.min(100, (h[1] / top) * 100).toFixed(1)}%` : "0";
  });
}

let last = null;
// the last minute from WinWidget' record, so the columns aren't empty at first
widget.system.history().then((h) => {
  if (hist.length) return;
  for (const p of h.points.filter((p) => h.now - p[0] <= N * 1000)) hist.push([p[3], p[4]]);
  if (hist.length > N) hist.splice(0, hist.length - N);
}).catch(() => {}).finally(subscribe);

function subscribe() {
  widget.system.subscribe("network", (d) => {
    last = d.network;
    hist.push([last.down, last.up]);
    if (hist.length > N) hist.shift();
    render(last);
  });
}

$("k-down").textContent = t({ "zh-TW": "下載", "zh-CN": "下载", en: "Down" });
$("k-up").textContent = t({ "zh-TW": "上傳", "zh-CN": "上传", en: "Up" });
widget.settings.onChange((s) => { opts = s; if (last) render(last); });
widget.appearance.onChange(() => last && render(last));
