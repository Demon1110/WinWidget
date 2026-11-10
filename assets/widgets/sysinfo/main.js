const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const HOT = 85;
const history = { down: [], up: [] };

$("l-down").textContent = t({ "zh-TW": "下載", "zh-CN": "下载", en: "Down" });
$("l-up").textContent = t({ "zh-TW": "上傳", "zh-CN": "上传", en: "Up" });
document.documentElement.style.setProperty("--hot-label", `" · ${t({ "zh-TW": "快滿", "zh-CN": "快满", en: "high" })}"`);

const ROWS = [
  { key: "cpu", name: "CPU" },
  { key: "mem", name: t({ "zh-TW": "記憶體", "zh-CN": "内存", en: "Memory" }), sub: true },
  { key: "disk", name: "", sub: true },
];

$("rows").innerHTML = ROWS.map((r) => `
  <div class="row${r.sub ? " has-sub" : ""}" data-k="${r.key}">
    <span class="dot"></span><span class="k w-label">${r.name}</span><span class="leader"></span>
    <span class="v w-num">–</span>
    <div class="w-bar"><i></i></div>
    <span class="sub"></span>
  </div>`).join("");

const R = [58, 43, 28];
$("rings").innerHTML = R.map((r, i) => `
  <circle class="track" cx="66" cy="66" r="${r}"/>
  <circle class="arc r${i}" cx="66" cy="66" r="${r}" transform="rotate(-90 66 66)" stroke-dasharray="0 999"/>`).join("");

const gb = (b) => (b / 2 ** 30).toFixed(b >= 100 * 2 ** 30 ? 0 : 1);
function speed(bps) {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let v = bps, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function driveName() {
  const d = (opts.drive || "C:").toUpperCase().replace(/[\\/]+$/, "");
  return d.endsWith(":") ? d : d + ":";
}

function setRow(index, value, sub) {
  const row = $("rows").children[index];
  const hot = value != null && value >= HOT;
  row.classList.toggle("hot", hot);
  row.querySelector(".v").innerHTML = value == null ? "–" : `${Math.round(value)}<span class="pct">%</span>`;
  row.querySelector(".w-bar").classList.toggle("is-warn", hot);
  row.querySelector(".w-bar i").style.width = `${value ?? 0}%`;
  row.querySelector(".sub").textContent = sub || "";
  const arc = $("rings").querySelectorAll(".arc")[index];
  const c = 2 * Math.PI * R[index];
  arc.setAttribute("stroke-dasharray", `${(c * (value ?? 0)) / 100} ${c}`);
  arc.classList.toggle("hot", hot);
}

function spark(id, list) {
  const max = Math.max(1, ...list);
  $(id).innerHTML = list.map((v) => `<i style="height:${Math.max(8, (v / max) * 100)}%"></i>`).join("");
}

function update(d) {
  if (d.cpu) setRow(0, d.cpu.usage);
  if (d.memory) setRow(1, d.memory.usage, `${gb(d.memory.used)} / ${gb(d.memory.total)} GB`);
  if (d.disk) {
    const name = driveName();
    const disk = d.disk.find((x) => x.name.toUpperCase() === name);
    $("rows").children[2].querySelector(".k").textContent = t({ "zh-TW": `${name[0]} 槽`, "zh-CN": `${name[0]} 盘`, en: `Drive ${name}` });
    setRow(2, disk ? disk.usage : null, disk ? t({ "zh-TW": `剩 ${gb(disk.free)} GB`, "zh-CN": `剩余 ${gb(disk.free)} GB`, en: `${gb(disk.free)} GB free` }) : "");
  }
  if (d.network) {
    $("down").textContent = speed(d.network.down);
    $("up").textContent = speed(d.network.up);
    for (const k of ["down", "up"]) {
      history[k].push(d.network[k]);
      if (history[k].length > 20) history[k].shift();
    }
    spark("s-down", history.down);
    spark("s-up", history.up);
  }
}

let unsubscribe = null;
function start() {
  if (unsubscribe) unsubscribe();
  unsubscribe = widget.system.subscribe(["cpu", "memory", "disk", "network"], update, { interval: Number(opts.interval) || 1000 });
}

widget.settings.onChange((s) => { opts = s; start(); });
start();
