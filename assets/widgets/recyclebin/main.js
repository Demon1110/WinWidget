const $ = (id) => document.getElementById(id);
const t = widget.t;
let bin = null;
let armed = 0; // timer while "click again" is showing
let busy = false;

function size(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 * 0.95 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

async function refresh() {
  try { bin = await widget.recycleBin.query(); } catch (e) { widget.log(`recyclebin: ${e.message}`); }
  render();
}

function render() {
  const empty = !bin || bin.items === 0;
  document.body.classList.toggle("is-empty", empty);
  $("count").textContent = bin ? bin.items.toLocaleString(widget.locale) : "—";
  $("unit").textContent = t({ "zh-TW": " 個項目", "zh-CN": " 个项目", en: bin && bin.items === 1 ? " item" : " items" });
  $("size").textContent = !bin ? "" : empty ? t({ "zh-TW": "已經是空的", "zh-CN": "已经是空的", en: "Nothing in it" })
    : t({ "zh-TW": `共 ${size(bin.size)}`, "zh-CN": `共 ${size(bin.size)}`, en: `${size(bin.size)} in all` });
  // how full, on a log scale: 1 MB shows a little, 10 GB fills it
  const frac = bin && bin.size > 0 ? Math.min(1, Math.log10(bin.size / 1048576 + 1) / Math.log10(10241)) : 0;
  const h = Math.max(bin && bin.items ? 3 : 0, frac * 32);
  $("level").setAttribute("y", (44 - h).toFixed(1));
  $("level").setAttribute("height", h.toFixed(1));

  $("empty").disabled = empty || busy;
  $("empty").classList.toggle("armed", !!armed);
  $("empty").textContent = busy ? t({ "zh-TW": "正在清空…", "zh-CN": "正在清空…", en: "Emptying…" })
    : armed ? t({ "zh-TW": "再按一次清空", "zh-CN": "再按一次清空", en: "Click again" })
    : t({ "zh-TW": "清空", "zh-CN": "清空", en: "Empty" });
}

/** Emptying deletes for good, so the first click only asks; the second, within 4 s, does it. */
$("empty").onclick = async () => {
  if (busy) return;
  if (!armed) {
    armed = setTimeout(() => { armed = 0; render(); }, 4000);
    render();
    return;
  }
  clearTimeout(armed);
  armed = 0;
  busy = true;
  render();
  try { bin = await widget.recycleBin.empty(); } catch (e) { widget.log(`recyclebin: ${e.message}`); }
  busy = false;
  render();
};
$("open").textContent = t({ "zh-TW": "打開", "zh-CN": "打开", en: "Open" });
$("open").onclick = () => widget.recycleBin.open().catch(() => {});

widget.appearance.onChange(render);
refresh();
setInterval(refresh, 10e3);
