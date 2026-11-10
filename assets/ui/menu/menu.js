"use strict";
/* WinWidget popup menu. The host sends entries ("open"/"update"); this page draws them,
   reports its size, and sends back what was chosen ("invoke") or that it should close. */

const host = window.chrome && window.chrome.webview;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const css = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

const wrap = $("wrap"), card = $("card"), panels = $("panels");
let items = [];
let stack = [];     // ids of the open submenus
let active = null;  // the highlighted entry
let shape = "";     // ids and kinds, to tell a value change from a new menu

const send = (m, p) => host && host.postMessage(p === undefined ? { m } : { m, p });

if (host) {
  host.addEventListener("message", (e) => {
    const { ev, d } = e.data || {};
    if (ev === "open") open(d);
    else if (ev === "update") update(d.items);
    else if (ev === "shown") requestAnimationFrame(() => card.classList.add("in"));
    else if (ev === "reset") reset();
  });
  send("ready");
}

// ───────────────────────── drawing ─────────────────────────

function open(d) {
  items = d.items;
  stack = [];
  document.body.className = `${d.upward ? "up" : "down"} ${d.alignRight ? "right" : "left"}`;
  card.classList.remove("in");
  render();
  reportSize();
}

function reset() {
  card.classList.remove("in");
  panels.innerHTML = "";
  active = null;
}

function shapeOf(list) {
  return list.map((i) => i.kind + i.id + (i.items ? `[${shapeOf(i.items)}]` : "")).join(",");
}

function subsOf(list, out = []) {
  for (const i of list) {
    if (i.kind === "sub") { out.push(i); subsOf(i.items, out); }
  }
  return out;
}

function render() {
  shape = shapeOf(items);
  const subs = subsOf(items);
  panels.innerHTML = `<div class="hl" id="hl"></div>` +
    page("root", items, null) + subs.map((s) => page(s.id, s.items, s)).join("");
  stack = stack.filter((id) => subs.some((s) => s.id === id));
  showPage(current(), null);
  placeSegMarks(true);
}

const current = () => (stack.length ? stack[stack.length - 1] : "root");

function page(id, list, parent) {
  const back = parent
    ? `<button class="it back" data-kind="back"><span class="chev l"></span><span class="tx">${esc(parent.text)}</span></button><div class="sep"></div>`
    : "";
  return `<section class="panel" data-page="${id}">${back}${list.map(entry).join("")}</section>`;
}

function entry(i) {
  const icon = i.icon ? `<img src="${i.icon}" alt="">` : "";
  const dis = i.disabled ? " disabled" : "";
  switch (i.kind) {
    case "sep":
      return `<div class="sep"></div>`;
    case "header":
      return `<div class="head">${i.icon ? `<img class="${i.icon.startsWith("data:image/svg+xml;utf8") ? "logo" : ""}" src="${i.icon}" alt="">` : ""}
        <div style="min-width:0"><div class="h-t">${esc(i.text)}</div>${i.hint ? `<div class="h-s" data-hint="${i.id}">${esc(i.hint)}</div>` : ""}</div></div>`;
    case "toggle":
      return `<button class="it" role="menuitemcheckbox" aria-checked="${!!i.on}" data-id="${i.id}" data-kind="toggle"${dis}>
        <span class="tx">${esc(i.text)}</span><span class="sw"></span></button>`;
    case "seg":
      return `<div class="it" role="group" data-id="${i.id}" data-kind="seg"><span class="tx">${esc(i.text)}</span>
        <span class="seg"><i class="mark"></i>${i.options.map((o) =>
          `<button data-v="${esc(o.value)}" class="${o.value === i.value ? "on" : ""}">${esc(o.label)}</button>`).join("")}</span></div>`;
    case "sub":
      return `<button class="it" role="menuitem" aria-haspopup="true" data-id="${i.id}" data-kind="sub"${dis}>${icon}
        <span class="tx">${esc(i.text)}</span>${i.hint ? `<span class="hint">${esc(i.hint)}</span>` : ""}<span class="chev"></span></button>`;
    case "check":
      return `<button class="it" role="menuitemradio" aria-checked="${!!i.on}" data-id="${i.id}" data-kind="check"${dis}>
        <span class="ck"></span>${icon}<span class="tx">${esc(i.text)}</span></button>`;
    case "row":
      return `<div class="btnrow">${i.items.map((b) => `<button class="it" data-id="${b.id}" data-kind="btn">${esc(b.text)}</button>`).join("")}</div>`;
    default:
      return `<button class="it${i.danger ? " danger" : ""}" role="menuitem" data-id="${i.id}" data-kind="item"${dis}
        ${i.confirm ? `data-confirm="${esc(i.confirm)}"` : ""}>${icon}<span class="tx">${esc(i.text)}</span>${i.hint ? `<span class="hint">${esc(i.hint)}</span>` : ""}</button>`;
  }
}

