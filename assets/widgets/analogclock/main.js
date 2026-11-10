const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();

const ZONES = {
  "Asia/Taipei": { "zh-TW": "台北", "zh-CN": "台北", en: "Taipei" },
  "Asia/Shanghai": { "zh-TW": "上海", "zh-CN": "上海", en: "Shanghai" },
  "Asia/Hong_Kong": { "zh-TW": "香港", "zh-CN": "香港", en: "Hong Kong" },
  "Asia/Tokyo": { "zh-TW": "東京", "zh-CN": "东京", en: "Tokyo" },
  "Asia/Singapore": { "zh-TW": "新加坡", "zh-CN": "新加坡", en: "Singapore" },
  "Europe/London": { "zh-TW": "倫敦", "zh-CN": "伦敦", en: "London" },
  "Europe/Paris": { "zh-TW": "巴黎", "zh-CN": "巴黎", en: "Paris" },
  "America/New_York": { "zh-TW": "紐約", "zh-CN": "纽约", en: "New York" },
  "America/Los_Angeles": { "zh-TW": "洛杉磯", "zh-CN": "洛杉矶", en: "Los Angeles" },
  "Australia/Sydney": { "zh-TW": "雪梨", "zh-CN": "悉尼", en: "Sydney" },
};
const zone = () => (opts.timezone && opts.timezone !== "local" ? opts.timezone : undefined);

/** Wall-clock parts in the chosen time zone. */
function partsNow() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone(), hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const wall = new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { h: +p.hour, m: +p.minute, s: +p.second, wall };
}

// Angles are clockwise from 12 o'clock.
const at = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
const n2 = (v) => +v.toFixed(2);

function line(r1, r2, deg, cls) {
  const [x1, y1] = at(r1, deg), [x2, y2] = at(r2, deg);
  return `<line class="${cls}" x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"/>`;
}

function numerals(r) {
  const hours = opts.numerals === "all" ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : opts.numerals === "quarters" ? [12, 3, 6, 9] : [];
  return `<g class="nums">${hours.map((h) => { const [x, y] = at(r, h * 30); return `<text x="${n2(x)}" y="${n2(y)}">${h}</text>`; }).join("")}</g>`;
}

