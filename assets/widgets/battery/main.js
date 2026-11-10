const $ = (id) => document.getElementById(id);
const t = widget.t;
let b = null;

function duration(sec) {
  const m = Math.round(sec / 60), h = Math.floor(m / 60);
  if (h) return t({ "zh-TW": `${h} 小時 ${m % 60} 分`, "zh-CN": `${h} 小时 ${m % 60} 分`, en: `${h} h ${m % 60} min` });
  return t({ "zh-TW": `${m} 分鐘`, "zh-CN": `${m} 分钟`, en: `${m} min` });
}

/** The battery as a drawing: ten cells in the instrument theme, a solid fill otherwise. */
function draw(pct, charging) {
  const theme = widget.theme;
  const body = `<rect class="body" x="1" y="1" width="56" height="28" rx="5"/><rect class="nub" x="58.5" y="10" width="4" height="10" rx="1.5"/>`;
  let fill = "";
  if (pct != null) {
    if (theme !== "paper" && theme !== "type") {
      for (let i = 0; i < 10; i++) {
        const f = Math.max(0, Math.min(1, pct / 10 - i));
        fill += `<rect class="seg${f > 0 ? " on" : ""}" x="${4 + i * 5}" y="4" width="4" height="22" rx="1" style="opacity:${f > 0 ? 0.35 + 0.65 * f : 1}"/>`;
      }
    } else fill = `<rect class="fill" x="4" y="4" width="${(50 * pct / 100).toFixed(1)}" height="22" rx="2.5"/>`;
  }
  const bolt = charging ? `<path class="bolt" d="M31 5 22 17h7l-3 9 10-13h-7z"/>` : "";
  $("cell").innerHTML = body + fill + bolt;
}

function render() {
  if (!b) return;
  const has = b.present && b.percent != null;
  const low = has && !b.pluggedIn && b.percent <= 20;
  document.body.classList.toggle("none", !b.present);
  document.body.classList.toggle("low", low);
  document.body.classList.toggle("critical", has && !b.pluggedIn && b.percent <= 10);
  document.body.classList.toggle("charging", !!b.charging);

  if (!b.present) {
    draw(null, false);
    $("pct").textContent = "—";
    $("state").textContent = t({ "zh-TW": "這台電腦沒有電池", "zh-CN": "这台电脑没有电池", en: "No battery" });
    $("left").textContent = t({ "zh-TW": "使用電源供電", "zh-CN": "使用电源供电", en: "Running on mains power" });
    return;
  }
  draw(b.percent, b.charging);
  $("pct").innerHTML = `${b.percent}<small>%</small>`;
  let state;
  if (b.charging) state = t({ "zh-TW": "充電中", "zh-CN": "充电中", en: "Charging" });
  else if (b.pluggedIn) state = b.percent >= 95 ? t({ "zh-TW": "已充滿", "zh-CN": "已充满", en: "Fully charged" })
    : t({ "zh-TW": "已接上電源", "zh-CN": "已接通电源", en: "Plugged in" });
  else state = t({ "zh-TW": "使用電池", "zh-CN": "使用电池", en: "On battery" });
  $("state").textContent = state;
  const notes = [];
  if (!b.pluggedIn && b.secondsLeft) notes.push(t({ "zh-TW": `還能用 ${duration(b.secondsLeft)}`, "zh-CN": `还能用 ${duration(b.secondsLeft)}`, en: `${duration(b.secondsLeft)} left` }));
  if (b.saver) notes.push(t({ "zh-TW": "省電模式", "zh-CN": "节电模式", en: "Battery saver" }));
  $("left").textContent = notes.join(" · ");
}

widget.system.subscribe("battery", (d) => { b = d.battery; render(); }, { interval: 5000 });
widget.appearance.onChange(render);
