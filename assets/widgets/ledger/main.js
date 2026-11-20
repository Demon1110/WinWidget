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

let entries = [];              // { t: <ms>, a: <number>, k: "out"|"in", c: <cat key> }
let kind = "out";
let cat = "meal";

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

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

function save() {
  widget.storage.set("entries", entries).catch(() => {});
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

function render() {
  renderSeg();
  renderCats();
  renderHead();
  renderList();
}

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

function add() {
  const amount = parseAmount($("amt").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast(L("先打個金額", "先打个金额", "Enter an amount first"));
    $("amt").focus();
    return;
  }
  entries.unshift({ t: Date.now(), a: Math.round(amount * 100) / 100, k: kind, c: cat });
  if (entries.length > keep()) entries.length = keep();
  save();
  $("amt").value = "";
  render();
}

// ── wiring ─────────────────────────────────────────────
$("title").textContent = L("記帳速記", "记账速记", "Quick ledger");
$("seg").children[0].textContent = L("支出", "支出", "Out");
$("seg").children[1].textContent = L("收入", "收入", "In");
$("add").textContent = L("記一筆", "记一笔", "Record");

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

$("list").onclick = (e) => {
  const del = e.target.closest(".del");
  if (!del) return;
  entries.splice(Number(del.dataset.i), 1);
  save();
  render();
};

widget.settings.onChange(() => {
  $("cur").textContent = sym();
  renderHead();
});

$("cur").textContent = sym();
render();

widget.storage.get("entries").then((v) => {
  if (Array.isArray(v)) {
    entries = v.filter((x) => x && Number.isFinite(Number(x.a)) && Number.isFinite(Number(x.t))).map((x) => ({
      t: Number(x.t), a: Number(x.a), k: x.k === "in" ? "in" : "out", c: String(x.c || "other"),
    }));
  }
  return widget.storage.get("ui");
}).then((ui) => {
  if (ui && typeof ui === "object") {
    kind = ui.kind === "in" ? "in" : "out";
    const list = CATS[kind] || CATS.out;
    cat = list.some((c) => c.k === ui.cat) ? ui.cat : list[0].k;
  }
  $("cur").textContent = sym();
  render();
}).catch((e) => widget.log(`ledger: load ${e.message}`));