/** The dial and the hands for the current theme. */
function build() {
  const theme = widget.theme;
  const shown = opts.numerals === "all" ? () => true : opts.numerals === "quarters" ? (i) => i % 3 === 0 : () => false;
  let face = "";
  let hour, minute, second;

  if (theme === "type") {
    // twelve points, the quarters a little brighter; numerals take a point's place
    for (let i = 0; i < 12; i++) {
      if (shown(i)) continue;
      const [x, y] = at(86, i * 30);
      face += `<circle class="dot${i % 3 === 0 ? " q" : ""}" cx="${n2(x)}" cy="${n2(y)}" r="${i % 3 === 0 ? 3.2 : 2}"/>`;
    }
    face += numerals(82);
    face += `<text class="date" id="date" y="40"></text>`;
    hour = `<line x1="0" y1="0" x2="0" y2="-46"/>`;
    minute = `<line x1="0" y1="0" x2="0" y2="-72"/>`;
    second = `<line x1="0" y1="14" x2="0" y2="-84"/>`;
  } else if (theme === "paper") {
    // a printed dial: rim, a railway minute track, serif numerals, a date window in seal ink
    face += `<circle class="rim" r="93"/><circle class="rail" r="87"/><circle class="rail" r="81"/>`;
    for (let i = 0; i < 60; i++) face += i % 5 === 0 ? line(77, 87, i * 6, "tk h") : line(81, 87, i * 6, "tk");
    face += numerals(64);
    face += `<g class="seal" id="seal" transform="translate(0 42)"><rect x="-13" y="-9.5" width="26" height="19" rx="1.5"/><text id="date"></text></g>`;
    hour = `<path d="M-3.4 10 L-2.3 -38 L0 -47 L2.3 -38 L3.4 10 Z"/>`;
    minute = `<path d="M-2.6 13 L-1.6 -64 L0 -74 L1.6 -64 L2.6 13 Z"/>`;
    second = `<line x1="0" y1="20" x2="0" y2="-80"/><circle cy="15" r="3.4"/>`;
  } else {
    // instrument: a track whose arc fills with the minutes of this hour
    face += `<circle class="track" r="91" stroke-width="3"/><path class="progress" id="progress" stroke-width="3"/>`;
    for (let i = 0; i < 60; i++) face += i % 5 === 0 ? line(72, 82, i * 6, "tk h") : line(77, 82, i * 6, "tk");
    face += numerals(60);
    face += `<text class="date" id="date" y="38"></text>`;
    hour = `<line x1="0" y1="9" x2="0" y2="-44"/>`;
    minute = `<line x1="0" y1="11" x2="0" y2="-68"/>`;
    second = `<line x1="0" y1="16" x2="0" y2="-80"/>`;
  }
  if (zone()) face += `<text class="zone" y="${theme === "paper" ? -38 : -36}">${ZONES[zone()] ? t(ZONES[zone()]) : zone()}</text>`;

  $("face").innerHTML = face;
  $("hour").innerHTML = hour;
  $("minute").innerHTML = minute;
  $("second").innerHTML = second;
  $("second").style.display = opts.showSeconds ? "" : "none";
  $("cap").innerHTML = `<circle class="c1" r="${theme === "type" ? 3.6 : 4.6}"/>` +
    (opts.showSeconds ? `<circle class="c2" r="${theme === "type" ? 1.6 : 2}"/>` : "");
  secAngle = null;
  render();
}

let secAngle = null; // keeps growing so the second hand never sweeps backwards at :00

function arc(r, deg) {
  if (deg <= 0) return "";
  if (deg >= 359.9) return `M0 ${-r} A${r} ${r} 0 1 1 0 ${r} A${r} ${r} 0 1 1 0 ${-r}`;
  const [x, y] = at(r, deg);
  return `M0 ${-r} A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${n2(x)} ${n2(y)}`;
}

function render() {
  const { h, m, s, wall } = partsNow();
  const sec = opts.showSeconds ? s : 0;
  $("hour").style.transform = `rotate(${(h % 12) * 30 + m * 0.5 + sec / 120}deg)`;
  $("minute").style.transform = `rotate(${m * 6 + sec * 0.1}deg)`;

  if (opts.showSeconds) {
    const hand = $("second");
    let a = s * 6;
    if (secAngle == null) hand.classList.remove("tick");
    else { while (a < secAngle) a += 360; hand.classList.add("tick"); }
    secAngle = a;
    hand.style.transform = `rotate(${a}deg)`;
  }

  // the arc moves a minute at a time, so the dial repaints once a minute, not every second
  const p = $("progress"), d = arc(91, m * 6);
  if (p && p.getAttribute("d") !== d) p.setAttribute("d", d);

  const date = $("date");
  if (date) {
    const loc = widget.locale;
    const text = !opts.showDate ? ""
      : widget.theme === "paper" ? String(wall.getDate())
      : `${new Intl.DateTimeFormat(loc, { weekday: "short" }).format(wall)} ${wall.getDate()}`;
    if (date.textContent !== text) date.textContent = text;
    const seal = $("seal");
    if (seal) seal.style.display = opts.showDate ? "" : "none";
  }
}

// Tick on the second (or the minute without a second hand) so the hands never lag.
let timer = 0;
function schedule() {
  clearTimeout(timer);
  render();
  const now = Date.now();
  timer = setTimeout(schedule, opts.showSeconds ? 1000 - (now % 1000) + 5 : 60000 - (now % 60000) + 20);
}

widget.settings.onChange((s) => { opts = s; build(); schedule(); });
widget.appearance.onChange(build);
build();
schedule();
