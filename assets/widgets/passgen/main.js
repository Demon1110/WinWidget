const $ = (id) => document.getElementById(id);
const t = widget.t;

const POOLS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
};
const CONFUSING = "Il1O0o|`'\"{}[]";
const CLASSES = ["lower", "upper", "digits", "symbols"];
const MIN_LEN = 5;
const MAX_LEN = 128;
const KEEP = 10;

let opt = { len: 16, lower: true, upper: true, digits: true, symbols: false, plain: false };
let password = "";
let history = [];   // { pw, t }

// ── settings the control center owns ──
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const setting = (key, fallback) => {
  const v = widget.settings.get(key);
  return v === undefined || v === null ? fallback : v;
};
const floorDigits = () => clampInt(setting("minDigits", 0), 0, MAX_LEN, 0);
const floorSymbols = () => clampInt(setting("minSymbols", 0), 0, MAX_LEN, 0);
const keepHistory = () => setting("keep", true) !== false;

$("lenLabel").textContent = t({ "zh-TW": "長度", "zh-CN": "长度", en: "Length" });
$("again").textContent = t({ "zh-TW": "換一組", "zh-CN": "换一组", en: "Regenerate" });
$("copy").textContent = t({ "zh-TW": "複製", "zh-CN": "复制", en: "Copy" });
$("histTitle").textContent = t({ "zh-TW": "最近十條", "zh-CN": "最近十条", en: "Last ten" });
$("histClear").textContent = t({ "zh-TW": "清空", "zh-CN": "清空", en: "Clear" });
$("len").min = String(MIN_LEN);
$("len").max = String(MAX_LEN);

const chipText = {
  lower: { "zh-TW": "小寫", "zh-CN": "小写", en: "abc" },
  upper: { "zh-TW": "大寫", "zh-CN": "大写", en: "ABC" },
  digits: { "zh-TW": "數字", "zh-CN": "数字", en: "123" },
  symbols: { "zh-TW": "符號", "zh-CN": "符号", en: "!@#" },
  plain: { "zh-TW": "易混淆移除", "zh-CN": "移除易混淆", en: "No look-alikes" },
};

function rand(n) {
  const a = new Uint32Array(1);
  const max = Math.floor(4294967296 / n) * n;
  do { crypto.getRandomValues(a); } while (a[0] >= max);
  return a[0] % n;
}

function pool(name) {
  const base = POOLS[name];
  if (!opt.plain) return base;
  return [...base].filter((c) => !CONFUSING.includes(c)).join("");
}

/** The classes that actually have characters, lower-case first so the mix is stable. */
const active = () => CLASSES.filter((k) => opt[k] && pool(k).length);

/**
 * How many characters each class must contribute. Priority order: the two floors the control
 * center sets (that is what the user asked for), then one seat for every other enabled class,
 * then the clockwork fill. When the length cannot hold all of it, the seats give way first and
 * only then the floors, down to one character each.
 */
function floors(sets) {
  const f = { lower: 0, upper: 0, digits: 0, symbols: 0 };
  if (sets.includes("digits")) f.digits = Math.max(1, floorDigits());
  if (sets.includes("symbols")) f.symbols = Math.max(1, floorSymbols());
  for (const k of sets) if (f[k] === 0) f[k] = 1;
  const total = () => f.lower + f.upper + f.digits + f.symbols;
  // the plain one-seat classes go first: lower and upper never have a floor of their own
  for (const k of ["upper", "lower"]) {
    if (total() <= opt.len) break;
    if (f[k] > 0) f[k] = 0;
  }
  // then the floors themselves, balanced, but never below a single character
  while (total() > opt.len) {
    const k = f.symbols >= f.digits ? "symbols" : "digits";
    if (f[k] <= 1) {
      const other = k === "digits" ? "symbols" : "digits";
      if (f[other] <= 1) break;
      f[other] -= 1;
    } else {
      f[k] -= 1;
    }
  }
  return f;
}