/** New values for the same menu: change them in place so switches and marks can animate. */
function update(next) {
  items = next;
  if (shapeOf(items) !== shape) { render(); reportSize(); return; }
  const walk = (list) => {
    for (const i of list) {
      const el = panels.querySelector(`[data-id="${i.id}"]`);
      if (el) {
        if (i.kind === "toggle" || i.kind === "check") el.setAttribute("aria-checked", String(!!i.on));
        if (i.kind === "seg") el.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.v === i.value));
        if (i.kind === "sub") { const h = el.querySelector(".hint"); if (h) h.textContent = i.hint || ""; }
        el.disabled = !!i.disabled;
      }
      if (i.kind === "header") { const h = panels.querySelector(`[data-hint="${i.id}"]`); if (h) h.textContent = i.hint || ""; }
      if (i.items) walk(i.items);
    }
  };
  walk(items);
  placeSegMarks(false);
}

/** The window is as tall as the tallest page, so pages can switch without resizing it. */
function reportSize() {
  const pages = [...panels.querySelectorAll(".panel")];
  const tallest = Math.max(...pages.map((p) => p.offsetHeight));
  const chrome = card.offsetHeight - panels.offsetHeight;
  const m = css("--margin");
  send("size", { w: card.offsetWidth + 2 * m, h: tallest + chrome + 2 * m, margin: m });
}

function placeSegMarks(jump) {
  panels.querySelectorAll(".seg").forEach((seg) => {
    const on = seg.querySelector("button.on");
    const mark = seg.querySelector(".mark");
    if (!on) { mark.style.width = "0"; return; }
    mark.classList.toggle("jump", jump);
    mark.style.transform = `translateX(${on.offsetLeft - 2}px)`;
    mark.style.width = `${on.offsetWidth}px`;
  });
}

// ───────────────────────── pages ─────────────────────────

function showPage(id, dir) {
  const target = panels.querySelector(`[data-page="${id}"]`);
  const prev = panels.querySelector(".panel.on");
  if (prev && prev !== target) prev.className = `panel${dir ? (dir === "in" ? " out-l" : " out-r") : ""}`;
  target.className = `panel${dir ? (dir === "in" ? " from-r" : " from-l") : ""}`;
  target.getBoundingClientRect(); // start from the offset position
  target.className = "panel on";
  panels.style.height = `${target.offsetHeight}px`;
  highlight(null);
}

function drill(sub) {
  stack.push(sub.dataset.id);
  showPage(current(), "in");
  if (document.body.classList.contains("kb")) highlight(focusables()[0] || null);
}

function back() {
  if (!stack.length) return;
  const from = stack.pop();
  showPage(current(), "out");
  if (document.body.classList.contains("kb")) highlight(panels.querySelector(`.panel.on [data-id="${from}"]`));
}

// ───────────────────────── highlight & input ─────────────────────────

function focusables() {
  return [...panels.querySelectorAll(".panel.on .it")].filter((el) => !el.disabled);
}

