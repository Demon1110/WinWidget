const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let feed = null;     // { url, at, title, items: [{ title, link, time }] }
let failed = false;

const FEEDS = {
  cna: "https://feeds.feedburner.com/rsscna/intworld",
  "cna-tech": "https://feeds.feedburner.com/rsscna/technology",
  "bbc-zh": "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml",
  rthk: "https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml",
  ithome: "https://www.ithome.com/rss/",
  sspai: "https://sspai.com/feed",
  bbc: "https://feeds.bbci.co.uk/news/world/rss.xml",
  verge: "https://www.theverge.com/rss/index.xml",
  hn: "https://hnrss.org/frontpage",
};

function address() {
  if (opts.feed === "custom") {
    const u = (opts.url || "").trim();
    return /^https?:\/\//i.test(u) ? u : null;
  }
  return FEEDS[opts.feed] || FEEDS.bbc;
}

/** Titles may still carry HTML entities or tags after XML parsing (CDATA). */
function clean(s) {
  const box = document.createElement("textarea");
  box.innerHTML = String(s || "").replace(/<[^>]+>/g, "");
  return box.value.replace(/\s+/g, " ").trim();
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom. */
function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("not a feed");
  const text = (el, sel) => { const x = el.querySelector(sel); return x ? x.textContent : ""; };
  const entries = [...doc.querySelectorAll("item")];
  if (entries.length) {
    return {
      title: clean(text(doc, "channel > title") || text(doc, "title")),
      items: entries.map((it) => ({
        title: clean(text(it, "title")),
        link: (text(it, "link") || (it.querySelector("guid[isPermaLink='true'], guid") || {}).textContent || "").trim(),
        time: Date.parse(text(it, "pubDate") || it.getElementsByTagNameNS("*", "date")[0]?.textContent || "") || null,
      })),
    };
  }
  const atom = [...doc.querySelectorAll("entry")];
  if (!atom.length) throw new Error("no items");
  return {
    title: clean(text(doc, "feed > title")),
    items: atom.map((e) => {
      const link = e.querySelector("link[rel='alternate']") || e.querySelector("link:not([rel])") || e.querySelector("link");
      return { title: clean(text(e, "title")), link: link ? link.getAttribute("href") || "" : "", time: Date.parse(text(e, "published") || text(e, "updated")) || null };
    }),
  };
}

/** Each refresh gets a number; an answer that comes back after a newer refresh started (the
 *  address was changed meanwhile) is dropped, so a slow old feed can't replace the new one. */
let refreshes = 0;
async function refresh() {
  const seq = ++refreshes;
  const url = address();
  if (!url) { showMessage(t({ "zh-TW": "在設定裏填上 RSS 網址", "zh-CN": "在设置里填写 RSS 网址", en: "Add a feed address in Settings" }), false); return; }
  try {
    const r = await widget.fetch(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    if (seq !== refreshes) return;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (seq !== refreshes) return;
    const f = parse(text);
    f.items = f.items.filter((i) => i.title).slice(0, 40);
    feed = { url, at: Date.now(), ...f };
    failed = false;
    widget.storage.set("last", feed);
  } catch (e) {
    if (seq !== refreshes) return;
    widget.log(`rss: ${e.message}`);
    failed = true;
    if (!feed || feed.url !== url) {
      feed = null;
      showMessage(e.message === "not a feed" || e.message === "no items"
        ? t({ "zh-TW": "這個網址不是 RSS 或 Atom", "zh-CN": "这个网址不是 RSS 或 Atom", en: "That address isn't an RSS or Atom feed" })
        : t({ "zh-TW": "暫時取不到新聞", "zh-CN": "暂时取不到新闻", en: "Can't load the feed right now" }), true);
      return;
    }
  }
  render();
}

function showMessage(text, retry) {
  $("items").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 6e4));
  if (m < 1) return t({ "zh-TW": "剛剛", "zh-CN": "刚刚", en: "now" });
  if (m < 60) return t({ "zh-TW": `${m} 分鐘前`, "zh-CN": `${m} 分钟前`, en: `${m} min` });
  const h = Math.round(m / 60);
  if (h < 24) return t({ "zh-TW": `${h} 小時前`, "zh-CN": `${h} 小时前`, en: `${h} h` });
  return new Intl.DateTimeFormat(widget.locale, { month: "numeric", day: "numeric" }).format(ms);
}

function render() {
  if (!feed) return;
  $("msg").hidden = true;
  $("items").hidden = false;
  $("src").textContent = feed.title || new URL(feed.url).hostname;
  $("when").textContent = failed ? t({ "zh-TW": "離線", "zh-CN": "离线", en: "offline" })
    : new Intl.DateTimeFormat(widget.locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(feed.at);
  $("items").innerHTML = feed.items.map((it, i) => `<li><a class="item" href="#" data-i="${i}" data-no-drag title="${esc(it.title)}">
      <span class="tt">${esc(it.title)}</span>${it.time ? `<span class="tm">${esc(ago(it.time))}</span>` : ""}</a></li>`).join("");
}

$("items").addEventListener("click", (e) => {
  const a = e.target.closest("a.item");
  if (!a) return;
  e.preventDefault();
  const it = feed.items[+a.dataset.i];
  if (it && /^https?:/i.test(it.link)) {
    widget.shell.open(it.link).catch((err) => widget.log(`rss: ${err.message}`));
    a.classList.add("seen");
  }
});
$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = refresh;

let timer = 0;
function schedule() {
  clearInterval(timer);
  timer = setInterval(refresh, (Number(opts.refresh) || 30) * 60e3);
}
// relative times ("5 minutes ago") move on
setInterval(() => feed && render(), 60e3);

widget.settings.onChange((s) => {
  const moved = s.feed !== opts.feed || (s.url || "") !== (opts.url || "");
  opts = s;
  if (moved) { feed = null; refresh(); }
  schedule();
});
widget.appearance.onChange(render);

(async () => {
  const last = await widget.storage.get("last");
  if (last && last.url === address()) { feed = last; render(); }
  else showMessage(t({ "zh-TW": "正在載入…", "zh-CN": "正在加载…", en: "Loading…" }), false);
  if (!feed || Date.now() - feed.at > (Number(opts.refresh) || 30) * 60e3) await refresh();
  schedule();
})();
