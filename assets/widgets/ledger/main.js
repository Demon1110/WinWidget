const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

const CATS = {
  out: [
    { k: "meal", tw: "餐飲", cn: "餐饮", en: "Meals" },
    { k: "ride", tw: "交通", cn: "交通", en: "Transit" },
    { k: "shop", tw: "購物", cn: "购物", en: "Shopping" },
    { k: "life", tw: "生活", cn: "生活", en: "Living" },
    { k: "other", tw: "其他", cn: "其他", en: "Other" },
  ],
  in: [
    { k: "pay", tw: "薪水", cn: "薪水", en: "Salary" },
    { k: "side", tw: "外快", cn: "外快", en: "Side job" },
    { k: "other", tw: "其他", cn: "其他", en: "Other" },
  ],
};

const BOOK_PREFIX = "book/";
const ENTRY_PREFIX = "entry/";

let entries = [];              // { id, uid, t: <ms>, a: <number>, k: "out"|"in", c: <cat key> }
let kind = "out";
let cat = "meal";
let bookId = "";
let bookName = "";
let books = [];                // { id, name, created }
let lastKey = "";
let panelOpen = false;
let deleteArmed = false;
let deleteTimer = 0;
let busy = false;
let refreshing = false;
let exporting = false;
let lastExport = null;          // { bookId, dir, name }
let importPrompt = null;        // { base, list, targetId, targetName, invalid, duplicates }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sym = () => String(widget.settings.get("currency") || "¥").slice(0, 3);
const keep = () => Math.max(10, Math.round(Number(widget.settings.get("keep")) || 40));
const money = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
const catName = (k, key) => {
  const row = (CATS[k] || CATS.out).find((c) => c.k === key) || CATS.out[CATS.out.length - 1];
  return L(row.tw, row.cn, row.en);
};
const monthKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() * 12 + d.getMonth();
};
const nowKey = monthKey(Date.now());
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const newUid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : rid());
const defaultBookName = () => L("預設帳本", "默认账本", "Default ledger");

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

function saveUi() {
  widget.storage.set("ui", { kind, cat }).catch(() => {});
}

function totals() {
  let out = 0;
  let inc = 0;
  let dayOut = 0;
  let dayIn = 0;
  const today = new Date();
  for (const e of entries) {
    const d = new Date(e.t);
    if (d.getFullYear() * 12 + d.getMonth() !== nowKey) continue;
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    if (e.k === "in") {
      inc += e.a;
      if (isToday) dayIn += e.a;
    } else {
      out += e.a;
      if (isToday) dayOut += e.a;
    }
  }
  return { out, inc, dayOut, dayIn, balance: inc - out };
}

function renderHead() {
  const { out, inc, dayOut, dayIn, balance } = totals();
  const sign = balance < 0 ? "−" : "";
  $("balance").textContent = `${L("結餘", "结余", "Balance")} ${sign}${sym()}${money(Math.abs(balance))}`;
  $("balance").title = L(
    `本月收入 ${sym()}${money(inc)}｜本月支出 ${sym()}${money(out)}`,
    `本月收入 ${sym()}${money(inc)}｜本月支出 ${sym()}${money(out)}`,
    `This month in ${sym()}${money(inc)} · out ${sym()}${money(out)}`
  );
  const isOut = kind === "out";
  $("flow").textContent = isOut
    ? `${L("本月支出", "本月支出", "Spent this month")} ${sym()}${money(out)}`
    : `${L("本月收入", "本月收入", "Received this month")} ${sym()}${money(inc)}`;
  $("flow").title = isOut
    ? L(`今天支出 ${sym()}${money(dayOut)}`, `今天支出 ${sym()}${money(dayOut)}`, `Today ${sym()}${money(dayOut)}`)
    : L(`今天收入 ${sym()}${money(dayIn)}`, `今天收入 ${sym()}${money(dayIn)}`, `Today ${sym()}${money(dayIn)}`);
}

