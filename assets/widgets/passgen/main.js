const $ = (id) => document.getElementById(id);
const t = widget.t;

const POOLS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
};
const CONFUSING = "Il1O0o|`'\"{}[]";

let opt = { len: 16, lower: true, upper: true, digits: true, symbols: false, plain: false };
let password = "";

$("lenLabel").textContent = t({ "zh-TW": "長度", "zh-CN": "长度", en: "Length" });
$("again").textContent = t({ "zh-TW": "換一組", "zh-CN": "换一组", en: "Regenerate" });
$("copy").textContent = t({ "zh-TW": "複製", "zh-CN": "复制", en: "Copy" });

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

function generate() {
  const sets = ["lower", "upper", "digits", "symbols"].filter((k) => opt[k] && pool(k).length);
  if (!sets.length) {
    opt.lower = true;
    sets.push("lower");
  }
  const all = sets.map(pool).join("");
  const out = [];
  for (const k of sets) {
    const s = pool(k);
    out.push(s[rand(s.length)]);
  }
  while (out.length < opt.len) out.push(all[rand(all.length)]);
  // a drop when every set is already represented keeps the mix honest
  while (out.length > opt.len) out.pop();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function entropy() {
  const sets = ["lower", "upper", "digits", "symbols"].filter((k) => opt[k] && pool(k).length);
  const size = sets.map(pool).join("").length || 1;
  return Math.round(opt.len * Math.log2(size));
}

function paint() {
  $("pw").textContent = password;
  $("lenVal").textContent = opt.len;
  $("len").value = opt.len;
  $("chips").innerHTML = ["lower", "upper", "digits", "symbols", "plain"]
    .map((k) => `<button class="chip w-btn${opt[k] ? " is-on" : ""}" data-k="${k}" data-no-drag aria-pressed="${!!opt[k]}">${t(chipText[k])}</button>`)
    .join("");
  const bits = entropy();
  $("bits").textContent = t({ "zh-TW": `${bits} 位元`, "zh-CN": `${bits} 位元`, en: `${bits} bits` });
  const pct = Math.max(4, Math.min(100, Math.round((bits / 128) * 100)));
  $("fill").style.width = pct + "%";
  const strong = bits >= 100 ? "is-strong" : bits >= 64 ? "" : "is-warn";
  $("bar").className = "w-bar " + strong;
  $("fill").style.width = pct + "%";
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 1500);
}

function refresh(regen = true) {
  if (regen) password = generate();
  paint();
  widget.storage.set("opt", opt).catch((e) => widget.log(`passgen: ${e.message}`));
}

$("chips").onclick = (e) => {
  const btn = e.target.closest("[data-k]");
  if (!btn) return;
  const k = btn.dataset.k;
  const keys = ["lower", "upper", "digits", "symbols"];
  if (k !== "plain") {
    const on = keys.filter((x) => opt[x]);
    if (opt[k] && on.length === 1) return; // keep at least one character class
  }
  opt[k] = !opt[k];
  refresh();
};

$("len").oninput = () => {
  opt.len = Number($("len").value);
  refresh();
};

$("again").onclick = () => refresh();
$("pw").onclick = () => { if (password) copy(); };

$("copy").onclick = copy;
function copy() {
  if (!password) return;
  widget.clipboard.writeText(password)
    .then(() => toast(t({ "zh-TW": "已複製", "zh-CN": "已复制", en: "Copied" })))
    .catch((e) => toast(String(e.message || e)));
}

widget.on("summon", () => refresh());

widget.storage.get("opt").then((s) => {
  if (s && typeof s === "object") {
    opt = {
      len: Math.min(40, Math.max(8, Number(s.len) || 16)),
      lower: s.lower !== false,
      upper: s.upper !== false,
      digits: s.digits !== false,
      symbols: !!s.symbols,
      plain: !!s.plain,
    };
  }
  refresh();
});
