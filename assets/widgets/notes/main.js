const box = document.getElementById("text");
const count = document.getElementById("count");
const t = widget.t;
let timer = 0;

box.placeholder = t({ "zh-TW": "寫點甚麼…", "zh-CN": "写点什么…", en: "Write something…" });

function applySettings(s) {
  document.body.classList.remove("size-small", "size-medium", "size-large");
  document.body.classList.add(`size-${s.fontSize || "medium"}`);
}

function showCount() {
  const n = [...box.value].length;
  count.textContent = t({ "zh-TW": `${n} 字`, "zh-CN": `${n} 字`, en: `${n} chars` });
}

function save() {
  clearTimeout(timer);
  widget.storage.set("text", box.value).catch((e) => widget.log(`notes: save failed: ${e.message}`));
}

box.addEventListener("input", () => {
  showCount();
  clearTimeout(timer);
  timer = setTimeout(save, 400);
});
box.addEventListener("blur", save);

applySettings(widget.settings.get());
widget.settings.onChange(applySettings);
widget.storage.get("text").then((v) => { box.value = v || ""; showCount(); });

// called up with the notes shortcut: ready to type at the end
widget.on("summon", () => {
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
  box.scrollTop = box.scrollHeight;
});