function renderCats() {
  $("cats").innerHTML = (CATS[kind] || [])
    .map((c) => `<button class="chip${c.k === cat ? " is-on" : ""}" data-c="${c.k}">${esc(L(c.tw, c.cn, c.en))}</button>`)
    .join("");
}

function renderSeg() {
  for (const b of $("seg").children) b.classList.toggle("is-on", b.dataset.k === kind);
}

function renderList() {
  const rows = entries.slice(0, 12);
  if (!rows.length) {
    $("list").innerHTML = `<li class="empty">${esc(L("還沒有紀錄", "还没有记录", "Nothing recorded yet"))}</li>`;
    return;
  }
  $("list").innerHTML = rows
    .map((e, i) => {
      const sign = e.k === "out" ? "−" : "+";
      return `<li class="row${e.k === "in" ? " is-in" : ""}" data-i="${i}" title="${esc(catName(e.k, e.c))}">
        <span class="tm">${hhmm(e.t)}</span>
        <span class="ct">${esc(catName(e.k, e.c))}</span>
        <span class="amt2">${sign}${sym()}${money(e.a)}</span>
        <button class="del" data-i="${i}" data-no-drag aria-label="remove">×</button>
      </li>`;
    })
    .join("");
}

function renderBookButton() {
  $("book").textContent = bookId
    ? `${L("帳本", "账本", "Book")}：${bookName}`
    : L("選擇帳本", "选择账本", "Choose ledger");
  $("book").title = $("book").textContent;
}

function render() {
  renderSeg();
  renderCats();
  renderHead();
  renderList();
  renderBookButton();
}

// ── ledger books (widget.db) ────────────────────────────
const bookDoc = (id) => `${BOOK_PREFIX}${id}`;
const entryPrefix = (id) => `${ENTRY_PREFIX}${id}/`;
const entriesKey = (list) => list.map((e) => `${e.id}:${e.t}:${e.a}:${e.k}:${e.c}`).join("|");

async function allDocs(prefix) {
  return (await widget.db.allDocs({ idStartsWith: prefix })) || [];
}

function fromDoc(d) {
  const t = Number(d.t);
  const a = Number(d.a);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return null;
  return {
    id: String(d._id),
    uid: String(d.uid || d._id),
    t,
    a,
    k: d.k === "in" ? "in" : "out",
    c: String(d.c || "other"),
  };
}

function sortEntries(list) {
  return list.sort((a, b) => b.t - a.t || String(b.id).localeCompare(String(a.id)));
}

async function readEntries(id) {
  if (!id) return [];
  const docs = await allDocs(entryPrefix(id));
  const missing = docs.filter((d) => d && d._id && !d.uid);
  if (missing.length) {
    await Promise.all(missing.map((d) => widget.db.put({ ...d, uid: String(d._id) }))).catch(() => {});
  }
  return sortEntries(docs.map(fromDoc).filter(Boolean));
}

async function listBooks() {
  const docs = await allDocs(BOOK_PREFIX);
  books = docs
    .filter((d) => d && d._id)
    .map((d) => ({
      id: String(d.bookId || String(d._id).slice(BOOK_PREFIX.length)),
      name: String(d.name || L("未命名帳本", "未命名账本", "Untitled ledger")),
      created: Number(d.created) || 0,
    }))
    .sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
}

function uniqueName(base) {
  let name = base;
  let n = 2;
  while (books.some((b) => b.name === name)) name = `${base} ${n++}`;
  return name;
}

function entryDocId(time, id) {
  return `${ENTRY_PREFIX}${id}/${time}`;
}

function sourceDocs(list, id) {
  return list.map((e, i) => ({
    _id: `${entryDocId(Number(e.t), id)}-${i}-${rid()}`,
    book: id,
    uid: String(e.uid || newUid()),
    t: Number(e.t),
    a: Number(e.a),
    k: e.k === "in" ? "in" : "out",
    c: String(e.c || "other"),
  }));
}

async function putAll(docs) {
  if (!docs.length) return;
  const out = await widget.db.bulkDocs(docs);
  if (Array.isArray(out) && out.some((r) => !r || r.ok === false)) {
    throw new Error("bulk write failed");
  }
}

