const $ = (id) => document.getElementById(id);
const t = widget.t;
const input = $("text");
const canvas = $("code");
const ctx = canvas.getContext("2d");
let matrix = null;
let error = null;
let timer = 0;

const level = () => (String(widget.settings.get("ecc") || "M").toUpperCase() === "L" ? "L" : "M");
const limitBytes = (lv) => (lv === "L" ? 271 : 213); // versions 1–10 data capacity, byte mode

$("title").textContent = t({ "zh-TW": "QR 分享", "zh-CN": "QR 分享", en: "QR share" });
input.placeholder = t({ "zh-TW": "貼上連結或任何文字…", "zh-CN": "贴上链接或任何文字…", en: "Paste a link or any text…" });
$("paste").textContent = t({ "zh-TW": "貼上", "zh-CN": "贴上", en: "Paste" });
$("copy").textContent = t({ "zh-TW": "複製", "zh-CN": "复制", en: "Copy" });
$("clear").textContent = t({ "zh-TW": "清除", "zh-CN": "清除", en: "Clear" });
$("note").textContent = t({ "zh-TW": "打點字，這裡就出現二維碼", "zh-CN": "打点字，这里就出现二维码", en: "Type something to get a code" });

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 1600);
}

const byteLength = (s) => new TextEncoder().encode(s).length;

function make() {
  const text = input.value.trim();
  matrix = null;
  error = null;
  if (!text) {
    error = t({ "zh-TW": "還沒有內容", "zh-CN": "还没有内容", en: "Nothing to encode" });
  } else {
    matrix = QREncoder.make(text, level());
    if (!matrix) error = t({ "zh-TW": "內容太長，縮短一點或改用低容錯", "zh-CN": "内容太长，缩短一点或改用低容错", en: "Too long — shorten it or lower the error correction" });
  }
  const n = byteLength(text);
  $("lvl").textContent = level();
  $("bytes").textContent = text ? `${n} / ${limitBytes(level())}` : "";
  $("bytes").classList.toggle("is-warn", n > limitBytes(level()));
  $("note").hidden = !!matrix;
  $("note").textContent = error || "";
  $("note").classList.toggle("is-error", !matrix && n > 0);
  draw();
}

function draw() {
  const plate = $("plate").getBoundingClientRect();
  const box = Math.floor(Math.min(plate.width, plate.height) - 16);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const px = Math.max(8, Math.floor(box * dpr));
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = box + "px";
  canvas.style.height = box + "px";
  ctx.clearRect(0, 0, px, px);
  if (!matrix) return;
  // quiet zone of four modules on every side
  const total = matrix.size + 8;
  const unit = Math.floor(px / total);
  const used = unit * total;
  const off = Math.floor((px - used) / 2) + unit * 4;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#0b0d10";
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.modules[y * matrix.size + x]) ctx.fillRect(off + x * unit, off + y * unit, unit, unit);
    }
  }
}

function remember() {
  widget.storage.set("text", input.value.slice(0, 400)).catch((e) => widget.log(`qr: ${e.message}`));
}

input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => { make(); remember(); }, 180);
});
input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); make(); } });

$("paste").onclick = async () => {
  try {
    const text = await widget.clipboard.readText();
    if (!text) { toast(t({ "zh-TW": "剪貼簿是空的", "zh-CN": "剪贴板是空的", en: "Clipboard is empty" })); return; }
    input.value = text.trim().slice(0, 400);
    make();
    remember();
  } catch (e) {
    toast(String(e.message || e));
  }
};

$("copy").onclick = async () => {
  const text = input.value.trim();
  if (!text) return;
  try {
    await widget.clipboard.writeText(text);
    toast(t({ "zh-TW": "已複製", "zh-CN": "已复制", en: "Copied" }));
  } catch (e) {
    toast(String(e.message || e));
  }
};

$("clear").onclick = () => {
  input.value = "";
  make();
  remember();
  input.focus();
};

widget.on("summon", () => input.focus());
new ResizeObserver(() => draw()).observe($("plate"));
widget.settings.onChange(() => make());

widget.storage.get("text").then((v) => {
  if (typeof v === "string" && v) input.value = v;
  make();
});
