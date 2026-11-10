const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const pad = (n) => String(n).padStart(2, "0");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── the flip, worked out frame by frame ──
// Top flap: falls from upright to edge-on (gravity: it speeds up). Bottom flap: swings down from
// edge-on and lands with a small bounce. While a flap turns, the still half under it shows only the
// part the flap has already uncovered, so nothing shows through a see-through flap.
const FALL = 210, LAND = 330, STEPS = 18;
// how dark a turning flap gets, and its shadow on the half below (the colours come from the theme)
const DIM = 0.32, CAST = 0.55;
const fallAngle = (t) => 90 * t * t;                                        // degrees from upright
function landAngle(t) {                                                       // degrees from hanging
  if (t < 0.7) { const u = t / 0.7; return 90 * Math.pow(1 - u, 3); }
  return -4 * Math.sin(Math.PI * (t - 0.7) / 0.3);                            // a little past, and back
}
/** Where a flap's free edge lands on screen, as a share of the half's height from the hinge
 *  (1 = flat against the card), with the card's perspective p (in half-heights). */
const edge = (deg, p) => { const a = deg * Math.PI / 180; return Math.cos(a) * p / (p - Math.sin(a)); };
const clamp = (x) => Math.min(100, Math.max(0, x));

function flipFrames(p) {
  const top = [], hide = [], hideFace = [], dimTop = [], cast = [], castLand = [], bottom = [], show = [], showFace = [], dimBottom = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS, offset = t;
    const a = fallAngle(t), e = edge(a, p);
    top.push({ offset, transform: `rotateX(${-a}deg)` });
    // the new top shows above the falling flap's edge: its window slides up, its face stays put
    const c = clamp(e * 100).toFixed(2);
    hide.push({ offset, transform: `translateY(${-c}%)` });
    hideFace.push({ offset, transform: `translateY(${c}%)` });
    dimTop.push({ offset, opacity: (DIM * Math.sin(a * Math.PI / 180)).toFixed(3) });
    cast.push({ offset, opacity: (CAST * Math.sin(a * Math.PI / 180)).toFixed(3) });
  }
  let low = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS, offset = t;
    const a = landAngle(t);
    bottom.push({ offset, transform: `rotateX(${a}deg)` });
    // the old bottom shows below the landing flap's edge; once covered it stays covered
    low = Math.max(low, a <= 0 ? 100 : clamp(edge(a, p) * 100));
    show.push({ offset, transform: `translateY(${low.toFixed(2)}%)` });
    showFace.push({ offset, transform: `translateY(${-low.toFixed(2)}%)` });
    dimBottom.push({ offset, opacity: (DIM * Math.sin(Math.max(0, a) * Math.PI / 180)).toFixed(3) });
    // the landing flap's shadow on what is left of the old bottom
    castLand.push({ offset, opacity: (CAST * Math.sin(Math.max(0, a) * Math.PI / 180)).toFixed(3) });
  }
  return { top, hide, hideFace, dimTop, cast, castLand, bottom, show, showFace, dimBottom };
}

