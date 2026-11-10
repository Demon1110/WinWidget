const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();
const HOUR = 36e5, DAY = 864e5;

const LABELS = {
  day: { "zh-TW": "今天", "zh-CN": "今天", en: "Today" },
  week: { "zh-TW": "本週", "zh-CN": "本周", en: "This week" },
  month: { "zh-TW": "本月", "zh-CN": "本月", en: "This month" },
  year: { "zh-TW": "今年", "zh-CN": "今年", en: "This year" },
};

/** Start and end of each span around `now`, and how many cells to draw it with. */
function spans(now) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const back = (now.getDay() - (opts.weekStart === "sunday" ? 0 : 1) + 7) % 7;
  return {
    day: { from: new Date(y, m, d), to: new Date(y, m, d + 1), cells: 24 },
    week: { from: new Date(y, m, d - back), to: new Date(y, m, d - back + 7), cells: 7 },
    month: { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), cells: new Date(y, m + 1, 0).getDate() },
    year: { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), cells: 12 },
  };
}

function left(key, ms) {
  if (key === "day" || ms < DAY) {
    const h = Math.floor(ms / HOUR);
    if (h >= 1) return t({ "zh-TW": `還剩 ${h} 小時`, "zh-CN": `还剩 ${h} 小时`, en: `${h} h left` });
    const min = Math.max(1, Math.ceil(ms / 6e4));
    return t({ "zh-TW": `還剩 ${min} 分鐘`, "zh-CN": `还剩 ${min} 分钟`, en: `${min} min left` });
  }
  const n = Math.floor(ms / DAY);
  return t({ "zh-TW": `還剩 ${n} 天`, "zh-CN": `还剩 ${n} 天`, en: n === 1 ? "1 day left" : `${n} days left` });
}

/** Cells for the instrument theme: past ones full, the current one filled as far as it has got. */
function cells(n, frac) {
  const done = frac * n;
  let html = "";
  for (let i = 0; i < n; i++) {
    const f = Math.max(0, Math.min(1, done - i));
    html += `<i class="${f >= 1 ? "full" : f > 0 ? "now" : ""}" style="--f:${f.toFixed(3)}"></i>`;
  }
  return html;
}

function render() {
  const now = new Date();
  const all = spans(now);
  const keys = ["day", "week", "month", "year"].filter((k) => opts[k] !== false);
  const rows = keys.map((k) => {
    const s = all[k];
    const frac = Math.min(1, Math.max(0, (now - s.from) / (s.to - s.from)));
    return { k, s, frac, pct: Math.floor(frac * 100), left: left(k, s.to - now) };
  });

  // 玻璃上的字: the longest span shown (usually the year) is the one big number
  const hero = rows[rows.length - 1];
  $("hero").innerHTML = hero ? `<span class="big w-display">${(hero.frac * 100).toFixed(1)}<small>%</small></span>
    <span class="cap">${hero.k === "year"
      ? t({ "zh-TW": `${now.getFullYear()} 年已經過了`, "zh-CN": `${now.getFullYear()} 年已经过了`, en: `of ${now.getFullYear()} has gone` })
      : t(LABELS[hero.k])} · ${hero.left}</span>` : "";

  $("rows").style.setProperty("--n", rows.length);
  $("rows").innerHTML = rows.map((r) => `<li class="row ${r.k}${r === hero ? " is-hero" : ""}">
      <span class="lab">${t(LABELS[r.k])}</span>
      <span class="left">${r.left}</span>
      <span class="pct w-num">${r.pct}<small>%</small></span>
      <span class="cells" style="--cells:${r.s.cells}">${cells(r.s.cells, r.frac)}</span>
      <span class="w-bar bar"><i style="width:${(r.frac * 100).toFixed(2)}%"></i></span>
    </li>`).join("");
}

function schedule() {
  render();
  setTimeout(schedule, 60000 - (Date.now() % 60000) + 50);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
schedule();
