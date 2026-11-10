const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let data = null;   // { day: "11-02", lang, events: [{ year, text, link, title }] }
let index = 0;

const lang = () => (/^zh-(cn|sg|hans)/i.test(widget.locale) ? "zh-cn" : /^zh/i.test(widget.locale) ? "zh-tw" : "en");
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** "(pictured)", "（圖）" and the like point at photos on Wikipedia's front page; not here. */
const clean = (s) => String(s || "")
  .replace(/\s*[（(](?:圖|图|圖片|图片|左圖|右圖|左图|右图|上圖|下圖|上图|下图|圖中|图中)[)）]/g, "")
  .replace(/\s*\((?:[a-z ,]*\b)?pictured(?:\b[a-z ,]*)?\)/gi, "")
  .trim();

async function refresh() {
  const l = lang(), day = today();
  const host = l === "en" ? "en.wikipedia.org" : "zh.wikipedia.org";
  try {
    const [m, d] = day.split("-");
    // Accept-Language picks Traditional or Simplified on the Chinese Wikipedia
    const r = await widget.fetch(`https://${host}/api/rest_v1/feed/onthisday/selected/${m}/${d}`, { headers: { "Accept-Language": l } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const events = (j.selected || []).map((e) => {
      const page = (e.pages || []).find((p) => p.content_urls) || {};
      return { year: e.year, text: clean(e.text), link: page.content_urls ? page.content_urls.desktop.page : `https://${host}`, title: page.normalizedtitle || page.title || "" };
    }).filter((e) => e.text).sort((a, b) => b.year - a.year);
    if (!events.length) throw new Error("nothing");
    data = { day, lang: l, at: Date.now(), events };
    // a different event each time the day's list is shown
    index = Math.floor(Math.random() * events.length);
    widget.storage.set("last", data);
  } catch (e) {
    widget.log(`onthisday: ${e.message}`);
    if (!data) showMessage(t({ "zh-TW": "暫時取不到資料", "zh-CN": "暂时取不到数据", en: "Can't load it right now" }), true);
  }
  if (data) render();
}

function showMessage(text, retry) {
  $("ev").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

function render() {
  if (!data) return;
  const n = data.events.length;
  index = ((index % n) + n) % n;
  const e = data.events[index];
  $("msg").hidden = true;
  $("ev").hidden = false;
  const [m, d] = data.day.split("-").map(Number);
  $("date").textContent = new Intl.DateTimeFormat(widget.locale, { month: "long", day: "numeric" }).format(new Date(2000, m - 1, d));
  $("pos").textContent = `${index + 1} / ${n}`;
  const years = new Date().getFullYear() - e.year;
  $("year").textContent = e.year > 0 ? e.year : t({ "zh-TW": `前 ${-e.year}`, "zh-CN": `前 ${-e.year}`, en: `${-e.year} BC` });
  $("ago").textContent = years > 0 ? t({ "zh-TW": `${years} 年前`, "zh-CN": `${years} 年前`, en: years === 1 ? "a year ago" : `${years} years ago` }) : "";
  $("text").textContent = e.text;
  $("more").textContent = e.title ? t({ "zh-TW": `在維基百科閱讀「${e.title}」`, "zh-CN": `在维基百科阅读“${e.title}”`, en: `Read “${e.title}” on Wikipedia` })
    : t({ "zh-TW": "在維基百科閱讀", "zh-CN": "在维基百科阅读", en: "Read on Wikipedia" });
  // every event of the day by year, oldest left; this one lit
  const ys = data.events.map((x) => x.year), lo = Math.min(...ys), hi = new Date().getFullYear();
  $("line").innerHTML = data.events.map((x, k) =>
    `<i class="${k === index ? "on" : ""}" style="left:${(((x.year - lo) / Math.max(1, hi - lo)) * 100).toFixed(1)}%"></i>`).join("");
  clampLines();
  $("text").animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
}

/** As many whole lines of the event as fit: never half a line at the bottom. */
function clampLines() {
  const el = $("text");
  el.style.webkitLineClamp = "99";
  el.style.maxHeight = "";
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const n = Math.max(1, Math.floor((el.clientHeight + 2) / lh));
  el.style.webkitLineClamp = String(n);
  el.style.maxHeight = `${n * lh}px`; // the box itself stops at the last whole line
}
new ResizeObserver(() => { if (data) clampLines(); }).observe(document.body);

function step(k) { index += k; render(); restartRotation(); }
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("prev").setAttribute("aria-label", t({ "zh-TW": "上一則", "zh-CN": "上一则", en: "Previous" }));
$("next").setAttribute("aria-label", t({ "zh-TW": "下一則", "zh-CN": "下一则", en: "Next" }));
$("more").onclick = (ev) => {
  ev.preventDefault();
  const e = data && data.events[index];
  if (e) widget.shell.open(e.link).catch(() => {});
};
$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = refresh;

let rotation = 0;
function restartRotation() {
  clearInterval(rotation);
  const s = Number(opts.rotate) || 0;
  if (s > 0) rotation = setInterval(() => { if (data) { index++; render(); } }, s * 1000);
}

// a new day brings new events
setInterval(() => { if (data && data.day !== today()) refresh(); }, 60e3);

widget.settings.onChange((s) => { opts = s; restartRotation(); });
widget.appearance.onChange(render);

(async () => {
  showMessage(t({ "zh-TW": "正在載入…", "zh-CN": "正在加载…", en: "Loading…" }), false);
  const last = await widget.storage.get("last");
  if (last && last.day === today() && last.lang === lang()) {
    data = last;
    index = Math.floor(Math.random() * data.events.length);
    render();
  } else await refresh();
  restartRotation();
})();
