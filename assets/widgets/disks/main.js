const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let disks = null;

/** Sizes the way Windows shows them: 1 GB = 1024³ bytes. */
function size(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 * 0.95 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function render() {
  if (!disks) return;
  const list = disks.filter((d) => opts.removable !== false || d.type !== "removable");
  $("drives").style.setProperty("--n", Math.max(1, list.length));
  $("drives").innerHTML = list.map((d) => {
    const full = d.usage >= 90;
    const label = d.label || (d.type === "removable"
      ? t({ "zh-TW": "隨身碟", "zh-CN": "U 盘", en: "USB drive" })
      : t({ "zh-TW": "本機磁碟", "zh-CN": "本地磁盘", en: "Local disk" }));
    return `<li class="drive${full ? " full" : ""}">
      <span class="name w-num">${esc(d.name)}</span>
      <span class="label">${esc(label)}<span class="avail"> · ${t({ "zh-TW": "可用", "zh-CN": "可用", en: "free" })}</span></span>
      <span class="pct w-num">${Math.round(d.usage)}<small>%</small></span>
      <span class="w-bar bar${full ? " is-warn" : ""}"><i style="width:${d.usage}%"></i></span>
      <span class="free">${t({ "zh-TW": `可用 ${size(d.free)}，共 ${size(d.total)}`, "zh-CN": `可用 ${size(d.free)}，共 ${size(d.total)}`, en: `${size(d.free)} free of ${size(d.total)}` })}</span>
      <span class="big w-display">${size(d.free)}</span>
    </li>`;
  }).join("");
}

// free space changes slowly; WinWidget re-reads drives every 15 seconds
widget.system.subscribe("disk", (d) => { disks = d.disk; render(); }, { interval: 15000 });
widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
