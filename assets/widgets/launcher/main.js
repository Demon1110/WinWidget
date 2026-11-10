const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let items = [];          // { path } or { url }, with an optional own name
const info = new Map();  // path → { name, kind, icon, exists }
let editing = false;
const MAX = 40;

/** A few useful things to start with; names in the user's language. */
const DEFAULTS = [
  { path: "C:\\Windows\\explorer.exe", name: { "zh-TW": "檔案總管", "zh-CN": "文件资源管理器", en: "File Explorer" } },
  { path: "%USERPROFILE%\\Downloads", name: { "zh-TW": "下載", "zh-CN": "下载", en: "Downloads" } },
  { path: "%USERPROFILE%\\Documents", name: { "zh-TW": "文件", "zh-CN": "文档", en: "Documents" } },
  { path: "C:\\Windows\\notepad.exe", name: { "zh-TW": "記事本", "zh-CN": "记事本", en: "Notepad" } },
];

const save = () => widget.storage.set("items", items);
const keyOf = (it) => it.path ? `p:${it.path.toLowerCase()}` : `u:${it.url}`;
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

async function load(it) {
  if (!it.path || info.has(it.path)) return;
  try { info.set(it.path, await widget.shell.info(it.path, { size: 96 })); }
  catch (e) { info.set(it.path, { exists: false, name: "", kind: "missing", icon: null }); widget.log(`launcher: ${e.message}`); }
}

function nameOf(it) {
  if (it.name) return typeof it.name === "object" ? t(it.name) : it.name;
  if (it.url) return host(it.url);
  return (info.get(it.path) || {}).name || it.path.split("\\").pop();
}

function iconOf(it) {
  if (it.url) return `<span class="glyph url">${esc(host(it.url).slice(0, 1).toUpperCase())}</span>`;
  const i = info.get(it.path);
  if (i && i.icon) return `<img src="${i.icon}" alt="" draggable="false">`;
  return `<span class="glyph">${i && i.kind === "missing" ? "!" : esc(nameOf(it).slice(0, 1))}</span>`;
}

function render() {
  document.body.classList.toggle("editing", editing);
  document.body.classList.toggle("no-labels", opts.labels === false);
  document.body.dataset.size = opts.size || "medium";
  document.body.classList.toggle("empty", !items.length);
  const tiles = items.map((it, i) => {
    const missing = it.path && info.get(it.path) && info.get(it.path).exists === false;
    return `<div class="tile${missing ? " missing" : ""}" role="button" tabindex="0" data-i="${i}" title="${esc(it.path || it.url)}"
        ${editing ? `draggable="true" data-no-drag` : ""}>
      <span class="ic">${iconOf(it)}</span><span class="nm">${esc(nameOf(it))}</span>
      ${editing ? `<button class="x" data-x="${i}" aria-label="${esc(t({ "zh-TW": "移除", "zh-CN": "移除", en: "Remove" }))}">×</button>` : ""}
    </div>`;
  });
  if (!items.length && !editing) {
    tiles.push(`<div class="hint">${esc(t({ "zh-TW": "把程式、資料夾或網址拖到這裏，\n或按「編輯」加入。", "zh-CN": "把程序、文件夹或网址拖到这里，\n或点“编辑”添加。", en: "Drop programs, folders or links here,\nor click Edit to add some." }))}</div>`);
  }
  $("grid").innerHTML = tiles.join("");
  $("edit").textContent = editing ? t({ "zh-TW": "完成", "zh-CN": "完成", en: "Done" }) : t({ "zh-TW": "編輯", "zh-CN": "编辑", en: "Edit" });
  $("edit").classList.toggle("is-primary", editing);
  $("adder").hidden = !editing;
}

async function add(list) {
  let added = 0;
  for (const it of list) {
    if (items.length >= MAX) break;
    if (items.some((x) => keyOf(x) === keyOf(it))) continue;
    items.push(it);
    added++;
    await load(it);
  }
  if (added) { await save(); render(); }
}

// ── opening ──
function open(i, el) {
  const it = items[i];
  if (!it) return;
  el.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(0.3, 1.45, 0.5, 1)" });
  const p = it.url ? widget.shell.open(it.url) : widget.shell.launch(it.path);
  p.catch((e) => {
    widget.log(`launcher: ${e.message}`);
    info.delete(it.path);
    load(it).then(render);
  });
}