async function createBook(name, source) {
  const id = rid();
  const now = Date.now();
  await widget.db.put({ _id: bookDoc(id), bookId: id, name, created: now, updated: now });
  if (source && source.length) {
    try {
      await putAll(sourceDocs(source, id));
    } catch (e) {
      await widget.db.remove(bookDoc(id)).catch(() => {});
      throw e;
    }
  }
  await listBooks();
  return id;
}

async function importLegacy(id, list) {
  await putAll(sourceDocs(list, id));
  await widget.storage.remove("entries");
}

function normalizeLegacy(v) {
  if (!Array.isArray(v)) return null;
  return v
    .filter((x) => x && Number.isFinite(Number(x.a)) && Number.isFinite(Number(x.t)))
    .map((x) => ({
      t: Number(x.t),
      a: Math.round(Number(x.a) * 100) / 100,
      k: x.k === "in" ? "in" : "out",
      c: String(x.c || "other"),
    }));
}

async function useBook(id, { close = true } = {}) {
  const hit = books.find((b) => b.id === id);
  if (!hit) return false;
  bookId = id;
  bookName = hit.name;
  await widget.storage.set("bookId", id);
  await widget.storage.set("bookName", hit.name);
  await loadEntries();
  if (close) closeBookPanel(true);
  render();
  return true;
}

async function loadEntries() {
  entries = await readEntries(bookId);
  lastKey = entriesKey(entries);
}

async function refreshFromDb(force = false) {
  if (!bookId || refreshing || busy) return;
  refreshing = true;
  const at = bookId;
  try {
    const meta = await widget.db.get(bookDoc(at));
    if (!meta) {
      await listBooks();
      if (!books.some((b) => b.id === at)) {
        await forgetBook();
        return;
      }
    }
    const list = await readEntries(at);
    if (at !== bookId) return;
    const key = entriesKey(list);
    if (force || key !== lastKey) {
      entries = list;
      lastKey = key;
      render();
    }
  } catch (e) {
    widget.log(`ledger: refresh ${e.message}`);
  } finally {
    refreshing = false;
  }
}

async function forgetBook() {
  bookId = "";
  bookName = "";
  entries = [];
  lastKey = "";
  await widget.storage.remove("bookId");
  await widget.storage.remove("bookName");
  render();
  openBookPanel(true);
  toast(L("帳本已被刪除，請選擇其他帳本", "账本已被删除，请选择其他账本", "That ledger was deleted; choose another"));
}

function resetDeleteArm() {
  if (deleteTimer) clearTimeout(deleteTimer);
  deleteTimer = 0;
  deleteArmed = false;
}

function closeBookPanel(force = false) {
  if (!bookId && !importPrompt && !force) return;
  panelOpen = false;
  importPrompt = null;
  $("bookPanel").hidden = true;
  $("book").setAttribute("aria-expanded", "false");
  $("led").classList.remove("is-choosing");
  resetDeleteArm();
}

