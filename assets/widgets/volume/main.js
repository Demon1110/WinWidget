const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let a = null;           // { available, volume, muted, device }
let dragging = false;
const CELLS = 25;

$("cells").innerHTML = "<i></i>".repeat(CELLS);

const SPEAKER = "M4 9.5h3.5L12 5.5v13l-4.5-4H4z";
function icon(volume, muted) {
  const waves = muted ? `<path d="M16 9.5l5 5M21 9.5l-5 5"/>`
    : `${volume > 0 ? `<path d="M15.5 9a4 4 0 0 1 0 6"/>` : ""}${volume > 50 ? `<path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>` : ""}`;
  return `<path class="body" d="${SPEAKER}"/>${waves}`;
}

function render() {
  if (!a) return;
  const off = !a.available;
  document.body.classList.toggle("off", off);
  document.body.classList.toggle("muted", !!a.muted);
  const v = Math.round(a.volume);
  $("pct").innerHTML = off ? "—" : `${v}<small>%</small>`;
  $("dev").textContent = off ? t({ "zh-TW": "沒有聲音輸出裝置", "zh-CN": "没有声音输出设备", en: "No speakers" })
    : a.muted ? t({ "zh-TW": "已靜音", "zh-CN": "已静音", en: "Muted" }) + (a.device ? ` · ${a.device}` : "") : a.device;
  $("spk").innerHTML = icon(v, a.muted);
  $("mute").title = a.muted ? t({ "zh-TW": "取消靜音", "zh-CN": "取消静音", en: "Unmute" }) : t({ "zh-TW": "靜音", "zh-CN": "静音", en: "Mute" });
  $("fill").style.width = `${v}%`;
  $("knob").style.left = `${v}%`;
  const lit = Math.round((v / 100) * CELLS);
  [...$("cells").children].forEach((c, i) => c.classList.toggle("on", i < lit));
  $("slider").setAttribute("aria-valuenow", String(v));
}

// ── changing it ──
let sendTimer = 0, pending = null;
/** Shows the new level at once; tells Windows at most every 60 ms while it keeps moving. */
function setVolume(v) {
  if (!a || !a.available) return;
  v = Math.max(0, Math.min(100, Math.round(v)));
  a = { ...a, volume: v, muted: v === 0 ? a.muted : false };
  render();
  pending = v;
  if (!sendTimer) sendTimer = setTimeout(flush, 60);
}
function flush() {
  sendTimer = 0;
  if (pending == null) return;
  const v = pending;
  pending = null;
  widget.audio.set({ volume: v, muted: a.muted && v > 0 ? false : undefined }).catch((e) => widget.log(`volume: ${e.message}`));
}

function fromPointer(e) {
  const r = $("slider").getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * 100;
}
$("slider").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  dragging = true;
  $("slider").setPointerCapture(e.pointerId);
  setVolume(fromPointer(e));
});
$("slider").addEventListener("pointermove", (e) => { if (dragging) setVolume(fromPointer(e)); });
$("slider").addEventListener("pointerup", () => { dragging = false; });
$("slider").addEventListener("pointercancel", () => { dragging = false; });
$("slider").addEventListener("keydown", (e) => {
  const step = Number(opts.step) || 2;
  const keys = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 10, PageDown: -10 };
  if (e.key in keys) { e.preventDefault(); setVolume(a.volume + keys[e.key]); }
  if (e.key === "Home") setVolume(0);
  if (e.key === "End") setVolume(100);
});
// scrolling anywhere over the widget
document.addEventListener("wheel", (e) => {
  if (!a) return;
  e.preventDefault();
  setVolume(a.volume + (e.deltaY < 0 ? 1 : -1) * (Number(opts.step) || 2));
}, { passive: false });

$("mute").onclick = () => {
  if (!a || !a.available) return;
  a = { ...a, muted: !a.muted };
  render();
  widget.audio.set({ muted: a.muted }).catch((e) => widget.log(`volume: ${e.message}`));
};

widget.audio.onChange((s) => {
  // while dragging, our own value wins; Windows' echo would make the knob jitter
  if (dragging || pending != null) return;
  a = s;
  render();
});
widget.settings.onChange((s) => { opts = s; });
widget.appearance.onChange(render);
