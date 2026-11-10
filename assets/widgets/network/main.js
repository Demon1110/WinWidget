const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
const N = 30;          // pings kept
const pings = [];      // ms, or null when it failed
let net = null;        // { online, adapters }
let publicIp = "";

const target = () => (opts.target || "").trim() || "1.1.1.1";

async function readAdapters() {
  try { net = await widget.system.adapters(); } catch (e) { widget.log(`network: ${e.message}`); }
}

async function readPublicIp() {
  if (!opts.showPublic) { publicIp = ""; return; }
  try {
    const r = await widget.fetch("https://get.geojs.io/v1/ip.json");
    publicIp = r.ok ? (await r.json()).ip || "" : "";
  } catch { publicIp = ""; }
}

let pingTimer = 0, run = 0;
/** One loop at a time: restarting (new settings) makes an older loop stop after its ping. */
async function pingLoop() {
  clearTimeout(pingTimer);
  const mine = ++run;
  let ms = null;
  try {
    const r = await widget.system.ping(target());
    ms = r.ok ? r.ms : null;
  } catch (e) {
    // too soon after the previous loop's ping: not a lost packet, just try again shortly
    if (/once a second/.test(e.message)) { if (mine === run) pingTimer = setTimeout(pingLoop, 1100); return; }
    widget.log(`network: ${e.message}`);
  }
  if (mine !== run) return;
  pings.push(ms);
  if (pings.length > N) pings.shift();
  // a failed ping may mean the adapter changed: look again
  if (ms == null) await readAdapters();
  render();
  pingTimer = setTimeout(pingLoop, (Number(opts.interval) || 5) * 1000);
}

function render() {
  if (!net) return;
  const main = net.adapters[0];
  const last = pings[pings.length - 1];
  const tried = pings.length > 0;
  const state = !net.online || !main ? "off" : tried && last == null ? "bad" : "ok";
  document.body.dataset.state = state;

  $("status").textContent = state === "off" ? t({ "zh-TW": "沒有連線", "zh-CN": "没有连接", en: "Offline" })
    : state === "bad" ? t({ "zh-TW": "已連線，但連不到外面", "zh-CN": "已连接，但连不到外面", en: "Connected, can't reach out" })
    : t({ "zh-TW": "已連線", "zh-CN": "已连接", en: "Connected" });
  $("via").textContent = main && state !== "off" ? main.name : "";

  $("ms").innerHTML = last != null ? `${last}<small>ms</small>` : "—";
  $("cap").textContent = t({ "zh-TW": `延遲 · ${target()}`, "zh-CN": `延迟 · ${target()}`, en: `Latency · ${target()}` });

  // latency on a gentle log scale up to 400 ms; misses stand as short red marks
  const h = (ms) => Math.max(8, Math.min(100, (Math.log10(1 + ms) / Math.log10(401)) * 100));
  $("bars").innerHTML = Array.from({ length: N }, (_, i) => {
    const k = i - (N - pings.length);
    if (k < 0) return `<i class="empty"></i>`;
    const v = pings[k];
    return v == null ? `<i class="miss"></i>` : `<i class="${v >= 150 ? "slow" : ""}" style="height:${h(v).toFixed(0)}%"></i>`;
  }).join("");

  const lost = pings.filter((v) => v == null).length;
  const rows = [];
  if (main) {
    rows.push([t({ "zh-TW": "本機 IP", "zh-CN": "本机 IP", en: "Local IP" }), main.ipv4[0] || main.ipv6[0] || "—"]);
    rows.push([t({ "zh-TW": "閘道", "zh-CN": "网关", en: "Gateway" }), main.gateways[0] || "—"]);
  }
  if (opts.showPublic) rows.push([t({ "zh-TW": "對外 IP", "zh-CN": "公网 IP", en: "Public IP" }), publicIp || "—"]);
  if (tried) rows.push([t({ "zh-TW": "掉包", "zh-CN": "丢包", en: "Loss" }), `${Math.round((lost / pings.length) * 100)}%`]);
  $("facts").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="w-num">${esc(v)}</dd></div>`).join("");
}

widget.settings.onChange(async (s) => {
  const retarget = (s.target || "") !== (opts.target || "");
  opts = s;
  if (retarget) pings.length = 0;
  await readPublicIp();
  pingLoop();
});
widget.appearance.onChange(render);

(async () => {
  await readAdapters();
  render();
  readPublicIp().then(render);
  pingLoop();
  setInterval(readAdapters, 30e3);
  setInterval(() => opts.showPublic && readPublicIp().then(render), 10 * 60e3);
})();
