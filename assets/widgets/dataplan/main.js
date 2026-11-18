const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

// The host only gives cumulative adapter counters, so the month's total is built
// by sampling: every reading adds the growth since the previous one.
let rec = { key: "", down: 0, up: 0, baseDown: null, baseUp: null, savedAt: 0 };
let lastData = null;
let stop = null;

const GB = 1024 ** 3;
const quotaGB = () => Math.max(0, Number(widget.settings.get("quota")) || 0);
const resetDay = () => Math.min(28, Math.max(1, Math.round(Number(widget.settings.get("resetDay")) || 1)));

function cycleStart(ms) {
  const d = new Date(ms);
  const day = resetDay();
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < day) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return new Date(y, m, day).getTime();
}
const cycleKey = (ms) => {
  const d = new Date(cycleStart(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const size = (bytes) => {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= GB) return `${(b / GB).toFixed(b >= 10 * GB ? 1 : 2)}`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${Math.round(b)} B`;
};
const sizeWithUnit = (bytes) => (Number(bytes) || 0) >= GB ? `${size(bytes)} GB` : size(bytes);

function save() {
  rec.savedAt = Date.now();
  widget.storage.set("usage", rec).catch(() => {});
}

function render() {
  const now = Date.now();
  const key = cycleKey(now);
  if (rec.key !== key) {
    // a new billing cycle: keep the counters but start the month at zero
    rec = { key, down: 0, up: 0, baseDown: rec.baseDown, baseUp: rec.baseUp, savedAt: 0 };
    save();
  }

  const used = rec.down + rec.up;
  const quota = quotaGB() * GB;
  const elapsed = Math.max(1, Math.round((now - cycleStart(now)) / 86400000) + 1);

  $("used").textContent = (used / GB).toFixed(used >= 10 * GB ? 2 : 2);
  $("down").textContent = L(`下載 ${sizeWithUnit(rec.down)}`, `下载 ${sizeWithUnit(rec.down)}`, `Down ${sizeWithUnit(rec.down)}`);
  $("up").textContent = L(`上傳 ${sizeWithUnit(rec.up)}`, `上传 ${sizeWithUnit(rec.up)}`, `Up ${sizeWithUnit(rec.up)}`);

  if (quota > 0) {
    const pct = Math.min(100, (used / quota) * 100);
    $("fill").style.width = `${pct}%`;
    $("fill").classList.toggle("is-warn", pct >= 80);
    $("plan").textContent = `${quotaGB()} GB`;
    $("rest").textContent = used >= quota
      ? L("已用完", "已用完", "Over quota")
      : L(`剩 ${(quotaGB() - used / GB).toFixed(1)} GB`, `剩 ${(quotaGB() - used / GB).toFixed(1)} GB`, `${(quotaGB() - used / GB).toFixed(1)} GB left`);
    $("mark").hidden = false;
    $("mark").style.left = `${(80)}%`;
    $("mark").title = "80%";
  } else {
    $("fill").style.width = "0%";
    $("plan").textContent = L("未設配額", "未设配额", "No quota");
    $("rest").textContent = "";
    $("mark").hidden = true;
  }

  $("hint").textContent = lastData
    ? L(`帳期 ${elapsed} 天，日均 ${(used / GB / elapsed).toFixed(2)} GB`, `账期 ${elapsed} 天，日均 ${(used / GB / elapsed).toFixed(2)} GB`, `Day ${elapsed} of the cycle · ${(used / GB / elapsed).toFixed(2)} GB/day`)
    : L("等網卡資料…", "等网卡数据…", "Waiting for adapter counters…");
}

function apply(data) {
  const n = data && data.network;
  if (!n || !Number.isFinite(n.totalDown) || !Number.isFinite(n.totalUp)) return;
  lastData = n;

  const key = cycleKey(Date.now());
  if (rec.key !== key) render();

  if (rec.baseDown == null) {
    rec.baseDown = n.totalDown;
    rec.baseUp = n.totalUp;
  } else {
    let dd = n.totalDown - rec.baseDown;
    let du = n.totalUp - rec.baseUp;
    // a drop means the adapter counters restarted (reboot, driver reload): re-base quietly
    if (dd < 0) dd = 0;
    if (du < 0) du = 0;
    rec.down += dd;
    rec.up += du;
    rec.baseDown = n.totalDown;
    rec.baseUp = n.totalUp;
  }

  render();
  if (Date.now() - rec.savedAt > 15000) save();
}

$("title").textContent = L("流量月帳", "流量月账", "Data plan");
widget.settings.onChange(render);

try {
  stop = widget.system.subscribe(["network"], apply, { interval: 2000 });
} catch (e) {
  widget.log(`dataplan: subscribe ${e.message}`);
}

widget.on("unload", () => {
  save();
  if (stop) stop();
});
widget.on("summon", render);

widget.storage.get("usage").then((v) => {
  if (v && typeof v === "object") {
    rec = {
      key: String(v.key || cycleKey(Date.now())),
      down: Math.max(0, Number(v.down) || 0),
      up: Math.max(0, Number(v.up) || 0),
      baseDown: Number.isFinite(v.baseDown) ? Number(v.baseDown) : null,
      baseUp: Number.isFinite(v.baseUp) ? Number(v.baseUp) : null,
      savedAt: 0,
    };
    // totals kept from a previous run only mean something inside the same cycle
    if (rec.key !== cycleKey(Date.now())) rec = { key: cycleKey(Date.now()), down: 0, up: 0, baseDown: null, baseUp: null, savedAt: 0 };
  } else {
    rec.key = cycleKey(Date.now());
  }
  render();
}).catch((e) => widget.log(`dataplan: load ${e.message}`));

render();
