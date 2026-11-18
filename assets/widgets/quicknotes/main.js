const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let saveTimer = 0;
let savedAt = 0;
let dirty = false;

const sizeSetting = () => Math.min(20, Math.max(12, Math.round(Number(widget.settings.get("size")) || 14)));
const wrapOn = () => widget.settings.get("wrap") !== false;

const pad = () => $("pad");
const count = () => String(pad().value || "").replace(/\s/g, "").length;
const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function paintStyle() {
  pad().style.fontSize = `${sizeSetting()}px`;
  pad().style.whiteSpace = wrapOn() ? "pre-wrap" : "pre";
  pad().style.overflowX = wrapOn() ? "hidden" : "auto";
}

function paintStat() {
  const n = count();
  $("stat").textContent = L(`${n} 字`, `${n} 字`, `${n} chars`);
  $("saved").textContent = dirty
    ? L("未儲存…", "未保存…", "unsaved…")
    : savedAt
      ? L(`${clock(savedAt)} 已存`, `${clock(savedAt)} 已存`, `saved ${clock(savedAt)}`)
      : "";
}

function flush() {
  clearTimeout(saveTimer);
  const text = String(pad().value || "");
  widget.storage.set("pad", text).then(() => {
    savedAt = Date.now();
    dirty = false;
    paintStat();
  }).catch((e) => widget.log(`quicknotes: save ${e.message}`));
}

function scheduleSave() {
  dirty = true;
  paintStat();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

$("title").textContent = L("筆記板", "笔记板", "Scratch pad");
$("copy").textContent = L("複製", "复制", "Copy");
$("paste").textContent = L("貼上", "粘贴", "Paste");
$("clear").textContent = L("清空", "清空", "Clear");
pad().placeholder = L("在這裡寫點東西…", "在这里写点东西…", "Type away…");

pad().addEventListener("input", () => {
  paintStat();
  scheduleSave();
});

$("copy").onclick = () => {
  const text = String(pad().value || "");
  if (!text) {
    $("saved").textContent = L("板子是空的", "板子是空的", "Nothing to copy");
    return;
  }
  widget.clipboard.writeText(text).then(() => {
    $("saved").textContent = L("已複製", "已复制", "Copied");
  }).catch((e) => {
    $("saved").textContent = String(e.message || e);
  });
};

$("paste").onclick = () => {
  widget.clipboard.readText().then((text) => {
    const s = String(text || "");
    if (!s) {
      $("saved").textContent = L("剪貼板是空的", "剪贴板是空的", "Clipboard is empty");
      return;
    }
    const el = pad();
    const at = el.selectionStart == null ? el.value.length : el.selectionStart;
    const to = el.selectionEnd == null ? at : el.selectionEnd;
    el.value = el.value.slice(0, at) + s + el.value.slice(to);
    el.setSelectionRange(at + s.length, at + s.length);
    paintStat();
    scheduleSave();
  }).catch((e) => {
    $("saved").textContent = String(e.message || e);
  });
};

$("clear").onclick = () => {
  if (!pad().value) return;
  pad().value = "";
  paintStat();
  flush();
};

widget.settings.onChange(() => { paintStyle(); });

paintStyle();
paintStat();

widget.storage.get("pad").then((v) => {
  if (typeof v === "string") {
    pad().value = v;
    savedAt = Date.now();
  }
  paintStat();
}).catch((e) => widget.log(`quicknotes: load ${e.message}`));

widget.on("unload", () => { if (dirty) flush(); });
widget.on("hide", () => { if (dirty) flush(); });
widget.on("summon", () => pad().focus());
