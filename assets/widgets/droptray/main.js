const $ = (id) => document.getElementById(id);
const t = widget.t;
let items = [];   // { path, name, kind }
let picking = false;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const limit = () => Math.max(5, Math.round(Number(widget.settings.get("limit")) || 20));

function stem(p) {
  const clean = String(p).replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || clean;
}
function parent(p) {
  const clean = String(p).replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  parts.pop();
  if (!parts.length) return "";
  if (parts.length <= 2) return parts.join("\\");
  return "…\\" + parts.slice(-2).join("\\");
}

$("title").textContent = t({ "zh-TW": "檔案收集匣", "zh-CN": "文件收集匣", en: "File shelf" });
$("addLabel").textContent = t({ "zh-TW": "加入", "zh-CN": "加入", en: "Add" });
$("emptyTitle").textContent = t({ "zh-TW": "匣子是空的", "zh-CN": "匣子是空的", en: "Nothing on the shelf" });
$("emptyHint").textContent = t({
  "zh-TW": "按「加入」挑檔案，之後一點就開",
  "zh-CN": "按「加入」挑文件，之后一点就开",
  en: "Press Add to pick files; one click opens them later",
});

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

function save() {
  widget.storage.set("files", items).catch((e) => widget.log(`shelf: save failed ${e.message}`));
}

const glyph = (kind) => kind === "folder"
  ? `<svg viewBox="0 0 24 24"><path d="M3.5 6.5h6l2 2.5h9v9.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z"/></svg>`
  : `<svg viewBox="0 0 24 24"><path d="M6 3.5h7.5L19 9v11.5H6z"/><path d="M13 3.5V9H19"/></svg>`;

function render() {
  const cap = limit();
  $("count").textContent = items.length ? `${items.length}/${cap}` : "";
  $("empty").hidden = items.length > 0;

  $("list").innerHTML = items.map((f, i) => `
    <li class="row${f.missing ? " is-missing" : ""}" data-i="${i}" title="${esc(f.path)}">
      <span class="ico">${f.icon ? `<img alt="" src="${f.icon}">` : glyph(f.kind)}</span>
      <span class="txt">
        <span class="n">${esc(f.name)}</span>
        <span class="p">${esc(f.missing ? t({ "zh-TW": "找不到這個檔案", "zh-CN": "找不到这个文件", en: "File is gone" }) : parent(f.path))}</span>
      </span>
      <span class="acts">
        <button class="w-btn act" data-act="open" data-i="${i}" data-no-drag title="${esc(t({ "zh-TW": "開啟", "zh-CN": "打开", en: "Open" }))}">
          <svg viewBox="0 0 24 24"><path d="M14 4.5h5.5V10M19 5l-7.6 7.6"/><path d="M11 5.5H5.5v13h13V13"/></svg>
        </button>
        <button class="w-btn act" data-act="reveal" data-i="${i}" data-no-drag title="${esc(t({ "zh-TW": "在檔案總管顯示", "zh-CN": "在资源管理器显示", en: "Show in Explorer" }))}">
          <svg viewBox="0 0 24 24"><path d="M3.5 6.5h6l2 2.5h9V19H3.5z"/></svg>
        </button>
        <button class="w-btn act" data-act="remove" data-i="${i}" data-no-drag title="${esc(t({ "zh-TW": "移出匣子", "zh-CN": "移出匣子", en: "Remove" }))}">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </span>
    </li>`).join("");
}

async function add() {
  if (picking) return;
  picking = true;
  try {
    const path = await widget.shell.pick({
      type: "file",
      title: t({ "zh-TW": "挑一個檔案放進匣子", "zh-CN": "挑一个文件放进匣子", en: "Pick a file for the shelf" }),
    });
    if (!path) return;
    if (items.some((f) => f.path.toLowerCase() === String(path).toLowerCase())) {
      toast(t({ "zh-TW": "匣子裡已經有了", "zh-CN": "匣子里已经有了", en: "Already on the shelf" }));
      return;
    }
    let info = null;
    try { info = await widget.shell.info(path, { size: 20 }); } catch (e) { widget.log(`shelf: info failed ${e.message}`); }
    items.unshift({
      path,
      name: (info && info.name) || stem(path),
      kind: (info && info.kind) || "file",
      icon: (info && info.icon) || null,
      missing: !!(info && info.exists === false),
    });
    if (items.length > limit()) items.length = limit();
    save();
    render();
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    picking = false;
  }
}

$("add").onclick = add;

$("list").onclick = async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const f = items[i];
  if (!f) return;
  if (btn.dataset.act === "remove") {
    items.splice(i, 1);
    save();
    render();
    return;
  }
  if (f.missing) {
    toast(t({ "zh-TW": "檔案已經不在了", "zh-CN": "文件已经不在了", en: "That file is gone" }));
    return;
  }
  try {
    if (btn.dataset.act === "open") await widget.shell.launch(f.path);
    else await widget.shell.reveal(f.path);
  } catch (err) {
    toast(String(err.message || err));
  }
};

// double-click anywhere on the row opens it too
$("list").ondblclick = (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const f = items[Number(row.dataset.i)];
  if (f && !f.missing) widget.shell.launch(f.path).catch((err) => toast(String(err.message || err)));
};

widget.settings.onChange(render);
widget.storage.get("files").then((v) => {
  items = Array.isArray(v) ? v.filter((f) => f && f.path) : [];
  if (items.length > limit()) items.length = limit();
  render();
});
