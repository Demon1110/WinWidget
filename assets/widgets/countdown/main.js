const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
let start = null; // when counting began, for the dots

$("edit").textContent = t({ "zh-TW": "編輯", "zh-CN": "编辑", en: "Edit" });
$("l-title").textContent = t({ "zh-TW": "名稱", "zh-CN": "名称", en: "Name" });
$("l-date").textContent = t({ "zh-TW": "日期", "zh-CN": "日期", en: "Date" });
$("cancel").textContent = t({ "zh-TW": "取消", "zh-CN": "取消", en: "Cancel" });
$("save").textContent = t({ "zh-TW": "開始倒數", "zh-CN": "开始倒数", en: "Start" });

const DAY = 864e5;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parse = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function render() {
  const target = parse(opts.date);
  $("view").hidden = !target;
  $("setup").hidden = !!target;
  if (!target) { openSetup(false); return; }

  const today = midnight(new Date());
  const diff = Math.round((target - today) / DAY);
  $("title").textContent = opts.title || "";

  let num, unit;
  if (diff > 0) { num = diff; unit = t({ "zh-TW": "天後", "zh-CN": "天后", en: diff === 1 ? "day to go" : "days to go" }); }
  else if (diff === 0) { num = t({ "zh-TW": "今天", "zh-CN": "今天", en: "Today" }); unit = ""; }
  else { num = -diff; unit = t({ "zh-TW": "天前", "zh-CN": "天前", en: -diff === 1 ? "day ago" : "days ago" }); }
  $("num").textContent = num;
  $("unit").textContent = unit;

  const loc = widget.locale;
  $("meta").textContent = new Intl.DateTimeFormat(loc, { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(target);
  $("stamp").innerHTML = `${target.getMonth() + 1}.${String(target.getDate()).padStart(2, "0")}<small>${target.getFullYear()}</small>`;

  // Dots: one per day for short spans, otherwise 40 dots for the whole span.
  const from = start ? parse(start) : today;
  const total = Math.round((target - from) / DAY);
  if (diff > 0 && total > 0) {
    const count = total <= 60 ? total : 40;
    const gone = Math.round(((total - diff) / total) * count);
    $("dots").innerHTML = Array.from({ length: count }, (_, i) =>
      `<i class="${i < gone ? "on" : i === gone ? "now" : ""}"></i>`).join("");
    $("dots").style.gridTemplateColumns = `repeat(${Math.min(20, count)}, 1fr)`;
  } else $("dots").innerHTML = "";
}

function openSetup(focus = true) {
  $("view").hidden = true;
  $("setup").hidden = false;
  $("cancel").hidden = !parse(opts.date);
  $("f-title").value = opts.title || "";
  $("f-date").value = opts.date || "";
  if (focus) $("f-title").focus();
}

$("edit").onclick = () => openSetup();
$("cancel").onclick = render;
$("setup").onsubmit = async (e) => {
  e.preventDefault();
  const date = $("f-date").value;
  if (!date) return;
  if (date !== opts.date) { start = iso(midnight(new Date())); await widget.storage.set("start", start); }
  await widget.settings.set("title", $("f-title").value.trim());
  await widget.settings.set("date", date);
};

function scheduleMidnight() {
  const now = new Date();
  setTimeout(() => { render(); scheduleMidnight(); }, midnight(new Date(+now + DAY)) - now + 5000);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
widget.storage.get("start").then((v) => { start = v || null; render(); });
scheduleMidnight();