$("grid").addEventListener("click", (e) => {
  const x = e.target.closest("[data-x]");
  if (x) { items.splice(+x.dataset.x, 1); save(); render(); return; }
  const tile = e.target.closest(".tile");
  if (tile && !editing) open(+tile.dataset.i, tile);
});
$("grid").addEventListener("keydown", (e) => {
  const tile = e.target.closest(".tile");
  if (tile && (e.key === "Enter" || e.key === " ") && !editing) { e.preventDefault(); open(+tile.dataset.i, tile); }
});

// ── editing ──
$("edit").onclick = () => { editing = !editing; $("url-form").hidden = true; render(); };
$("add-app").onclick = async () => {
  const p = await widget.shell.pick({ type: "file", filter: "programs", title: t({ "zh-TW": "選擇要加入的程式或檔案", "zh-CN": "选择要添加的程序或文件", en: "Choose a program or file to add" }) });
  if (p) add([{ path: p }]);
};
$("add-folder").onclick = async () => {
  const p = await widget.shell.pick({ type: "folder", title: t({ "zh-TW": "選擇要加入的資料夾", "zh-CN": "选择要添加的文件夹", en: "Choose a folder to add" }) });
  if (p) add([{ path: p }]);
};
$("add-url").onclick = () => { $("url-form").hidden = false; $("url").value = ""; $("url").focus(); };
$("url-form").onsubmit = (e) => {
  e.preventDefault();
  let u = $("url").value.trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { new URL(u); } catch { return; }
  $("url-form").hidden = true;
  add([{ url: u }]);
};

// reordering in edit mode: drag a tile onto another
let from = null;
$("grid").addEventListener("dragstart", (e) => {
  const tile = e.target.closest(".tile");
  if (!tile || !editing) return;
  from = +tile.dataset.i;
  e.dataTransfer.setData("application/x-fw-tile", String(from));
  e.dataTransfer.effectAllowed = "move";
});
$("grid").addEventListener("dragend", () => { from = null; });

// ── dropping files and links from outside ──
let depth = 0;
const outside = (e) => from == null && [...e.dataTransfer.types].some((x) => x === "Files" || x === "text/uri-list");
document.addEventListener("dragenter", (e) => { if (outside(e)) { depth++; document.body.classList.add("dropping"); } });
document.addEventListener("dragleave", (e) => { if (outside(e) && --depth <= 0) { depth = 0; document.body.classList.remove("dropping"); } });
// "copy": every source allows it (Explorer, browsers); nothing is copied, only the path is kept
document.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = from != null ? "move" : "copy"; });
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  depth = 0;
  document.body.classList.remove("dropping");
  if (from != null) {
    const tile = e.target.closest(".tile");
    if (tile) {
      const to = +tile.dataset.i;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      save();
      render();
    }
    from = null;
    return;
  }
  if (e.dataTransfer.files.length) {
    const paths = await widget.shell.paths(e.dataTransfer.files).catch(() => []);
    add(paths.map((path) => ({ path })));
  } else {
    const links = e.dataTransfer.getData("text/uri-list").split(/\r?\n/).filter((l) => /^https?:/i.test(l));
    add(links.map((url) => ({ url })));
  }
});

$("add-app").textContent = t({ "zh-TW": "＋ 程式或檔案", "zh-CN": "＋ 程序或文件", en: "+ Program or file" });
$("add-folder").textContent = t({ "zh-TW": "＋ 資料夾", "zh-CN": "＋ 文件夹", en: "+ Folder" });
$("add-url").textContent = t({ "zh-TW": "＋ 網址", "zh-CN": "＋ 网址", en: "+ Link" });
$("url").placeholder = "example.com";
$("url-ok").textContent = t({ "zh-TW": "加入", "zh-CN": "添加", en: "Add" });
$("drop-text").textContent = t({ "zh-TW": "放開以加入", "zh-CN": "松开以添加", en: "Drop to add" });

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
widget.storage.get("items").then(async (saved) => {
  items = Array.isArray(saved) ? saved : DEFAULTS.map((d) => ({ ...d }));
  if (!Array.isArray(saved)) save();
  render();
  await Promise.all(items.map(load));
  render();
});
