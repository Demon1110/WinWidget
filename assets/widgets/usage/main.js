const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
// one slot per step, newest last; null where nothing was recorded
let cpu = [], mem = [];
let stop = null;

const span = () => Number(opts.span) || 300;              // seconds shown
const step = () => Math.max(1, Math.round(span() / 150));  // seconds per slot
const slots = () => Math.round(span() / step());

const SPANS = {
  60: { "zh-TW": "1 分鐘", "zh-CN": "1 分钟", en: "1 min" },
  300: { "zh-TW": "5 分鐘", "zh-CN": "5 分钟", en: "5 min" },
  900: { "zh-TW": "15 分鐘", "zh-CN": "15 分钟", en: "15 min" },
};

/** Starts with what WinWidget recorded before this widget was here, then follows live. */
async function start() {
  if (stop) stop();
  const n = slots();
  cpu = Array(n).fill(null);
  mem = Array(n).fill(null);
  try {
    const h = await widget.system.history();
    const from = h.now - span() * 1000, ms = step() * 1000;
    for (const [at, c, m] of h.points) {
      const i = Math.floor((at - from) / ms);
      if (i >= 0 && i < n) { cpu[i] = c; mem[i] = m; }
    }
    // the newest reading goes in the last slot, so the live line continues it without a break
    let gap = 0;
    while (gap < 3 && gap < n && cpu[n - 1 - gap] == null) gap++;
    if (gap < 3 && gap > 0) {
      cpu = [...Array(gap).fill(null), ...cpu.slice(0, n - gap)];
      mem = [...Array(gap).fill(null), ...mem.slice(0, n - gap)];
    }
  } catch { /* no history: the graph fills from now */ }
  stop = widget.system.subscribe(["cpu", "memory"], (d) => {
    if (d.cpu) push(cpu, d.cpu.usage);
    if (d.memory) push(mem, d.memory.usage);
    render();
  }, { interval: step() * 1000 });
}

function push(list, v) {
  list.push(Math.max(0, Math.min(100, v)));
  if (list.length > slots()) list.splice(0, list.length - slots());
}

/** Line and filled area, broken where no reading exists. */
function paths(list) {
  let line = "", area = "", seg = [];
  const flush = () => {
    if (seg.length > 1) {
      const d = seg.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
      line += d;
      area += `${d}L${seg[seg.length - 1][0]} 100L${seg[0][0]} 100Z`;
    }
    seg = [];
  };
  list.forEach((v, i) => (v == null ? flush() : seg.push([i, (100 - v).toFixed(1)])));
  flush();
  return { line, area };
}

const latest = (list) => { for (let i = list.length - 1; i >= 0; i--) if (list[i] != null) return Math.round(list[i]); return null; };

function render() {
  const c = latest(cpu), m = latest(mem);
  $("chart").setAttribute("viewBox", `0 0 ${slots() - 1} 100`);
  $("cpu").textContent = c == null ? "—" : `${c}%`;
  $("mem").textContent = m == null ? "—" : `${m}%`;
  document.body.classList.toggle("hot", c != null && c >= 85);
  document.body.classList.toggle("no-mem", opts.memory === false);

  const cp = paths(cpu);
  $("cpu-line").setAttribute("d", cp.line);
  $("cpu-area").setAttribute("d", cp.area);
  $("mem-line").setAttribute("d", opts.memory === false ? "" : paths(mem).line);

  $("big-v").innerHTML = c == null ? "—" : `${c}<small>%</small>`;
  $("big-c").textContent = opts.memory === false ? "CPU"
    : `CPU · ${t({ "zh-TW": "記憶體", "zh-CN": "内存", en: "Memory" })} ${m ?? "—"}%`;
}

$("mem-k").textContent = t({ "zh-TW": "記憶體", "zh-CN": "内存", en: "Memory" });
function labels() { $("span").textContent = t(SPANS[span()] || SPANS[300]); }

widget.settings.onChange((s) => {
  const restart = Number(s.span) !== span();
  opts = s;
  labels();
  if (restart) start(); else render();
});
widget.appearance.onChange(render);
labels();
start();