function renderBookPanel() {
  const required = !bookId && !importPrompt;
  const title = importPrompt
    ? L("匯入備份", "导入备份", "Import backup")
    : required
      ? L("選擇帳本", "选择账本", "Choose ledger")
      : L("帳本", "账本", "Book");
  const note = required
    ? L(
        "這張卡片還沒有帳本。選擇現有帳本會與其他卡片共用資料；也可以新建或複製一本。",
        "这张卡片还没有账本。选择现有账本会与其他卡片共用数据；也可以新建或复制一本。",
        "This card has no ledger yet. Pick an existing one to share data, or create/copy one."
      )
    : L(
        "同一帳本可被多張卡片共用。切換只影響這張卡片。",
        "同一账本可被多张卡片共用。切换只影响这张卡片。",
        "Cards can share a ledger. Switching only affects this card."
      );
  const rows = books.length
    ? books
        .map(
          (b) => `<div class="book-row">
            <button class="book-pick${b.id === bookId ? " is-on" : ""}" data-book="${b.id}">${esc(b.name)}</button>
            <button class="book-copy" data-copy="${b.id}">${L("複製", "复制", "Copy")}</button>
          </div>`
        )
        .join("")
    : `<div class="book-note">${esc(L("還沒有帳本", "还没有账本", "No ledgers yet"))}</div>`;
  const warn = required
    ? L("必須先選擇或建立帳本才能記帳", "必须先选择或建立账本才能记账", "Choose or create a ledger before recording")
    : deleteArmed
      ? L(
          "再按一次會刪除這個帳本的全部記錄，且無法復原；建議先匯出備份。",
          "再按一次会删除这个账本的全部记录，且无法复原；建议先导出备份。",
          "Press again to delete every entry in this ledger. Export a backup first."
        )
      : "";
  const ignored = importPrompt ? importPrompt.invalid + importPrompt.duplicates : 0;
  const prompt = importPrompt
    ? `<div class="book-merge">
        <div class="book-merge-title">${esc(L("發現同名帳本", "发现同名账本", "Same ledger name"))}</div>
        <div class="book-note">${esc(
          L(
            `備份「${importPrompt.base}」與現有帳本「${importPrompt.targetName}」同名。`,
            `备份“${importPrompt.base}”与现有账本“${importPrompt.targetName}”同名。`,
            `The backup "${importPrompt.base}" has the same name as "${importPrompt.targetName}".`
          )
        )}</div>
        <div class="book-note">${esc(
          L(
            `共 ${importPrompt.list.length} 筆記錄${ignored ? `，另有 ${ignored} 筆將略過` : ""}。合併會按記錄 ID 去重，ID 相同只保留一份；另建會建立一本新帳本。`,
            `共 ${importPrompt.list.length} 条记录${ignored ? `，另有 ${ignored} 条将跳过` : ""}。合并会按记录 ID 去重，ID 相同只保留一份；另建会建立一本新账本。`,
            `${importPrompt.list.length} entries${ignored ? `, ${ignored} more will be skipped` : ""}. Merge deduplicates by entry ID; create a separate ledger instead if you want both.`
          )
        )}</div>
        <div class="book-actions">
          <button class="book-act is-primary" data-act="merge-import">${esc(L(`合併到「${importPrompt.targetName}」`, `合并到“${importPrompt.targetName}”`, `Merge into "${importPrompt.targetName}"`))}</button>
          <button class="book-act" data-act="new-import">${L("另建新帳本", "另建新账本", "Create separate ledger")}</button>
          <button class="book-act" data-act="cancel-import">${L("取消", "取消", "Cancel")}</button>
        </div>
      </div>`
    : "";
  const normal = importPrompt
    ? ""
    : `<div class="book-note">${note}</div>
      <div class="book-list">${rows}</div>
      <div class="book-actions">
        <button class="book-act" data-act="new">${L("新建帳本", "新建账本", "New ledger")}</button>
        <label class="book-act book-file">${L("匯入備份", "导入备份", "Import")}<input id="importFile" type="file" accept=".json,application/json"></label>
        ${bookId ? `<button class="book-act" data-act="export">${L("匯出備份", "导出备份", "Export")}</button>` : ""}
        ${bookId ? `<button class="book-act is-danger" data-act="delete">${deleteArmed ? L("再按一次刪除", "再按一次删除", "Delete again") : L("刪除帳本", "删除账本", "Delete ledger")}</button>` : ""}
      </div>
      <div class="book-note is-import">${L("匯入遇到同名帳本會先詢問是否合併；也可以把 JSON 拖到卡片上。", "导入遇到同名账本会先询问是否合并；也可以把 JSON 拖到卡片上。", "If a ledger with the same name exists, you can choose to merge; you can also drop the JSON on the card.")}</div>
      ${warn ? `<div class="book-note${deleteArmed ? " is-warn" : ""}">${warn}</div>` : ""}
      ${lastExport && lastExport.bookId === bookId ? `<div class="book-export">
        <div>${L("已匯出到「下載」資料夾", "已导出到「下载」文件夹", "Saved to Downloads")}</div>
        ${lastExport.dir ? `<div class="book-export-path" title="${esc(lastExport.dir)}">${esc(lastExport.dir)}</div>` : ""}
        <div class="book-export-name">${esc(lastExport.name)}</div>
        <div class="book-export-hint">${L("若同名檔案已存在，Windows 會自動加上 (1)", "若同名文件已存在，Windows 会自动加上 (1)", "Windows adds (1) if the name already exists")}</div>
      </div>` : ""}`;
  $("bookPanel").innerHTML = `
    <div class="book-head">
      <span>${esc(title)}</span>
      ${bookId || importPrompt ? `<button class="book-close" data-act="close" aria-label="close">×</button>` : ""}
    </div>
    ${prompt}${normal}
  `;
  $("bookPanel").hidden = false;
  panelOpen = true;
  $("book").setAttribute("aria-expanded", "true");
  $("led").classList.toggle("is-choosing", required);
}

