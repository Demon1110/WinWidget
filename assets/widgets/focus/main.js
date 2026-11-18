const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let log = {};        // { "2026-11-18": { t, why, done } }

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => {
  const x = d || new Date();
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const key = () => stamp();
const today = () => log[key()] || null;

function save() {
  widget.storage.set("log", log).catch(() => {});
}

function streak() {
  let n = 0;
  for (let back = 0; back < 400; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const e = log[stamp(d)];
    if (e && e.done) n++;
    else if (back === 0) continue;      // today may still be pending
    else break;
  }
  return n;
}

function render() {
  const now = new Date();
  const week = L("日一二三四五六"[now.getDay()], "日一二三四五六"[now.getDay()], "");
  $("date").textContent = L(`${now.getMonth() + 1}/${now.getDate()} 週${week}`, `${now.getMonth() + 1}/${now.getDate()} 周${week}`, now.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  $("title").textContent = L("今日焦點", "今日焦点", "Today's focus");
  $("set").textContent = L("定下", "定下", "Set");
  $("clear").textContent = L("換一個", "换一个", "Replace");
  $("input").placeholder = L("今天只做這一件事", "今天只做这一件事", "The one thing for today");
  $("editInput").placeholder = L("焦點名稱", "焦点名称", "Focus name");
  $("why").placeholder = L("為什麼是這件事（可留空）", "为什么是这件事（可留空）", "Why this one (optional)");

  const e = today();
  const has = !!(e && e.t);
  $("ask").hidden = has;
  $("card").hidden = !has;

  if (has) {
    $("ttl").textContent = e.t;
    $("ttl").classList.toggle("is-done", !!e.done);
    if (document.activeElement !== $("why")) $("why").value = e.why || "";
    $("done").setAttribute("aria-checked", e.done ? "true" : "false");
    $("done").classList.toggle("is-on", !!e.done);
    $("mark").textContent = e.done ? L("完成了", "完成了", "Done") : L("進行中", "进行中", "In progress");
  } else {
    $("done").setAttribute("aria-checked", "false");
    $("mark").textContent = "";
  }

  const n = streak();
  $("streak").textContent = n > 0 ? L(`連續 ${n} 天`, `连续 ${n} 天`, `${n}-day streak`) : "";
}

function carry() {
  // an unfinished focus can follow you into the next day, once
  const e = today();
  if (e && e.t && !e.done) return;
  if (widget.settings.get("carry") === false) return;
  for (let back = 1; back <= 7; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const prev = log[stamp(d)];
    if (prev && prev.t && !prev.done) {
      log[key()] = { t: prev.t, why: prev.why || "", done: false, moved: true };
      save();
      return;
    }
  }
}

function setFocus(title) {
  const text = String(title || "").trim().slice(0, 120);
  if (!text) return;
  const e = today() || {};
  log[key()] = { t: text, why: e.why || "", done: false };
  save();
  render();
}

$("set").onclick = () => setFocus($("input").value);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); setFocus($("input").value); }
});

$("done").onclick = () => {
  const e = today();
  if (!e || !e.t) return;
  e.done = !e.done;
  save();
  render();
};

$("clear").onclick = () => {
  delete log[key()];
  save();
  $("input").value = "";
  render();
  $("input").focus();
};

$("ttl").onclick = () => {
  const e = today();
  if (!e) return;
  $("editInput").value = e.t;
  $("editInput").hidden = false;
  $("ttl").hidden = true;
  $("editInput").focus();
  $("editInput").select();
};

function commitEdit() {
  const e = today();
  if (!e) return;
  const v = String($("editInput").value || "").trim();
  if (v) e.t = v.slice(0, 120);
  $("editInput").hidden = true;
  $("ttl").hidden = false;
  save();
  render();
}
$("editInput").addEventListener("blur", commitEdit);
$("editInput").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); commitEdit(); }
  if (ev.key === "Escape") { $("editInput").hidden = true; $("ttl").hidden = false; }
});

let whyTimer = 0;
$("why").addEventListener("input", () => {
  clearTimeout(whyTimer);
  whyTimer = setTimeout(() => {
    const e = today();
    if (!e) return;
    e.why = String($("why").value || "").slice(0, 240);
    save();
  }, 500);
});

widget.settings.onChange(render);

render();
widget.storage.get("log").then((v) => {
  if (v && typeof v === "object") {
    log = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x && /^\d{4}-\d{2}-\d{2}$/.test(k) && x.t) log[k] = { t: String(x.t), why: String(x.why || ""), done: !!x.done };
    }
    // keep a year at most
    const keys = Object.keys(log).sort().slice(-366);
    const trimmed = {};
    for (const k of keys) trimmed[k] = log[k];
    log = trimmed;
  }
  carry();
  render();
}).catch((e) => widget.log(`focus: load ${e.message}`));
