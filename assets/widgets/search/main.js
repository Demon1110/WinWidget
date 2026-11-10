const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();

const ENGINES = {
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  baidu: { name: { "zh-TW": "百度", "zh-CN": "百度", en: "Baidu" }, url: "https://www.baidu.com/s?wd=%s" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  wikipedia: { name: { "zh-TW": "維基百科", "zh-CN": "维基百科", en: "Wikipedia" },
    url: { "zh-TW": "https://zh.wikipedia.org/w/index.php?variant=zh-tw&search=%s", "zh-CN": "https://zh.wikipedia.org/w/index.php?variant=zh-cn&search=%s", en: "https://en.wikipedia.org/w/index.php?search=%s" } },
  youtube: { name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  custom: { name: { "zh-TW": "自訂", "zh-CN": "自定义", en: "Custom" }, url: "" },
};

const current = () => (ENGINES[opts.engine] ? opts.engine : "google");
const nameOf = (k) => t(ENGINES[k].name);
function template(k) {
  if (k === "custom") return /^https?:\/\/.+%s/i.test(opts.custom || "") ? opts.custom : null;
  return t(ENGINES[k].url);
}

function render() {
  $("engine").textContent = nameOf(current());
  $("q").placeholder = t({ "zh-TW": `用 ${nameOf(current())} 搜尋`, "zh-CN": `用 ${nameOf(current())} 搜索`, en: `Search with ${nameOf(current())}` });
}

$("form").onsubmit = (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  // something that looks like an address opens directly
  const looksLikeUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(q) && !/\s/.test(q);
  const tpl = template(current());
  if (!looksLikeUrl && !tpl) {
    $("q").value = "";
    $("q").placeholder = t({ "zh-TW": "自訂網址要包含 %s", "zh-CN": "自定义网址要包含 %s", en: "The custom URL needs %s" });
    return;
  }
  const url = looksLikeUrl ? (/^https?:/i.test(q) ? q : `https://${q}`) : tpl.replace("%s", encodeURIComponent(q));
  widget.shell.open(url).then(() => {
    $("q").value = "";
    $("q").blur();
  }).catch((err) => widget.log(`search: ${err.message}`));
};

// quick switch: the engine name opens a short list
$("engine").onclick = () => {
  const open = $("menu").hidden;
  $("menu").innerHTML = Object.keys(ENGINES).filter((k) => k !== "custom" || template("custom"))
    .map((k) => `<li><button data-e="${k}" class="${k === current() ? "on" : ""}">${esc(nameOf(k))}</button></li>`).join("");
  $("menu").hidden = !open;
};
$("menu").onclick = (e) => {
  const b = e.target.closest("button[data-e]");
  if (!b) return;
  $("menu").hidden = true;
  widget.settings.set("engine", b.dataset.e);
  $("q").focus();
};
document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu, #engine")) $("menu").hidden = true; });
$("q").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("q").value = ""; $("menu").hidden = true; } });

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
render();