async function openBookPanel(force = false) {
  if (panelOpen && !force) {
    closeBookPanel();
    return;
  }
  resetDeleteArm();
  try {
    await listBooks();
  } catch (e) {
    widget.log(`ledger: list books ${e.message}`);
  }
  renderBookPanel();
}

async function newBook() {
  if (busy) return;
  busy = true;
  try {
    const id = await createBook(uniqueName(L("帳本", "账本", "Ledger")), []);
    await useBook(id);
    toast(L("已建立新帳本", "已建立新账本", "Ledger created"));
  } catch (e) {
    toast(L("建立帳本失敗", "建立账本失败", "Could not create the ledger"));
    widget.log(`ledger: new book ${e.message}`);
  } finally {
    busy = false;
  }
}

async function copyBook(id) {
  if (busy) return;
  const src = books.find((b) => b.id === id);
  if (!src) return;
  busy = true;
  try {
    const list = await readEntries(id);
    const copyName = uniqueName(`${src.name} ${L("副本", "副本", "copy")}`);
    const newId = await createBook(copyName, list.slice().sort((a, b) => a.t - b.t));
    await useBook(newId);
    toast(L("已複製帳本", "已复制账本", "Ledger copied"));
  } catch (e) {
    toast(L("複製帳本失敗", "复制账本失败", "Could not copy the ledger"));
    widget.log(`ledger: copy book ${e.message}`);
  } finally {
    busy = false;
  }
}

