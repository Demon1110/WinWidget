const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let editing = false;

// Chinese fonts that come with Windows, for the language in use
const zh = widget.locale.startsWith("zh") ? (/CN|SG|Hans/.test(widget.locale) ? "cn" : "tw") : "";
const FONTS = {
  sans: `"Segoe UI Variable Display", "Segoe UI", ${zh === "cn" ? '"Microsoft YaHei UI", "Microsoft YaHei"' : '"Microsoft JhengHei UI", "Microsoft JhengHei", "Microsoft YaHei UI"'}, sans-serif`,
  serif: `Cambria, Georgia, ${zh === "cn" ? '"Noto Serif SC", "Source Han Serif SC", SimSun' : '"Noto Serif TC", "Source Han Serif TC", PMingLiU, MingLiU'}, serif`,
  kai: `"Segoe Print", "Ink Free", ${zh === "cn" ? "KaiTi, STKaiti" : '"DFKai-SB", BiauKai, KaiTi'}, cursive`,
  mono: `"Cascadia Mono", Consolas, ${zh === "cn" ? '"Microsoft YaHei UI"' : '"Microsoft JhengHei UI"'}, monospace`,
};

function apply() {
  const b = document.body;
  b.dataset.align = opts.align || "start";
  b.dataset.weight = opts.weight || "regular";
  b.dataset.color = opts.color || "text";
  b.dataset.font = opts.font || "theme";
  $("text").style.fontFamily = FONTS[opts.font] || "";
  if (!editing) $("text").textContent = String(opts.text ?? "").replace(/\s+$/, "") || "…";
  $("note").textContent = opts.note || "";
  $("note").hidden = !opts.note;
  fit();
}

/** The biggest size at which every line fits: words aren't broken, Chinese wraps as usual. */
let fitting = 0;
function fit() {
  cancelAnimationFrame(fitting);
  fitting = requestAnimationFrame(() => {
    const el = $("text"), box = $("box");
    // a very small label gives up most of its padding (and the small line) to the words
    document.body.classList.toggle("tight", document.body.clientHeight < 96);
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    let lo = 6, hi = Math.min(600, h * 1.2);
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollWidth <= w + 0.5 && el.scrollHeight <= h + 0.5) lo = mid; else hi = mid;
    }
    el.style.fontSize = `${Math.floor(lo * 2) / 2}px`;
  });
}

// ── editing on the desktop ──
$("text").addEventListener("dblclick", () => {
  if (editing) return;
  editing = true;
  const el = $("text");
  el.textContent = String(opts.text ?? "");
  el.contentEditable = "plaintext-only";
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  document.body.classList.add("editing");
});
function finish(save) {
  if (!editing) return;
  const el = $("text");
  const value = el.innerText.replace(/\n+$/, "");
  editing = false;
  el.contentEditable = "false";
  document.body.classList.remove("editing");
  getSelection().removeAllRanges();
  if (save && value !== opts.text) {
    opts = { ...opts, text: value };
    widget.settings.set("text", value).catch((e) => widget.log(`label: ${e.message}`));
  }
  apply();
}
$("text").addEventListener("input", fit);
$("text").addEventListener("blur", () => finish(true));
$("text").addEventListener("keydown", (e) => {
  if (!editing) return;
  if (e.key === "Escape") { e.preventDefault(); finish(false); }
  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
});
$("text").title = t({ "zh-TW": "連按兩下修改", "zh-CN": "双击修改", en: "Double-click to edit" });

widget.settings.onChange((o) => { opts = o; apply(); });
widget.appearance.onChange(() => requestAnimationFrame(fit));
new ResizeObserver(fit).observe($("box"));
document.fonts.ready.then(fit);
apply();