function generate() {
  const sets = active();
  if (!sets.length) {
    opt.lower = true;
    sets.push("lower");
  }
  const all = sets.map(pool).join("");
  const f = floors(sets);
  const out = [];
  for (const k of sets) {
    const s = pool(k);
    for (let n = 0; n < f[k]; n++) out.push(s[rand(s.length)]);
  }
  while (out.length < opt.len) out.push(all[rand(all.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function entropy() {
  const size = active().map(pool).join("").length || 1;
  return Math.round(opt.len * Math.log2(size));
}

const clock = (ms) => {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

function paint() {
  $("pw").textContent = password;
  $("lenVal").textContent = opt.len;
  $("len").value = opt.len;
  const f = floors(active());
  $("chips").innerHTML = ["lower", "upper", "digits", "symbols", "plain"]
    .map((k) => {
      const floor = k === "digits" ? floorDigits() : k === "symbols" ? floorSymbols() : 0;
      const hint = floor > 0 && opt[k]
        ? t({ "zh-TW": `至少 ${f[k]} 個`, "zh-CN": `至少 ${f[k]} 个`, en: `at least ${f[k]}` })
        : "";
      return `<button class="chip w-btn${opt[k] ? " is-on" : ""}" data-k="${k}" data-no-drag aria-pressed="${!!opt[k]}" title="${hint}">${t(chipText[k])}</button>`;
    })
    .join("");
  const bits = entropy();
  $("bits").textContent = t({ "zh-TW": `${bits} 位元`, "zh-CN": `${bits} 位元`, en: `${bits} bits` });
  const pct = Math.max(4, Math.min(100, Math.round((bits / 128) * 100)));
  $("fill").style.width = pct + "%";
  const strong = bits >= 100 ? "is-strong" : bits >= 64 ? "" : "is-warn";
  $("bar").className = "w-bar " + strong;
  paintHistory();
}

function paintHistory() {
  const on = keepHistory();
  $("hist").hidden = !on || !history.length;
  $("histList").innerHTML = on ? history.map((h, i) => `
    <li data-i="${i}" title="${t({ "zh-TW": "點擊複製", "zh-CN": "点击复制", en: "Click to copy" })}">
      <span class="when">${clock(h.t)}</span>
      <span class="code">${h.pw.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</span>
    </li>`).join("") : "";
  $("hist").hidden = !on || !history.length;
}

function remember(pw) {
  if (!keepHistory()) return;
  const last = history[0];
  if (last && last.pw === pw) return;
  history.unshift({ pw, t: Date.now() });
  if (history.length > KEEP) history.length = KEEP;
  saveHistory();
}

function saveHistory() {
  widget.storage.set("hist", history).catch((e) => widget.log(`passgen: ${e.message}`));
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 1500);
}

function refresh(regen = true) {
  if (regen) {
    password = generate();
    remember(password);
  }
  paint();
  widget.storage.set("opt", opt).catch((e) => widget.log(`passgen: ${e.message}`));
}

$("chips").onclick = (e) => {
  const btn = e.target.closest("[data-k]");
  if (!btn) return;
  const k = btn.dataset.k;
  if (k !== "plain") {
    const on = CLASSES.filter((x) => opt[x]);
    if (opt[k] && on.length === 1) return; // keep at least one character class
  }
  opt[k] = !opt[k];
  refresh();
};

$("len").oninput = () => {
  opt.len = clampInt($("len").value, MIN_LEN, MAX_LEN, 16);
  refresh();
};

$("again").onclick = () => refresh();
$("pw").onclick = () => { if (password) copy(password); };
$("copy").onclick = () => copy(password);

function copy(text) {
  if (!text) return;
  widget.clipboard.writeText(text)
    .then(() => toast(t({ "zh-TW": "已複製", "zh-CN": "已复制", en: "Copied" })))
    .catch((e) => toast(String(e.message || e)));
}

$("histList").onclick = (e) => {
  const row = e.target.closest("li[data-i]");
  if (!row) return;
  const h = history[Number(row.dataset.i)];
  if (h) copy(h.pw);
};

$("histClear").onclick = () => {
  history = [];
  saveHistory();
  paintHistory();
};

// The control center's two floors and the "keep" switch: regenerate at once, but not once per pixel.
let pending = 0;
widget.settings.onChange(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh(), 200);
});

widget.on("summon", () => refresh());

Promise.all([widget.storage.get("opt"), widget.storage.get("hist")]).then(([s, h]) => {
  if (s && typeof s === "object") {
    opt = {
      len: clampInt(s.len, MIN_LEN, MAX_LEN, 16),
      lower: s.lower !== false,
      upper: s.upper !== false,
      digits: s.digits !== false,
      symbols: !!s.symbols,
      plain: !!s.plain,
    };
  }
  history = Array.isArray(h)
    ? h.filter((x) => x && typeof x.pw === "string" && x.pw).slice(0, KEEP)
        .map((x) => ({ pw: x.pw, t: Number(x.t) || Date.now() }))
    : [];
  refresh();
});