async function exportBook() {
  if (!bookId) return;
  try {
    const list = (await readEntries(bookId)).slice().sort((a, b) => a.t - b.t);
    const payload = {
      app: "WinWidget",
      widget: "winwidget.ledger",
      version: 2,
      book: { id: bookId, name: bookName },
      exportedAt: new Date().toISOString(),
      entries: list.map((e) => ({ id: e.uid, time: e.t, amount: e.a, kind: e.k, category: e.c })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (bookName || "ledger").replace(/[\\/:*?"<>|]/g, "_");
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const filename = `winwidget-ledger-${safe}-${day}.json`;
    a.href = url;
    a.download = filename;
    a.addEventListener("click", (ev) => ev.stopPropagation());
    document.body.appendChild(a);
    exporting = true;
    a.click();
    setTimeout(() => {
      exporting = false;
    }, 300);
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    const dir = await widget.paths.named("downloads").catch(() => null);
    lastExport = { bookId, dir: dir || "", name: filename };
    toast(L("已匯出到「下載」資料夾", "已导出到「下载」文件夹", "Saved to Downloads"));
    renderBookPanel();
  } catch (e) {
    toast(L("匯出失敗", "导出失败", "Export failed"));
    widget.log(`ledger: export ${e.message}`);
  }
}

function parseBackup(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) throw new Error("not a ledger backup");
  const seen = new Set();
  const list = [];
  let invalid = 0;
  let duplicates = 0;
  for (const e of data.entries) {
    const t = Number(e && e.time);
    const a = Math.round(Number(e && e.amount) * 100) / 100;
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(a) || a <= 0) {
      invalid++;
      continue;
    }
    const raw = e && (e.id || e.uid);
    const uid = raw ? String(raw).slice(0, 200) : newUid();
    if (seen.has(uid)) {
      duplicates++;
      continue;
    }
    seen.add(uid);
    list.push({ uid, t, a, k: e.kind === "in" ? "in" : "out", c: String(e.category || "other") });
  }
  if (data.entries.length && !list.length) throw new Error("no valid entries");
  return { list, invalid, duplicates };
}

function importToast(name, added, invalid, duplicates) {
  const bits = [];
  if (added) {
    bits.push(L(`已匯入 ${added} 筆到「${name}」`, `已导入 ${added} 条到“${name}”`, `Imported ${added} into "${name}"`));
  } else {
    bits.push(L(`「${name}」沒有新增記錄`, `“${name}”没有新增记录`, `No new entries for "${name}"`));
  }
  if (duplicates) bits.push(L(`略過 ${duplicates} 筆重複`, `跳过 ${duplicates} 条重复`, `Skipped ${duplicates} duplicate`));
  if (invalid) bits.push(L(`略過 ${invalid} 筆無效記錄`, `跳过 ${invalid} 条无效记录`, `Skipped ${invalid} invalid`));
  toast(bits.join(L("；", "；", "; ")));
}

async function createImportedBook(base, list, invalid, duplicates) {
  const name = uniqueName(base || L("匯入帳本", "导入账本", "Imported ledger"));
  const id = await createBook(name, list.slice().sort((a, b) => a.t - b.t));
  await useBook(id);
  importToast(name, list.length, invalid, duplicates);
}

async function mergeIntoBook(id, list) {
  const meta = await widget.db.get(bookDoc(id));
  if (!meta) throw new Error("ledger missing");
  const existing = await readEntries(id);
  const seen = new Set(existing.map((e) => e.uid));
  const add = [];
  let duplicates = 0;
  for (const e of list) {
    if (seen.has(e.uid)) {
      duplicates++;
      continue;
    }
    seen.add(e.uid);
    add.push(e);
  }
  if (add.length) {
    await putAll(sourceDocs(add, id));
    await widget.db.put({ ...meta, updated: Date.now() });
  }
  return { added: add.length, duplicates };
}

async function finishImport(mode) {
  const p = importPrompt;
  if (!p || busy) return;
  busy = true;
  let done = false;
  try {
    if (mode === "merge") {
      const result = await mergeIntoBook(p.targetId, p.list);
      await useBook(p.targetId);
      importToast(p.targetName, result.added, p.invalid, p.duplicates + result.duplicates);
    } else {
      await createImportedBook(p.base, p.list, p.invalid, p.duplicates);
    }
    done = true;
  } catch (e) {
    toast(mode === "merge"
      ? L("合併失敗", "合并失败", "Could not merge")
      : L("匯入失敗", "导入失败", "Import failed"));
    widget.log(`ledger: import ${e.message}`);
  } finally {
    if (done) importPrompt = null;
    busy = false;
    if (panelOpen) renderBookPanel();
  }
}

async function importBookFile(file) {
  if (busy) return;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast(L("備份檔太大", "备份文件太大", "Backup file is too large"));
    return;
  }
  busy = true;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const parsed = parseBackup(data);
    const base = String((data.book && data.book.name) || file.name.replace(/\.json$/i, "")).trim();
    await listBooks();
    const target = books.find((b) => b.name.trim() === base);
    if (target) {
      importPrompt = {
        base,
        list: parsed.list,
        targetId: target.id,
        targetName: target.name,
        invalid: parsed.invalid,
        duplicates: parsed.duplicates,
      };
      renderBookPanel();
      return;
    }
    await createImportedBook(base, parsed.list, parsed.invalid, parsed.duplicates);
  } catch (e) {
    toast(L("匯入失敗，這不是有效的帳本備份", "导入失败，这不是有效的账本备份", "Import failed: not a ledger backup"));
    widget.log(`ledger: import ${e.message}`);
  } finally {
    busy = false;
    if (panelOpen) renderBookPanel();
  }
}

