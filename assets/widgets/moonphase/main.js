const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

// Mean synodic month and a known new moon, good to a handful of minutes.
const SYNODIC = 29.530588853;
const REF_NEW = Date.UTC(2000, 0, 6, 18, 14, 0);

const PHASES = [
  { up: 0.03, tw: "新月", cn: "新月", en: "New moon" },
  { up: 0.22, tw: "娥眉月", cn: "娥眉月", en: "Waxing crescent" },
  { up: 0.28, tw: "上弦月", cn: "上弦月", en: "First quarter" },
  { up: 0.47, tw: "盈凸月", cn: "盈凸月", en: "Waxing gibbous" },
  { up: 0.53, tw: "滿月", cn: "满月", en: "Full moon" },
  { up: 0.72, tw: "虧凸月", cn: "亏凸月", en: "Waning gibbous" },
  { up: 0.78, tw: "下弦月", cn: "下弦月", en: "Last quarter" },
  { up: 0.97, tw: "殘月", cn: "残月", en: "Waning crescent" },
  { up: 1.01, tw: "新月", cn: "新月", en: "New moon" },
];

function phaseAt(now) {
  const days = (now - REF_NEW) / 86400000;
  const cycles = Math.floor(days / SYNODIC);
  const frac = (days / SYNODIC - cycles + 1) % 1;
  const age = frac * SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  const nextNew = REF_NEW + (cycles + 1) * SYNODIC * 86400000;
  const nextFull = REF_NEW + (cycles + (frac <= 0.5 ? 0.5 : 1.5)) * SYNODIC * 86400000;
  return { frac, age, illum, nextNew, nextFull };
}

const md = (ms) => {
  const d = new Date(ms);
  return L(`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
};

function stroke() {
  const canvas = $("moon");
  const box = canvas.parentElement.getBoundingClientRect();
  const side = Math.max(40, Math.min(box.width, box.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, side, side);

  const css = getComputedStyle(document.documentElement);
  const lit = css.getPropertyValue("--w-accent").trim() || "#7de2c4";
  const dark = css.getPropertyValue("--w-track").trim() || "rgba(255,255,255,0.12)";

  const cx = side / 2;
  const cy = side / 2;
  const r = side / 2 - 1;
  const { frac } = phaseAt(Date.now());
  const cos = Math.cos(2 * Math.PI * frac);   // +1 at new, -1 at full
  const rx = Math.abs(cos) * r;
  const north = String(widget.settings.get("hemi") || "north") !== "south";
  const rightLit = north ? frac < 0.5 : frac >= 0.5;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();

  const half = (fill) => {
    ctx.beginPath();
    // the half of the disc facing the sun
    ctx.arc(cx, cy, r, rightLit ? -Math.PI / 2 : Math.PI / 2, rightLit ? Math.PI / 2 : Math.PI * 1.5, false);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  half(lit);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = cos >= 0 ? dark : lit;   // crescent carves, gibbous adds
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = css.getPropertyValue("--w-border").trim() || "transparent";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paint() {
  const now = Date.now();
  const p = phaseAt(now);
  const item = PHASES.find((x) => p.frac < x.up) || PHASES[0];

  $("title").textContent = L("月相", "月相", "Moon");
  const d = new Date(now);
  $("today").textContent = L(`${d.getMonth() + 1}/${d.getDate()}`, `${d.getMonth() + 1}/${d.getDate()}`, d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  $("phase").textContent = L(item.tw, item.cn, item.en);
  $("pct").textContent = L(`亮 ${Math.round(p.illum * 100)}%`, `亮 ${Math.round(p.illum * 100)}%`, `${Math.round(p.illum * 100)}% lit`);
  $("hint").textContent = L(
    `月齡 ${p.age.toFixed(1)} 天 · 下次滿月 ${md(p.nextFull)} · 下次新月 ${md(p.nextNew)}`,
    `月龄 ${p.age.toFixed(1)} 天 · 下次满月 ${md(p.nextFull)} · 下次新月 ${md(p.nextNew)}`,
    `Age ${p.age.toFixed(1)}d · full ${md(p.nextFull)} · new ${md(p.nextNew)}`
  );
  stroke();
}

widget.settings.onChange(paint);
widget.on("appearance", paint);
widget.on("resize", stroke);

const ro = new ResizeObserver(() => { stroke(); });
ro.observe(document.querySelector(".stage"));

paint();
setInterval(() => { if (!document.hidden) paint(); }, 600000);