function highlight(el) {
  const hl = $("hl");
  if (!hl) return;
  active = el;
  if (!el) { hl.style.opacity = "0"; return; }
  const page = el.closest(".panel");
  const wasHidden = hl.style.opacity !== "1";
  hl.classList.toggle("jump", wasHidden); // appear in place; slide only between entries
  // Measured against the page and divided by its current scale: while the menu opens (scaled to
  // 98 %) the on-screen boxes are smaller, and the highlight would stay off after the animation.
  const r = el.getBoundingClientRect(), pr = page.getBoundingClientRect();
  const k = pr.width / page.offsetWidth || 1;
  hl.style.transform = `translate(${(r.left - pr.left) / k}px, ${(r.top - pr.top) / k}px)`;
  hl.style.width = `${r.width / k}px`;
  hl.style.height = `${r.height / k}px`;
  hl.style.opacity = "1";
}

function choose(el, value) {
  const kind = el.dataset.kind;
  if (el.disabled) return;
  switch (kind) {
    case "sub": return drill(el);
    case "back": return back();
    case "toggle":
      el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")); // answer at once
      return send("invoke", { id: el.dataset.id });
    case "seg": {
      const seg = el.querySelector(".seg");
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === value));
      placeSegMarks(false);
      return send("invoke", { id: el.dataset.id, value });
    }
    case "item":
      if (el.dataset.confirm && !el.classList.contains("armed")) {
        // ask once more, in place
        el.classList.add("armed");
        el.querySelector(".tx").textContent = el.dataset.confirm;
        return;
      }
      return send("invoke", { id: el.dataset.id });
    default:
      return send("invoke", { id: el.dataset.id });
  }
}

panels.addEventListener("mousemove", (e) => {
  document.body.classList.remove("kb");
  const el = e.target.closest(".panel.on .it");
  if (el !== active) highlight(el && !el.disabled ? el : null);
});
card.addEventListener("mouseleave", () => { if (!document.body.classList.contains("kb")) highlight(null); });

panels.addEventListener("click", (e) => {
  const segBtn = e.target.closest(".seg button");
  const el = e.target.closest(".panel.on .it");
  if (!el) return;
  if (el.dataset.kind === "seg") { if (segBtn) choose(el, segBtn.dataset.v); return; }
  choose(el);
});

// a click on the transparent margin around the card closes the menu
wrap.addEventListener("mousedown", (e) => { if (!card.contains(e.target)) send("close"); });

document.addEventListener("keydown", (e) => {
  const list = focusables();
  const i = list.indexOf(active);
  const move = (dir) => {
    document.body.classList.add("kb");
    // nothing highlighted yet: ↓ starts at the top, ↑ at the bottom
    const next = i < 0 ? list[dir > 0 ? 0 : list.length - 1] : list[(i + dir + list.length) % list.length];
    highlight(next || null);
  };
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); return move(1);
    case "ArrowUp": e.preventDefault(); return move(-1);
    case "Home": e.preventDefault(); document.body.classList.add("kb"); return highlight(list[0]);
    case "End": e.preventDefault(); document.body.classList.add("kb"); return highlight(list[list.length - 1]);
    case "Enter":
    case " ":
      e.preventDefault();
      if (active && active.dataset.kind !== "seg") choose(active);
      return;
    case "ArrowRight":
    case "ArrowLeft": {
      e.preventDefault();
      if (active && active.dataset.kind === "seg") {
        const opts = [...active.querySelectorAll(".seg button")];
        const at = opts.findIndex((b) => b.classList.contains("on"));
        const next = opts[Math.min(opts.length - 1, Math.max(0, at + (e.key === "ArrowRight" ? 1 : -1)))];
        if (next && next !== opts[at]) choose(active, next.dataset.v);
        return;
      }
      if (e.key === "ArrowRight" && active && active.dataset.kind === "sub") return choose(active);
      if (e.key === "ArrowLeft") return back();
      return;
    }
    case "Backspace": e.preventDefault(); return back();
    case "Escape": e.preventDefault(); return stack.length ? back() : send("close");
  }
});