async function deleteBook() {
  if (!bookId || busy) return;
  const id = bookId;
  const name = bookName;
  busy = true;
  try {
    const docs = await allDocs(entryPrefix(id));
    await Promise.all(docs.map((d) => widget.db.remove(d._id)));
    await widget.db.remove(bookDoc(id));
    const wasCurrent = bookId === id;
    if (wasCurrent) {
      bookId = "";
      bookName = "";
      entries = [];
      lastKey = "";
      await widget.storage.remove("bookId");
      await widget.storage.remove("bookName");
    }
    await listBooks();
    if (wasCurrent) {
      render();
      renderBookPanel();
    }
    toast(L(`已刪除帳本「${name}」`, `已删除账本“${name}”`, `Deleted "${name}"`));
  } catch (e) {
    toast(L("刪除帳本失敗", "删除账本失败", "Could not delete the ledger"));
    widget.log(`ledger: delete book ${e.message}`);
  } finally {
    deleteArmed = false;
    if (deleteTimer) clearTimeout(deleteTimer);
    deleteTimer = 0;
    busy = false;
  }
}

async function onPanelClick(e) {
  const act = e.target.closest("[data-act]");
  if (act) {
    const name = act.dataset.act;
    if (name === "close") closeBookPanel();
    else if (name === "new") {
      resetDeleteArm();
      await newBook();
    } else if (name === "export") {
      resetDeleteArm();
      await exportBook();
    } else if (name === "merge-import") {
      await finishImport("merge");
    } else if (name === "new-import") {
      await finishImport("new");
    } else if (name === "cancel-import") {
      importPrompt = null;
      renderBookPanel();
    } else if (name === "delete") {
      if (!bookId) return;
      if (!deleteArmed) {
        deleteArmed = true;
        renderBookPanel();
        deleteTimer = setTimeout(() => {
          deleteArmed = false;
          deleteTimer = 0;
          if (panelOpen) renderBookPanel();
        }, 5000);
      } else {
        resetDeleteArm();
        await deleteBook();
      }
    }
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    resetDeleteArm();
    await copyBook(copy.dataset.copy);
    return;
  }
  const pick = e.target.closest("[data-book]");
  if (pick) {
    resetDeleteArm();
    await useBook(pick.dataset.book);
  }
}

async function boot() {
  try {
    const ui = await widget.storage.get("ui");
    if (ui && typeof ui === "object") {
      kind = ui.kind === "in" ? "in" : "out";
      const list = CATS[kind] || CATS.out;
      cat = list.some((c) => c.k === ui.cat) ? ui.cat : list[0].k;
    }
    await listBooks();
    const saved = await widget.storage.get("bookId");
    const savedName = await widget.storage.get("bookName");
    const legacy = normalizeLegacy(await widget.storage.get("entries"));
    if (typeof saved === "string" && saved) {
      const hit = books.find((b) => b.id === saved);
      if (hit) {
        bookId = saved;
        bookName = hit.name;
        if (legacy) await importLegacy(saved, legacy);
        await loadEntries();
      } else if (legacy) {
        const name = uniqueName(typeof savedName === "string" && savedName ? savedName : defaultBookName());
        const id = await createBook(name, legacy);
        await widget.storage.remove("entries");
        await useBook(id);
      } else {
        await widget.storage.remove("bookId");
        await widget.storage.remove("bookName");
      }
    } else if (legacy) {
      const id = await createBook(uniqueName(defaultBookName()), legacy);
      await widget.storage.remove("entries");
      await useBook(id);
    } else if (!books.length) {
      const id = await createBook(uniqueName(defaultBookName()), []);
      await useBook(id);
    }
    render();
    if (!bookId) openBookPanel(true);
  } catch (e) {
    widget.log(`ledger: boot ${e.message}`);
    toast(L("帳本載入失敗", "账本加载失败", "Could not load the ledger"));
  }
}

// ── wiring ─────────────────────────────────────────────
$("title").textContent = L("記帳速記", "记账速记", "Quick ledger");
$("seg").children[0].textContent = L("支出", "支出", "Out");
$("seg").children[1].textContent = L("收入", "收入", "In");
$("add").textContent = L("記一筆", "记一笔", "Record");

