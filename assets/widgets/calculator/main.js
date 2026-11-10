const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let history = []; // { expr, value }, newest last
let justDone = false; // the last key was "=": typing a digit starts afresh

// ── a small parser: + − × ÷, parentheses, unary minus, postfix %; no eval() ──
class CalcError extends Error {}

function tokenize(src) {
  const s = src.replace(/×/g, "*").replace(/[÷/]/g, "/").replace(/[−–—]/g, "-").replace(/，|,/g, "").replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (!m) throw new CalcError("number");
      out.push({ n: parseFloat(m[0]) });
      i += m[0].length;
    } else if ("+-*/()%^".includes(c)) { out.push({ op: c }); i++; }
    else throw new CalcError(`char ${c}`);
  }
  return out;
}

function evaluate(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const take = (op) => (peek() && peek().op === op ? (i++, true) : false);
  // expr := term (('+'|'-') term)*
  function expr() {
    let v = term();
    for (;;) {
      if (take("+")) v += term();
      else if (take("-")) v -= term();
      else return v;
    }
  }
  // term := unary (('*'|'/') unary | implicit multiplication before '(')*
  function term() {
    let v = unary();
    for (;;) {
      if (take("*")) v *= unary();
      else if (take("/")) { const d = unary(); if (d === 0) throw new CalcError("÷0"); v /= d; }
      else if (peek() && peek().op === "(") v *= unary();
      else return v;
    }
  }
  // unary := ('-'|'+') unary | power — a sign binds looser than ^, so -2^2 = -(2^2) = -4
  function unary() {
    if (take("-")) return -unary();
    if (take("+")) return unary();
    return power();
  }
  // power := postfix ('^' unary)? — right-associative, and the exponent may have a sign (2^-2)
  function power() {
    const b = postfix();
    return take("^") ? Math.pow(b, unary()) : b;
  }
  function postfix() {
    let v = atom();
    while (take("%")) v /= 100;
    return v;
  }
  function atom() {
    const tk = toks[i++];
    if (!tk) throw new CalcError("end");
    if (tk.n !== undefined) return tk.n;
    if (tk.op === "(") {
      const v = expr();
      take(")"); // a missing ")" at the end is forgiven
      return v;
    }
    throw new CalcError(`unexpected ${tk.op}`);
  }
  if (!toks.length) throw new CalcError("empty");
  const v = expr();
  if (i < toks.length) throw new CalcError("trailing");
  if (!Number.isFinite(v)) throw new CalcError("overflow");
  return v;
}

/** 12 significant digits hide float noise (0.1 + 0.2 → 0.3). */
function show(v) {
  const r = Number(v.toPrecision(12));
  if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-9 && r !== 0)) return r.toExponential(6).replace(/\.?0+e/, "e");
  return new Intl.NumberFormat(widget.locale, { maximumFractionDigits: 10, useGrouping: opts.grouping !== false }).format(r);
}
const plain = (v) => String(Number(v.toPrecision(12)));

// ── screen ──
function preview() {
  const src = $("expr").value;
  let text = "", bad = false;
  if (src.trim() && /[-+*/×÷−%^(]/.test(src.replace(/^-/, ""))) {
    try { text = "= " + show(evaluate(src)); } catch (e) { bad = !(e instanceof CalcError && /end|empty/.test(e.message)); }
  }
  $("result").textContent = text;
  $("expr").classList.toggle("bad", bad);
}

function renderHistory() {
  $("history").innerHTML = history.slice(-6).map((h) => `<li><button data-v="${esc(h.value)}" title="${esc(t({ "zh-TW": "用這個結果", "zh-CN": "用这个结果", en: "Use this result" }))}">
    <span class="q">${esc(h.expr)} =</span><span class="a w-num">${esc(show(Number(h.value)))}</span></button></li>`).join("");
  $("history").scrollTop = $("history").scrollHeight;
}

function equals() {
  const src = $("expr").value.trim();
  if (!src) return;
  try {
    const v = evaluate(src);
    history.push({ expr: src.replace(/\*/g, "×").replace(/\//g, "÷"), value: plain(v) });
    if (history.length > 30) history.shift();
    widget.storage.set("history", history);
    $("expr").value = plain(v).replace("-", "−");
    $("result").textContent = "";
    justDone = true;
    renderHistory();
    $("expr").animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180 });
  } catch (e) {
    $("result").textContent = e.message === "÷0" ? t({ "zh-TW": "不能除以 0", "zh-CN": "不能除以 0", en: "Can't divide by 0" })
      : t({ "zh-TW": "算式不完整", "zh-CN": "算式不完整", en: "Incomplete sum" });
    $("expr").classList.add("bad");
  }
}

function press(k) {
  const box = $("expr");
  if (k === "=") return equals();
  if (k === "C") { box.value = ""; justDone = false; preview(); return; }
  if (k === "⌫") { box.value = box.value.slice(0, -1); justDone = false; preview(); return; }
  if (justDone && /[0-9.(]/.test(k)) box.value = "";
  justDone = false;
  box.value += k;
  preview();
}

const KEYS = [["C", "fn"], ["(", "fn"], [")", "fn"], ["÷", "op"], ["7"], ["8"], ["9"], ["×", "op"], ["4"], ["5"], ["6"], ["−", "op"],
  ["1"], ["2"], ["3"], ["+", "op"], ["0"], ["."], ["⌫", "fn"], ["=", "eq"]];
$("keys").innerHTML = KEYS.map(([k, cls]) => `<button class="k ${cls || "num"}" data-k="${k}">${k}</button>`).join("");
$("keys").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  const k = b.dataset.k;
  press(k === "−" ? "−" : k);
});
// what the keyboard types (* / -) is shown as the keypad's signs; same length, so the caret stays put
$("expr").addEventListener("input", () => {
  const box = $("expr");
  const shown = box.value.replace(/\*/g, "×").replace(/\//g, "÷").replace(/(?<=[\d)%.])-|^-(?=$)/g, "−");
  if (shown !== box.value) {
    const at = box.selectionStart;
    box.value = shown;
    box.setSelectionRange(at, at);
  }
  justDone = false;
  preview();
});
$("expr").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "=") { e.preventDefault(); equals(); }
  else if (e.key === "Escape") { e.preventDefault(); press("C"); }
  else if (justDone && /^[0-9.(]$/.test(e.key)) { $("expr").value = ""; justDone = false; }
  else justDone = false;
});
$("history").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  const box = $("expr");
  box.value = justDone || !box.value ? b.dataset.v : box.value + b.dataset.v;
  justDone = false;
  preview();
  box.focus();
});
$("expr").placeholder = "0";

widget.settings.onChange((s) => { opts = s; renderHistory(); preview(); });
widget.appearance.onChange(() => { renderHistory(); preview(); });
widget.storage.get("history").then((h) => { history = Array.isArray(h) ? h : []; renderHistory(); });
