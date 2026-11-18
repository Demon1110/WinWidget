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
  "zh-TW": "把檔案或資料夾拖進來，或按「加入」挑一個",
  "zh-CN": "把文件或文件夹拖进来，或按「加入」挑一个",
  en: "Drag files or folders here, or press Add",
});

$("footHint").textContent = t({
  "zh-TW": "檔案或資料夾都可以直接拖到卡片上",
  "zh-CN": "文件或文件夹都可以直接拖到卡片上",
  en: "Drop files or folders straight onto this card",
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
  $("foot").hidden = items.length === 0;

  $("list").innerHTML = items.map((f, i) => `
    <li class="row${f.missing ? " is-missing" : ""}" data-i="${i}" title="${esc(f.path)}">
      <span class="ico">${f.icon ? `<img alt="" src="${f.icon}">` : glyph(f.kind)}</span>
      <span class="txt">
        <span class="n">${esc(f.name)}</span>
        <span class="p">${esc(f.missing ? t({ "zh-TW": "找不到這個檔案", "zh-CN": "找不到这个文件", en: "File is gone" }) : (f.kind === "folder" ? t({ "zh-TW": "資料夾 · ", "zh-CN": "文件夹 · ", en: "Folder · " }) + parent(f.path) : parent(f.path)))}</span>
      </span>
      <span class="acts">
        <button class="w-btn act" data-act="open" data-i="${i}" data-no-drag title="${esc(t({ "zh-TW": "開啟", "zh-CN": "打开", en: "Open" }))}">
          <svg viewBox="0 0 24 24"><path d="M14 4.5h5.5V10M19 5l-7.6 7.6"/><path d="M11 5.5H5.5v13h13V13"/></svg>
        </button>
        ${f.kind === "folder" ? "" : `<button class="w-btn act" data-act="reveal" data-i="${i}" data-no-drag title="${esc(t({ "zh-TW": "在檔案總管顯示", "zh-CN": "在资源管理器显示", en: "Show in Explorer" }))}">
          <svg viewBox="0 0 24 24"><path d="M3.5 6.5h6l2 2.5h9V19H3.5z"/></svg>
        </button>`}
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
    if (!ingest(path)) {
      toast(t({ "zh-TW": "匣子裡已經有了", "zh-CN": "匣子里已经有了", en: "Already on the shelf" }));
      return;
    }
    if (items.length > limit()) items.length = limit();
    save();
    render();
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    picking = false;
  }
}

/** A folder on the shelf is only a quick way into that directory: one click opens Explorer. */
async function addFolder() {
  if (picking) return;
  picking = true;
  try {
    const path = await widget.shell.pick({
      type: "folder",
      title: t({ "zh-TW": "挑一個資料夾放進匣子", "zh-CN": "挑一个文件夹放进匣子", en: "Pick a folder for the shelf" }),
    });
    if (!path) return;
    if (!ingest(path, "folder")) {
      toast(t({ "zh-TW": "匣子裡已經有了", "zh-CN": "匣子里已经有了", en: "Already on the shelf" }));
      return;
    }
    if (items.length > limit()) items.length = limit();
    save();
    render();
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    picking = false;
  }
}

const PROGRAMS = new Set(["exe", "lnk", "bat", "cmd", "com", "msi", "appref-ms"]);

/** What the path looks like without asking the host: no extension means a directory. */
function guessKind(path) {
  const base = stem(path);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (PROGRAMS.has(ext)) return "app";
  return ext ? "file" : "folder";
}

/** Host answers normally arrive at once; a late one must not hold up the drop. */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Adds one path straight away, so a drop shows up even before the host answers, then fills in the
 * real name, icon and kind when `shell.info` comes back.
 */
function ingest(path, kindHint) {
  const full = String(path);
  if (!full) return false;
  if (items.some((f) => f.path.toLowerCase() === full.toLowerCase())) return false;
  const kind = kindHint || guessKind(full);
  items.unshift({
    path: full,
    name: stem(full),
    kind: kind === "app" ? "app" : kind === "folder" ? "folder" : "file",
    icon: null,
    missing: false,
  });
  withTimeout(widget.shell.info(full, { size: 20 }), 1500, null)
    .then((info) => {
      if (!info) return;
      const row = items.find((f) => f.path === full);
      if (!row) return;
      row.name = info.name || row.name;
      row.kind = info.kind === "app" ? "app" : info.kind === "folder" ? "folder" : "file";
      row.icon = info.icon || null;
      row.missing = info.exists === false;
      save();
      render();
    })
    .catch((e) => widget.log(`shelf: info failed ${e.message}`));
  return true;
}

/** Files and folders dropped on the card arrive here with their real paths. */
widget.on("drop", (data) => {
  widget.log(`shelf: drop event ${JSON.stringify(data)}`);
  const paths = (data && Array.isArray(data.paths) ? data.paths : []).filter((p) => p);
  if (!paths.length) return;
  let added = 0;
  let dup = 0;
  for (const path of paths) {
    if (ingest(path)) added += 1;
    else dup += 1;
  }
  if (items.length > limit()) items.length = limit();
  if (added) {
    save();
    render();
  }
  toast(added
    ? t({ "zh-TW": `已收 ${added} 項`, "zh-CN": `已收 ${added} 项`, en: `Added ${added}` })
    : t({ "zh-TW": dup ? "匣子裡已經有了" : "沒有收下", "zh-CN": dup ? "匣子里已经有了" : "没有收下", en: "Already on the shelf" }));
});

$("add").onclick = add;
$("addFolder").onclick = addFolder;
$("addFolder").title = t({ "zh-TW": "加入資料夾", "zh-CN": "加入文件夹", en: "Add a folder" });

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
    if (btn.dataset.act === "open") await openItem(f);
    else await widget.shell.reveal(f.path);
  } catch (err) {
    toast(String(err.message || err));
  }
};

/** A file opens in its own program; a folder just opens that directory in Explorer. */
function openItem(f) {
  return f.kind === "folder" ? widget.shell.open(f.path) : widget.shell.launch(f.path);
}

// double-click anywhere on the row opens it too
$("list").ondblclick = (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const f = items[Number(row.dataset.i)];
  if (f && !f.missing) openItem(f).catch((err) => toast(String(err.message || err)));
};

widget.settings.onChange(render);
widget.storage.get("files").then((v) => {
  items = Array.isArray(v) ? v.filter((f) => f && f.path) : [];
  if (items.length > limit()) items.length = limit();
  render();
});