$("book").onclick = (e) => {
  e.stopPropagation();
  openBookPanel();
};

document.addEventListener("click", (e) => {
  if (!panelOpen || exporting) return;
  if (e.target.closest("#bookPanel") || e.target.closest("#book")) return;
  if (!bookId) return;
  closeBookPanel();
});

$("bookPanel").onclick = (e) => {
  e.stopPropagation();
  onPanelClick(e);
};

$("seg").onclick = (e) => {
  const b = e.target.closest("[data-k]");
  if (!b) return;
  kind = b.dataset.k;
  cat = CATS[kind][0].k;
  saveUi();
  render();
};

$("cats").onclick = (e) => {
  const b = e.target.closest("[data-c]");
  if (!b) return;
  cat = b.dataset.c;
  saveUi();
  renderCats();
};

$("add").onclick = add;
$("amt").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    add();
  }
});

$("list").onclick = async (e) => {
  const del = e.target.closest(".del");
  if (!del) return;
  const i = Number(del.dataset.i);
  const row = entries[i];
  if (!row) return;
  entries.splice(i, 1);
  lastKey = entriesKey(entries);
  render();
  try {
    await widget.db.remove(row.id);
  } catch (err) {
    toast(L("刪除失敗", "删除失败", "Could not delete"));
    await loadEntries();
    render();
    widget.log(`ledger: delete entry ${err.message}`);
  }
};

widget.settings.onChange(() => {
  $("cur").textContent = sym();
  renderHead();
});

window.addEventListener("focus", () => refreshFromDb());
widget.on("show", () => refreshFromDb());
setInterval(() => {
  if (!document.hidden) refreshFromDb();
}, 5000);

document.addEventListener("dragover", (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("drop", async (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    toast(L("請拖入 JSON 備份檔", "请拖入 JSON 备份文件", "Drop a JSON backup file"));
    return;
  }
  await importBookFile(file);
  if (panelOpen) renderBookPanel();
});

document.addEventListener("change", async (e) => {
  if (!e.target || e.target.id !== "importFile") return;
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) await importBookFile(file);
});

/**
 * The amount is typed in yuan: "100" → 100, "123" → 123, "1,234.5" → 1234.5, "12..3" → 12.3.
 * Full-width digits and dots (a Chinese IME's default) are folded back first, since `\d` only
 * matches ASCII digits and "１００" would otherwise parse as nothing at all.
 */
function parseAmount(text) {
  const folded = String(text || "")
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uFF0E\uFF0F\u3002]/g, ".");
  const cleaned = folded.replace(/[^\d.]/g, "");
  const at = cleaned.indexOf(".");
  const normalized = at < 0 ? cleaned : cleaned.slice(0, at + 1) + cleaned.slice(at + 1).replace(/\./g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function add() {
  if (!bookId) {
    openBookPanel(true);
    toast(L("先選擇帳本", "先选择账本", "Choose a ledger first"));
    return;
  }
  const amount = parseAmount($("amt").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast(L("先打個金額", "先打个金额", "Enter an amount first"));
    $("amt").focus();
    return;
  }
  const now = Date.now();
  const uid = newUid();
  const e = { id: `${ENTRY_PREFIX}${bookId}/${now}/${rid()}`, uid, t: now, a: Math.round(amount * 100) / 100, k: kind, c: cat };
  try {
    await widget.db.put({ _id: e.id, book: bookId, uid, t: e.t, a: e.a, k: e.k, c: e.c });
  } catch (err) {
    toast(L("儲存失敗", "保存失败", "Could not save"));
    widget.log(`ledger: add ${err.message}`);
    return;
  }
  entries.unshift(e);
  $("amt").value = "";
  if (entries.length > keep()) {
    const extra = entries.slice(keep());
    entries = entries.slice(0, keep());
    await Promise.all(extra.map((x) => widget.db.remove(x.id))).catch(() => {});
  }
  lastKey = entriesKey(entries);
  render();
}

$("cur").textContent = sym();
render();
boot();
