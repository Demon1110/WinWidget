const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let data = null;  // { mkt, at, images: [{ date, url, title, copyright, link }] }, newest first
let index = 0;    // 0 = today

/** Bing has no Traditional Chinese edition: Traditional readers get the Chinese one, converted. */
function market() {
  if (opts.region && opts.region !== "auto") return opts.region;
  return /^zh/i.test(widget.locale) ? "zh-CN" : /^ja/i.test(widget.locale) ? "ja-JP" : /^en-gb/i.test(widget.locale) ? "en-GB" : "en-US";
}
const traditional = () => /^zh-(tw|hk|mo|hant)/i.test(widget.locale) || (/^zh$/i.test(widget.locale));

async function refresh() {
  const mkt = market();
  try {
    const r = await widget.fetch(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=${mkt}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    let images = j.images.map((im) => ({
      date: im.startdate,
      url: `https://www.bing.com${im.urlbase}_1920x1080.jpg`,
      title: im.title && im.title !== "Info" ? im.title : "",
      copyright: im.copyright || "",
      link: /^https?:/.test(im.copyrightlink || "") ? im.copyrightlink : "https://www.bing.com",
    }));
    if (traditional() && /^zh/i.test(mkt)) {
      const joined = images.map((im) => `${im.title}\u0001${im.copyright}`).join("\u0002");
      const conv = await widget.convertChinese(joined, "traditional");
      conv.split("\u0002").forEach((pair, k) => { const [a, b] = pair.split("\u0001"); images[k].title = a; images[k].copyright = b; });
    }
    data = { mkt, at: Date.now(), images };
    widget.storage.set("last", data);
  } catch (e) {
    widget.log(`dailyimage: ${e.message}`);
    if (!data) showMessage(t({ "zh-TW": "暫時取不到圖片", "zh-CN": "暂时取不到图片", en: "Can't load the picture right now" }), true);
  }
  if (data) render();
}

function showMessage(text, retry) {
  $("pic").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

/** "Polar bear and cubs, Hudson Bay (© Someone/Agency)" → subject and credit apart. */
function split(c) {
  const m = c.match(/^(.*?)\s*[（(]\s*(©.*?)\s*[)）]\s*$/);
  return m ? [m[1], m[2]] : [c, ""];
}

function render() {
  if (!data || !data.images.length) return;
  index = Math.max(0, Math.min(index, data.images.length - 1));
  const im = data.images[index];
  $("msg").hidden = true;
  $("pic").hidden = false;
  if ($("img").getAttribute("src") !== im.url) {
    $("img").classList.remove("ready");
    $("img").src = im.url;
  }
  const [subject, credit] = split(im.copyright);
  $("title").textContent = im.title || subject;
  $("credit").textContent = im.title ? `${subject}${credit ? ` · ${credit}` : ""}` : credit;
  document.body.classList.toggle("no-caption", opts.caption === false);
  const d = im.date ? new Date(+im.date.slice(0, 4), +im.date.slice(4, 6) - 1, +im.date.slice(6, 8)) : null;
  $("day").textContent = index === 0 ? t({ "zh-TW": "今天", "zh-CN": "今天", en: "Today" })
    : d ? new Intl.DateTimeFormat(widget.locale, { month: "numeric", day: "numeric" }).format(d) : "";
  $("prev").disabled = index >= data.images.length - 1;
  $("next").disabled = index === 0;
}

$("img").addEventListener("load", () => $("img").classList.add("ready"));
$("prev").onclick = () => { index++; render(); };
$("next").onclick = () => { index--; render(); };
$("prev").setAttribute("aria-label", t({ "zh-TW": "前一天", "zh-CN": "前一天", en: "Previous day" }));
$("next").setAttribute("aria-label", t({ "zh-TW": "後一天", "zh-CN": "后一天", en: "Next day" }));
// a click on the picture (not a drag) opens its story on Bing
$("img").addEventListener("click", () => {
  const im = data && data.images[index];
  if (im) widget.shell.open(im.link).catch(() => {});
});
$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = refresh;

widget.settings.onChange((s) => {
  const moved = s.region !== opts.region;
  opts = s;
  if (moved) { index = 0; refresh(); } else render();
});
widget.appearance.onChange(render);

(async () => {
  const last = await widget.storage.get("last");
  if (last && last.mkt === market()) { data = last; render(); }
  else showMessage(t({ "zh-TW": "正在載入…", "zh-CN": "正在加载…", en: "Loading…" }), false);
  // a new picture each day; look every 3 hours
  if (!data || Date.now() - data.at > 3 * 3600e3) await refresh();
  setInterval(refresh, 3 * 3600e3);
})();
