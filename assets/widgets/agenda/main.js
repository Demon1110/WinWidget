const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

const DEFAULT_ITEMS = [
  { title: "開場 · 上次待辦", min: 5 },
  { title: "主題討論", min: 15 },
  { title: "風險與排期", min: 10 },
  { title: "收尾 · 結論", min: 5 },
];

let items = DEFAULT_ITEMS.map((x) => ({ ...x }));
let i = 0;
let acc = 0;          // ms already spent on the current slice
let startAt = 0;      // when the current run started
let running = false;
let alerted = -1;     // slice index we already beeped for
let ticker = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mmss = (ms) => {
  const sign = ms < 0 ? "-" : "";
  const total = Math.round(Math.abs(ms) / 1000);
  return `${sign}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const sliceMs = () => Math.max(1, Number(items[i] && items[i].min) || 1) * 60000;
const elapsed = () => acc + (running ? Date.now() - startAt : 0);
const totalMin = () => items.reduce((s, x) => s + (Number(x.min) || 0), 0);

function save() {
  widget.storage.set("agenda", { items, i, acc, startAt: running ? startAt : 0, running }).catch(() => {});
}

function renderList() {
  $("list").innerHTML = items.map((it, n) => `
    <li class="row${n === i ? " is-now" : ""}${n < i ? " is-past" : ""}" data-i="${n}">
      <span class="n">${esc(it.title)}</span>
      <span class="m">${Number(it.min) || 0}′</span>
      <button class="del" data-i="${n}" aria-label="remove">×</button>
    </li>`).join("");
}

function paint() {
  const item = items[i];
  $("idx").textContent = `${i + 1}/${items.length}`;
  $("nowTitle").textContent = item ? item.title : L("沒有段落", "没有段落", "No slice");
  $("total").textContent = L(`總 ${totalMin()} 分`, `总 ${totalMin()} 分`, `${totalMin()} min total`);

  if (!item) {
    $("clock").textContent = "00:00";
    $("fill").style.width = "0%";
    return;
  }

  const spent = elapsed();
  const left = sliceMs() - spent;
  $("clock").textContent = mmss(left);
  $("clock").classList.toggle("is-over", left < 0);
  $("fill").style.width = `${Math.max(0, Math.min(100, (spent / sliceMs()) * 100))}%`;
  $("fill").classList.toggle("is-over", left < 0);

  if (left <= 0 && alerted !== i) {
    alerted = i;
    if (widget.settings.get("beep") !== false) {
      widget.notify({
        title: L("這段時間到了", "这段时间到了", "Slice is over"),
        body: (item.title || "") + L(" — 該推進下一段了", " — 该推进下一段了", " — move on"),
        tag: "agenda",
      }).catch(() => {});
    }
  }
}

function setRunning(on) {
  if (on === running) return;
  if (on) {
    startAt = Date.now();
    running = true;
  } else {
    acc = elapsed();
    running = false;
  }
  save();
  paint();
}

function goTo(n) {
  if (!items.length) return;
  i = (n + items.length) % items.length;
  acc = 0;
  startAt = Date.now();
  alerted = -1;
  save();
  paint();
  renderList();
}

$("title").textContent = L("議程", "议程", "Agenda");
$("play").textContent = "";

function paintPlay() {
  $("play").textContent = running ? L("暫停", "暂停", "Pause") : L("開始", "开始", "Start");
  $("reset").textContent = L("重設", "重置", "Reset");
  $("newTitle").placeholder = L("段落名稱", "段落名称", "Slice name");
  $("newMin").placeholder = L("分", "分", "min");
}

$("play").onclick = () => setRunning(!running);
$("next").onclick = () => goTo(i + 1);
$("prev").onclick = () => goTo(i - 1);
$("reset").onclick = () => {
  acc = 0;
  running = false;
  alerted = -1;
  i = 0;
  save();
  paint();
  renderList();
};

$("list").onclick = (e) => {
  const del = e.target.closest(".del");
  if (del) {
    items.splice(Number(del.dataset.i), 1);
    if (i > items.length - 1) i = Math.max(0, items.length - 1);
    acc = 0;
    alerted = -1;
    save();
    paint();
    renderList();
    return;
  }
  const row = e.target.closest(".row");
  if (row) goTo(Number(row.dataset.i));
};

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = String($("newTitle").value || "").trim();
  const min = Math.max(1, Math.min(180, Math.round(Number($("newMin").value) || 5)));
  if (!title) return;
  items.push({ title: title.slice(0, 60), min });
  $("newTitle").value = "";
  $("newMin").value = "";
  save();
  renderList();
  paint();
});

widget.settings.onChange(paintPlay);

function loop() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!document.hidden) paint();
  }, 500);
}

paintPlay();
renderList();
paint();
loop();

widget.storage.get("agenda").then((v) => {
  if (v && Array.isArray(v.items) && v.items.length) {
    items = v.items.filter((x) => x && x.title).map((x) => ({ title: String(x.title), min: Math.max(1, Number(x.min) || 5) }));
    i = Math.min(Math.max(0, Number(v.i) || 0), items.length - 1);
    acc = Math.max(0, Number(v.acc) || 0);
    running = !!v.running;
    startAt = Number(v.startAt) || Date.now();
    if (running && !startAt) running = false;
  }
  paintPlay();
  renderList();
  paint();
}).catch((e) => widget.log(`agenda: load ${e.message}`));

widget.on("unload", () => clearInterval(ticker));
