const $ = (id) => document.getElementById(id);
const t = widget.t;
let items = []; // { id, text, done }

// called up with the to-do shortcut: ready to type a new item
widget.on("summon", () => $("new").focus());

$("new").placeholder = t({ "zh-TW": "新增一項，按 Enter", "zh-CN": "新增一项，按 Enter", en: "Add an item" });
$("clear").textContent = t({ "zh-TW": "清除已完成", "zh-CN": "清除已完成", en: "Clear done" });

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function save() {
  widget.storage.set("items", items).catch((e) => widget.log(`todo: save failed: ${e.message}`));
}

function render() {
  $("title").textContent = widget.settings.get("title") || "";
  const done = items.filter((x) => x.done).length;
  const left = items.length - done;
  $("count").innerHTML = items.length
    ? `<span class="small"><b>${done}</b> / ${items.length}</span><span class="big">${left}</span>`
    : "";
  $("prog").style.width = items.length ? `${(done / items.length) * 100}%` : "0";

  // open items first, finished ones sink to the bottom
  const ordered = [...items.filter((x) => !x.done), ...items.filter((x) => x.done)];
  $("list").innerHTML = ordered.map((x) => `
    <li class="${x.done ? "done" : ""}" data-id="${x.id}">
      <button class="w-check" aria-pressed="${x.done}" data-act="toggle" data-no-drag></button>
      <span class="text">${esc(x.text)}</span>
      <button class="w-btn del" data-act="del" data-no-drag aria-label="delete">×</button>
    </li>`).join("");

  $("empty").textContent = t({ "zh-TW": "還沒有待辦事項", "zh-CN": "还没有待办事项", en: "Nothing to do yet" });
  $("empty").hidden = items.length > 0;
  $("clear").hidden = done === 0;
}

$("add").onsubmit = (e) => {
  e.preventDefault();
  const text = $("new").value.trim();
  if (!text) return;
  items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false });
  $("new").value = "";
  save();
  render();
};

$("list").onclick = (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest("li").dataset.id;
  const item = items.find((x) => x.id === id);
  if (!item) return;
  if (btn.dataset.act === "toggle") item.done = !item.done;
  else items = items.filter((x) => x !== item);
  save();
  render();
};

$("clear").onclick = () => {
  items = items.filter((x) => !x.done);
  save();
  render();
};

widget.settings.onChange(render);
widget.storage.get("items").then((v) => { items = Array.isArray(v) ? v : []; render(); });
