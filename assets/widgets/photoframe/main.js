const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let files = [];      // from widget.files.list
let order = [];      // indexes into files, in the order they are shown
let pos = -1;        // where we are in `order`
let front = $("a"), back = $("b");
let current = null;  // the file on screen
let shownWidth = 0;  // pixel width it was asked for
let timer = 0;
let busy = false;

const dateFmt = new Intl.DateTimeFormat(widget.locale, { year: "numeric", month: "long", day: "numeric" });

/** Pixels to ask Windows for: the frame's size on screen, a bit more when the photo is cropped to fill it. */
function wantWidth() {
  const r = $("frame").getBoundingClientRect();
  return Math.round(Math.max(r.width, r.height) * devicePixelRatio * (opts.fit === "contain" ? 1 : 1.5));
}

async function load() {
  clearTimeout(timer);
  try {
    const r = await widget.files.list("folder", { recursive: !!opts.subfolders });
    files = r.files;
    if (!files.length) return empty("none");
    $("empty").hidden = true;
    document.body.classList.remove("is-empty");
    arrange();
    const last = current ? current.path : await widget.storage.get("current");
    const i = last ? order.findIndex((k) => files[k].path === last) : -1;
    pos = i >= 0 ? i - 1 : -1; // start with the one shown last time
    await step(1, true);
  } catch (e) {
    widget.log(`photoframe: ${e.message}`);
    empty(/does not exist/.test(e.message) ? "missing" : "pick");
  }
}

function arrange() {
  order = files.map((_, i) => i);
  if (opts.order === "name") order.sort((a, b) => files[a].path.localeCompare(files[b].path, undefined, { numeric: true }));
  else if (opts.order === "newest") order.sort((a, b) => files[b].modified - files[a].modified);
  else for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
}

async function step(dir, instant = false) {
  if (!order.length || busy) return;
  busy = true;
  try {
    // a photo that won't load (deleted, or a format Windows can't read) is skipped
    for (let tries = 0; tries < Math.min(order.length, 8); tries++) {
      pos = (pos + dir + order.length) % order.length;
      if (await show(files[order[pos]], instant)) break;
    }
  } finally { busy = false; }
  schedule();
}

async function show(f, instant) {
  const width = wantWidth();
  const img = back.querySelector("img");
  img.src = widget.files.url(f, { width });
  try { await img.decode(); } catch { return false; }
  back.classList.toggle("instant", instant);
  front.classList.toggle("instant", instant);
  back.classList.add("on");
  front.classList.remove("on");
  [front, back] = [back, front];
  current = f;
  shownWidth = width;
  widget.storage.set("current", f.path);
  caption();
  // let Windows make the next one now, so it's ready in time
  const next = files[order[(pos + 1) % order.length]];
  if (next && next !== f) fetch(widget.files.url(next, { width })).catch(() => {});
  return true;
}

async function caption() {
  const f = current;
  if (!f) return;
  $("count").textContent = order.length > 1 ? `${pos + 1} / ${order.length}` : "";
  document.body.classList.toggle("no-caption", opts.caption === "none");
  if (opts.caption === "name") { $("cap-text").textContent = f.name; return; }
  if (opts.caption !== "date") { $("cap-text").textContent = ""; return; }
  $("cap-text").textContent = dateFmt.format(f.modified);
  try {
    const info = await widget.files.info("folder", f);
    if (current === f && info.taken) $("cap-text").textContent = dateFmt.format(info.taken);
  } catch { /* the file date stays */ }
}

function schedule() {
  clearTimeout(timer);
  const s = Number(opts.interval) || 0;
  if (s > 0 && !document.hidden && order.length > 1) timer = setTimeout(() => step(1), s * 1000);
}

function empty(kind) {
  files = []; order = []; current = null;
  document.body.classList.add("is-empty");
  front.classList.remove("on"); back.classList.remove("on");
  $("empty").hidden = false;
  $("empty-text").textContent = kind === "none" ? t({ "zh-TW": "這個資料夾裏沒有照片", "zh-CN": "这个文件夹里没有照片", en: "No photos in this folder" })
    : kind === "missing" ? t({ "zh-TW": "找不到照片資料夾", "zh-CN": "找不到照片文件夹", en: "The photo folder is gone" })
    : t({ "zh-TW": "選一個放照片的資料夾", "zh-CN": "选一个放照片的文件夹", en: "Choose a folder of photos" });
  $("pick").textContent = kind === "pick" ? t({ "zh-TW": "選擇資料夾", "zh-CN": "选择文件夹", en: "Choose folder" })
    : t({ "zh-TW": "換一個資料夾", "zh-CN": "换一个文件夹", en: "Choose another" });
}

$("pick").onclick = () => widget.files.pick("folder").catch((e) => widget.log(`photoframe: ${e.message}`));
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("prev").title = t({ "zh-TW": "上一張", "zh-CN": "上一张", en: "Previous" });
$("next").title = t({ "zh-TW": "下一張", "zh-CN": "下一张", en: "Next" });
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight" || e.key === " ") step(1);
});

widget.settings.onChange((o) => {
  const prev = opts;
  opts = o;
  front.classList.toggle("contain", opts.fit === "contain");
  back.classList.toggle("contain", opts.fit === "contain");
  if (o.folder !== prev.folder || o.subfolders !== prev.subfolders) { current = null; load(); return; }
  if (o.order !== prev.order && current) {
    arrange();
    pos = order.findIndex((k) => files[k] === current);
  }
  caption();
  schedule();
});

// a much bigger frame wants a sharper copy
new ResizeObserver(() => {
  if (current && !busy && wantWidth() > shownWidth * 1.3) { pos--; step(1, true); }
}).observe($("frame"));
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else schedule(); });
// photos added to the folder show up within half an hour
setInterval(() => { if (!document.hidden && current) load(); }, 30 * 60e3);

front.classList.toggle("contain", opts.fit === "contain");
back.classList.toggle("contain", opts.fit === "contain");
load();