/** One split-flap card: two still halves and two flaps that turn on the hinge. */
function makeCard(cls) {
  const el = document.createElement("div");
  el.className = `flip ${cls}`;
  // a still half is a window around its face: sliding the two in opposite directions hides part of
  // the face without repainting it (cheaper than animating a clip)
  el.innerHTML = `<div class="half top"><div class="win"><div class="face"><span></span></div></div></div>
    <div class="half bottom"><div class="win"><div class="face"><span></span><i class="cast"></i></div></div></div>
    <div class="flap top"><span></span><i class="dim"></i></div><div class="flap bottom"><span></span><i class="dim"></i></div>`;
  const [topHalf, bottomHalf, flapTop, flapBottom] = el.children;
  const top = topHalf.querySelector(".face"), bottom = bottomHalf.querySelector(".face");
  const topWin = topHalf.firstChild, bottomWin = bottomHalf.firstChild;
  const cast = bottom.querySelector(".cast"), dimTop = flapTop.querySelector(".dim"), dimBottom = flapBottom.querySelector(".dim");
  const parts = [top, bottom, topWin, bottomWin, flapTop, flapBottom, cast, dimTop, dimBottom];
  let value = null;
  const stop = () => parts.forEach((p) => p.getAnimations().forEach((a) => a.cancel()));
  return {
    el,
    set(next, animate, delay = 0) {
      if (next === value) return;
      const old = value;
      value = next;
      stop();
      if (old == null || !animate || reduced) {
        for (const h of [top, bottom, flapTop, flapBottom]) h.firstChild.textContent = next;
        return;
      }
      // the new top waits behind; the old top falls; the new bottom swings down over the old one
      top.firstChild.textContent = next;
      flapTop.firstChild.textContent = old;
      flapBottom.firstChild.textContent = next;
      bottom.firstChild.textContent = old;
      const f = flipFrames(perspectiveOf(el));
      const fall = { duration: FALL, delay, fill: "both" };
      const land = { duration: LAND, delay: delay + FALL, fill: "both" };
      flapTop.animate(f.top, fall);
      topWin.animate(f.hide, fall);
      top.animate(f.hideFace, fall);
      dimTop.animate(f.dimTop, fall);
      cast.animate(f.cast, { duration: FALL, delay, fill: "backwards" });
      cast.animate(f.castLand, { duration: LAND, delay: delay + FALL, fill: "forwards" });
      dimBottom.animate(f.dimBottom, land);
      bottomWin.animate(f.show, land);
      bottom.animate(f.showFace, land);
      flapBottom.animate(f.bottom, land).finished.then(() => {
        flapTop.firstChild.textContent = next;
        bottom.firstChild.textContent = next;
        stop();
      }).catch(() => {});
    },
  };
}

/** The card's perspective in half-heights: deep enough that a flap barely widens as it turns. */
const DEPTH = 14;
const perspectiveOf = () => DEPTH;

const cards = { h: makeCard("hours"), m: makeCard("minutes"), s: makeCard("sec") };

function layout() {
  const row = $("row");
  row.replaceChildren(cards.h.el, cards.m.el, ...(opts.showSeconds ? [cards.s.el] : []));
  document.body.classList.toggle("with-sec", !!opts.showSeconds);
  sizeDigits();
}

/** Digits fill their card: the font size follows the card's height. */
function sizeDigits() {
  // the card's own size in CSS pixels (not on-screen pixels, which grow when the card is zoomed)
  const w = cards.h.el.offsetWidth, ht = cards.h.el.offsetHeight;
  const size = Math.min(ht * 0.7, w * 0.58);
  document.documentElement.style.setProperty("--digit", `${size.toFixed(1)}px`);
  // perspective in proportion to each card, so a flip looks the same at any size
  for (const c of Object.values(cards)) c.el.style.perspective = `${(c.el.offsetHeight / 2) * DEPTH}px`;
  cards.s.el.style.setProperty("--digit", `${(size * 0.58).toFixed(1)}px`);
}

function render(animate) {
  const now = new Date();
  const h = now.getHours();
  cards.m.set(pad(now.getMinutes()), animate);
  // like a real flip clock, the hour follows the minutes' flip a moment later
  cards.h.set(opts.use24h ? pad(h) : String(h % 12 || 12), animate, 90);
  if (opts.showSeconds) cards.s.set(pad(now.getSeconds()), animate);
  $("ampm").textContent = opts.use24h ? "" : h < 12 ? t({ zh: "上午", en: "AM" }) : t({ zh: "下午", en: "PM" });
  const loc = widget.locale;
  $("date").textContent = new Intl.DateTimeFormat(loc, widget.theme === "paper"
    ? { month: "long", day: "numeric", weekday: "long" }
    : { month: "long", day: "numeric", weekday: "short" }).format(now);
  document.body.classList.toggle("no-date", !opts.showDate);
  document.body.classList.toggle("no-head", !opts.showDate && opts.use24h);
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  render(true);
  const now = Date.now();
  timer = setTimeout(schedule, opts.showSeconds ? 1000 - (now % 1000) + 5 : 60000 - (now % 60000) + 20);
}

widget.settings.onChange((s) => {
  const relayout = s.showSeconds !== opts.showSeconds;
  opts = s;
  if (relayout) layout();
  render(false);
  requestAnimationFrame(sizeDigits);
  schedule();
});
widget.appearance.onChange(() => { render(false); requestAnimationFrame(sizeDigits); });
let sizing = 0;
new ResizeObserver(() => { cancelAnimationFrame(sizing); sizing = requestAnimationFrame(sizeDigits); }).observe($("row"));
layout();
render(false);
schedule();
