const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let batt = null;              // last BatteryInfo
let latched = false;          // already notified in this charge cycle
let stop = null;

const target = () => Math.max(50, Math.round(Number(widget.settings.get("target")) || 80));
const wantsNotify = () => widget.settings.get("remind") !== false;

function render() {
  const on = wantsNotify();
  $("sw").setAttribute("aria-pressed", on ? "true" : "false");
  $("tick").style.left = `${target()}%`;
  $("tick").title = L(`目標 ${target()}%`, `目标 ${target()}%`, `Target ${target()}%`);

  if (!batt || batt.present === false || batt.percent == null) {
    $("pct").textContent = "--";
    $("state").textContent = L("沒有電池", "没有电池", "No battery");
    $("cap").textContent = "";
    $("fill").style.width = "0%";
    $("left").textContent = L("桌機沒有電池資訊", "台式机没有电池信息", "Desktops report no battery");
    $("right").textContent = "";
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round(batt.percent)));
  $("pct").textContent = `${pct}%`;
  $("fill").style.width = `${pct}%`;
  $("fill").classList.toggle("is-over", pct >= target());
  $("fill").classList.toggle("is-charging", !!batt.charging);

  $("state").textContent = batt.charging
    ? L("充電中", "充电中", "Charging")
    : batt.pluggedIn
      ? L("已插電", "已插电", "Plugged in")
      : L("使用電池", "使用电池", "On battery");

  $("cap").textContent = batt.charging ? L("正在充", "正在充", "to go") : "";

  const diff = target() - pct;
  if (batt.charging) {
    $("left").textContent = diff > 0
      ? L(`還差 ${diff}% 到 ${target()}%`, `还差 ${diff}% 到 ${target()}%`, `${diff}% to ${target()}%`)
      : L(`已超過目標 ${pct - target()}%`, `已超过目标 ${pct - target()}%`, `${pct - target()}% past target`);
  } else {
    $("left").textContent = L("沒在充電，先插上吧", "没在充电，先插上吧", "Not charging — plug in first");
  }

  const secs = batt.secondsLeft;
  $("right").textContent = !batt.charging && Number.isFinite(secs) && secs > 0
    ? L(`剩 ${Math.floor(secs / 3600)} 小時 ${Math.round((secs % 3600) / 60)} 分`, `剩 ${Math.floor(secs / 3600)} 小时 ${Math.round((secs % 3600) / 60)} 分`, `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m left`)
    : "";
}

function maybeNotify() {
  if (!batt || !batt.present || batt.percent == null) return;
  const pct = Math.round(batt.percent);
  if (!batt.charging) {
    latched = false;                       // unplugged: re-arm for the next cycle
    return;
  }
  if (latched || !wantsNotify()) return;
  if (pct < target()) return;
  latched = true;
  widget.notify({
    title: L("可以拔線了", "可以拔线了", "Time to unplug"),
    body: L(`電量 ${pct}%，已到你設定的 ${target()}%`, `电量 ${pct}%，已到你设定的 ${target()}%`, `${pct}% reached your ${target()}% target`),
    tag: "chargeguard",
  }).catch((e) => widget.log(`chargeguard: notify ${e.message}`));
}

function apply(data) {
  const b = data && data.battery;
  if (!b) return;
  batt = b;
  render();
  maybeNotify();
}

$("title").textContent = L("充電守衛", "充电守卫", "Charge guard");
$("swLbl").textContent = L("到目標時提醒", "到目标时提醒", "Nudge at target");

$("sw").onclick = () => {
  const next = !wantsNotify();
  widget.settings.set("remind", next).catch(() => {});
  render();
};

widget.settings.onChange(render);

// battery only comes from the subscription stream
try {
  stop = widget.system.subscribe(["battery"], apply, { interval: 2000 });
} catch (e) {
  widget.log(`chargeguard: subscribe ${e.message}`);
}

render();
widget.on("summon", () => { if (stop) { stop(); stop = widget.system.subscribe(["battery"], apply, { interval: 2000 }); } });
widget.on("unload", () => { if (stop) stop(); });

widget.storage.get("latch").then((v) => {
  latched = v === true;
}).catch(() => {});
