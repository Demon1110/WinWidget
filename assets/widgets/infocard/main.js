const card = document.getElementById("card");
let opts = widget.settings.get();
let sys = {};
let unsubscribe = null;

const pad = (n) => String(n).padStart(2, "0");
const gb = (b) => (b / 2 ** 30).toFixed(1);
function speed(bps) {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let v = bps, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Every {token}; system ones show "–" until the first sample arrives. */
function tokens(now) {
  const loc = widget.locale;
  const disk = (name) => {
    const d = (sys.disk || []).find((x) => x.name.toUpperCase() === `${(name || "C").toUpperCase().replace(":", "")}:`);
    return d ? Math.round(d.usage) : "–";
  };
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    seconds: pad(now.getSeconds()),
    date: new Intl.DateTimeFormat(loc, { month: "long", day: "numeric" }).format(now),
    weekday: new Intl.DateTimeFormat(loc, { weekday: "long" }).format(now),
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    cpu: sys.cpu ? Math.round(sys.cpu.usage) : "–",
    mem: sys.memory ? Math.round(sys.memory.usage) : "–",
    memUsed: sys.memory ? gb(sys.memory.used) : "–",
    memTotal: sys.memory ? gb(sys.memory.total) : "–",
    down: sys.network ? speed(sys.network.down) : "–",
    up: sys.network ? speed(sys.network.up) : "–",
    disk,
    battery: sys.battery ? (sys.battery.present ? sys.battery.percent : "–") : "–",
  };
}

const SYSTEM_TOKENS = /\{(cpu|mem|memUsed|memTotal|down|up|disk(:[A-Za-z])?|battery)\}/;
const TOPIC = { cpu: "cpu", mem: "memory", memUsed: "memory", memTotal: "memory", down: "network", up: "network", disk: "disk", battery: "battery" };

/** Fills tokens into a line; values get their own span so themes can style the figures. */
function fill(line, values) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of line.matchAll(/\{(\w+)(?::(\w))?\}/g)) {
    frag.append(line.slice(last, m.index));
    const v = values[m[1]];
    if (v === undefined) frag.append(m[0]);
    else {
      const span = document.createElement("span");
      span.className = "num";
      span.textContent = typeof v === "function" ? v(m[2]) : v;
      frag.append(span);
    }
    last = m.index + m[0].length;
  }
  frag.append(line.slice(last));
  return frag;
}

function render() {
  const values = tokens(new Date());
  card.className = `card ${opts.align === "center" ? "center" : ""}`;
  card.replaceChildren(...String(opts.template || "").split("\n").map((raw) => {
    let cls = "p", text = raw;
    if (raw.trim() === "---") { const hr = document.createElement("div"); hr.className = "rule"; return hr; }
    if (raw.trim() === "") { const g = document.createElement("div"); g.className = "gap"; return g; }
    if (raw.startsWith("# ")) { cls = "h1"; text = raw.slice(2); }
    else if (raw.startsWith("## ")) { cls = "h2"; text = raw.slice(3); }
    const el = document.createElement("p");
    el.className = cls;
    el.append(fill(text, values));
    return el;
  }));
  if (card.scrollHeight > card.clientHeight + 1) fit();
}

/** Makes the lines a little smaller (down to 80%) until they fit; if that isn't enough, the last lines give way. */
function fit() {
  let z = 1;
  const lines = [...card.children];
  lines.forEach((l) => { l.hidden = false; });
  card.style.setProperty("--fit", z);
  while (card.scrollHeight > card.clientHeight + 1 && z > 0.81) { z -= 0.05; card.style.setProperty("--fit", z); }
  for (let i = lines.length - 1; i > 0 && card.scrollHeight > card.clientHeight + 1; i--) lines[i].hidden = true;
}
new ResizeObserver(() => fit()).observe(card);

function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const tpl = String(opts.template || "");
  if (!SYSTEM_TOKENS.test(tpl)) return;
  const topics = [...new Set([...tpl.matchAll(/\{(\w+)/g)].map((m) => TOPIC[m[1]]).filter(Boolean))];
  unsubscribe = widget.system.subscribe(topics, (d) => { sys = { ...sys, ...d }; render(); }, { interval: 1000 });
}

function tick() {
  render();
  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}

widget.settings.onChange((s) => { opts = s; subscribe(); render(); });
subscribe();
tick();
