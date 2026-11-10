const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
const MAX = 8;

// [id, IANA time zone, 繁體, 简体, English]
const CITIES = [
  ["taipei", "Asia/Taipei", "台北", "台北", "Taipei"],
  ["beijing", "Asia/Shanghai", "北京", "北京", "Beijing"],
  ["shanghai", "Asia/Shanghai", "上海", "上海", "Shanghai"],
  ["hongkong", "Asia/Hong_Kong", "香港", "香港", "Hong Kong"],
  ["macau", "Asia/Macau", "澳門", "澳门", "Macau"],
  ["tokyo", "Asia/Tokyo", "東京", "东京", "Tokyo"],
  ["seoul", "Asia/Seoul", "首爾", "首尔", "Seoul"],
  ["singapore", "Asia/Singapore", "新加坡", "新加坡", "Singapore"],
  ["kualalumpur", "Asia/Kuala_Lumpur", "吉隆坡", "吉隆坡", "Kuala Lumpur"],
  ["bangkok", "Asia/Bangkok", "曼谷", "曼谷", "Bangkok"],
  ["hanoi", "Asia/Ho_Chi_Minh", "河內", "河内", "Hanoi"],
  ["hochiminh", "Asia/Ho_Chi_Minh", "胡志明市", "胡志明市", "Ho Chi Minh City"],
  ["manila", "Asia/Manila", "馬尼拉", "马尼拉", "Manila"],
  ["jakarta", "Asia/Jakarta", "雅加達", "雅加达", "Jakarta"],
  ["delhi", "Asia/Kolkata", "新德里", "新德里", "New Delhi"],
  ["mumbai", "Asia/Kolkata", "孟買", "孟买", "Mumbai"],
  ["kathmandu", "Asia/Kathmandu", "加德滿都", "加德满都", "Kathmandu"],
  ["dubai", "Asia/Dubai", "杜拜", "迪拜", "Dubai"],
  ["riyadh", "Asia/Riyadh", "利雅德", "利雅得", "Riyadh"],
  ["tehran", "Asia/Tehran", "德黑蘭", "德黑兰", "Tehran"],
  ["istanbul", "Europe/Istanbul", "伊斯坦堡", "伊斯坦布尔", "Istanbul"],
  ["moscow", "Europe/Moscow", "莫斯科", "莫斯科", "Moscow"],
  ["london", "Europe/London", "倫敦", "伦敦", "London"],
  ["dublin", "Europe/Dublin", "都柏林", "都柏林", "Dublin"],
  ["lisbon", "Europe/Lisbon", "里斯本", "里斯本", "Lisbon"],
  ["paris", "Europe/Paris", "巴黎", "巴黎", "Paris"],
  ["berlin", "Europe/Berlin", "柏林", "柏林", "Berlin"],
  ["amsterdam", "Europe/Amsterdam", "阿姆斯特丹", "阿姆斯特丹", "Amsterdam"],
  ["madrid", "Europe/Madrid", "馬德里", "马德里", "Madrid"],
  ["rome", "Europe/Rome", "羅馬", "罗马", "Rome"],
  ["zurich", "Europe/Zurich", "蘇黎世", "苏黎世", "Zurich"],
  ["vienna", "Europe/Vienna", "維也納", "维也纳", "Vienna"],
  ["stockholm", "Europe/Stockholm", "斯德哥爾摩", "斯德哥尔摩", "Stockholm"],
  ["athens", "Europe/Athens", "雅典", "雅典", "Athens"],
  ["cairo", "Africa/Cairo", "開羅", "开罗", "Cairo"],
  ["johannesburg", "Africa/Johannesburg", "約翰尼斯堡", "约翰内斯堡", "Johannesburg"],
  ["nairobi", "Africa/Nairobi", "奈洛比", "内罗毕", "Nairobi"],
  ["newyork", "America/New_York", "紐約", "纽约", "New York"],
  ["toronto", "America/Toronto", "多倫多", "多伦多", "Toronto"],
  ["chicago", "America/Chicago", "芝加哥", "芝加哥", "Chicago"],
  ["denver", "America/Denver", "丹佛", "丹佛", "Denver"],
  ["losangeles", "America/Los_Angeles", "洛杉磯", "洛杉矶", "Los Angeles"],
  ["sanfrancisco", "America/Los_Angeles", "舊金山", "旧金山", "San Francisco"],
  ["seattle", "America/Los_Angeles", "西雅圖", "西雅图", "Seattle"],
  ["vancouver", "America/Vancouver", "溫哥華", "温哥华", "Vancouver"],
  ["mexicocity", "America/Mexico_City", "墨西哥城", "墨西哥城", "Mexico City"],
  ["saopaulo", "America/Sao_Paulo", "聖保羅", "圣保罗", "São Paulo"],
  ["buenosaires", "America/Argentina/Buenos_Aires", "布宜諾斯艾利斯", "布宜诺斯艾利斯", "Buenos Aires"],
  ["honolulu", "Pacific/Honolulu", "檀香山", "檀香山", "Honolulu"],
  ["anchorage", "America/Anchorage", "安克拉治", "安克雷奇", "Anchorage"],
  ["sydney", "Australia/Sydney", "雪梨", "悉尼", "Sydney"],
  ["melbourne", "Australia/Melbourne", "墨爾本", "墨尔本", "Melbourne"],
  ["brisbane", "Australia/Brisbane", "布里斯本", "布里斯班", "Brisbane"],
  ["perth", "Australia/Perth", "伯斯", "珀斯", "Perth"],
  ["auckland", "Pacific/Auckland", "奧克蘭", "奥克兰", "Auckland"],
  ["utc", "UTC", "UTC", "UTC", "UTC"],
].map(([id, zone, tw, cn, en]) => ({ id, zone, name: { "zh-TW": tw, "zh-CN": cn, en } }));

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCAL = { id: "local", zone: localZone, name: { "zh-TW": "本地", "zh-CN": "本地", en: "Local" } };
const byId = (id) => (id === "local" ? LOCAL : CITIES.find((c) => c.id === id));

let list = []; // city ids, in order

/** First the PC's own city, then a few far-away ones. */
function defaults() {
  const zh = /^zh/i.test(widget.locale), hans = /^zh-(cn|sg|hans)/i.test(widget.locale);
  const prefer = hans ? "beijing" : zh ? "taipei" : null;
  const here = CITIES.filter((c) => c.zone === localZone);
  const home = here.find((c) => c.id === prefer) || here[0];
  const out = [home ? home.id : "local"];
  for (const id of ["tokyo", "london", "newyork", "sydney"]) {
    if (out.length >= 4) break;
    if (byId(id).zone !== localZone) out.push(id);
  }
  return out;
}

/** Wall-clock fields in a time zone. */
function partsIn(zone, now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const stamp = (p) => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) / 60000;

function diffText(min) {
  if (min === 0) return t({ "zh-TW": "同一時間", "zh-CN": "同一时间", en: "Same time" });
  const h = Math.abs(min) / 60;
  const n = Number.isInteger(h) ? String(h) : `${Math.floor(h)}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
  const sign = min > 0 ? "+" : "−";
  return t({ "zh-TW": `${sign}${n} 小時`, "zh-CN": `${sign}${n} 小时`, en: `${sign}${n} h` });
}

function dayText(days) {
  if (days === 0) return "";
  if (days === 1) return t({ "zh-TW": "明天", "zh-CN": "明天", en: "Tomorrow" });
  if (days === -1) return t({ "zh-TW": "昨天", "zh-CN": "昨天", en: "Yesterday" });
  return "";
}

const SUN = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>`;
const MOON = `<svg viewBox="0 0 16 16"><path d="M12.8 10.4A5.5 5.5 0 0 1 5.6 3.2a5.5 5.5 0 1 0 7.2 7.2z"/></svg>`;

function render() {
  const now = new Date();
  const here = partsIn(localZone, now);
  const ul = $("cities");
  ul.style.setProperty("--n", list.length);
  ul.innerHTML = list.map(byId).filter(Boolean).map((c) => {
    const p = partsIn(c.zone, now);
    const diff = Math.round((stamp(p) - stamp(here)) / 15) * 15;
    const days = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(here.y, here.mo - 1, here.d)) / 864e5);
    const day = p.h >= 6 && p.h < 18;
    const hh = opts.use24h ? String(p.h).padStart(2, "0") : String(p.h % 12 || 12);
    const ampm = opts.use24h ? "" : `<small>${p.h < 12 ? t({ zh: "上午", en: "AM" }) : t({ zh: "下午", en: "PM" })}</small>`;
    const rel = (days && dayText(days) ? `<span class="dd">${esc(dayText(days))}</span>` : "") +
      (opts.showDiff ? `<span class="df">${esc(diffText(diff))}</span>` : "");
    const pos = ((p.h * 60 + p.mi) / 1440) * 100;
    return `<li class="city${day ? " day" : " night"}${days ? " other-day" : ""}">
      <span class="sky">${day ? SUN : MOON}</span>
      <span class="nm">${esc(t(c.name))}</span>
      <span class="rel">${rel}</span>
      <span class="tm w-num">${hh}:${String(p.mi).padStart(2, "0")}${ampm}</span>
      <span class="track"><i class="lit"></i><i class="now" style="left:${pos.toFixed(2)}%"></i></span>
    </li>`;
  }).join("");
}

// ── editing the list, inside the widget ──
function openSetup() {
  $("view").hidden = true;
  $("setup").hidden = false;
  renderPicked();
  $("find").value = "";
  $("found").hidden = true;
  $("find").focus();
}

function renderPicked() {
  $("picked").innerHTML = list.map((id, i) => `<li><span>${esc(t(byId(id).name))}</span>
    <button class="w-btn x" data-i="${i}" data-no-drag aria-label="${esc(t({ "zh-TW": "移除", "zh-CN": "移除", en: "Remove" }))}">×</button></li>`).join("");
  $("find").disabled = list.length >= MAX;
  $("find").placeholder = list.length >= MAX
    ? t({ "zh-TW": `最多 ${MAX} 個城市`, "zh-CN": `最多 ${MAX} 个城市`, en: `Up to ${MAX} cities` })
    : t({ "zh-TW": "加入城市，例如 東京", "zh-CN": "添加城市，例如 东京", en: "Add a city, e.g. Tokyo" });
}

function matches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return CITIES.filter((c) => !list.includes(c.id) &&
    (Object.values(c.name).some((n) => n.toLowerCase().includes(q)) || c.zone.toLowerCase().includes(q))).slice(0, 6);
}

function showFound() {
  const found = matches($("find").value);
  $("found").hidden = !found.length;
  $("found").innerHTML = found.map((c, i) => `<li><button class="${i ? "" : "first"}" data-id="${c.id}" data-no-drag>
    <span>${esc(t(c.name))}</span><small>${esc(c.zone.replace(/_/g, " "))}</small></button></li>`).join("");
}

async function save() {
  await widget.storage.set("cities", list);
  render();
}

function add(id) {
  if (!id || list.includes(id) || list.length >= MAX) return;
  list.push(id);
  save();
  renderPicked();
  $("find").value = "";
  $("found").hidden = true;
  $("find").focus();
}

$("edit").textContent = t({ "zh-TW": "編輯", "zh-CN": "编辑", en: "Edit" });
$("setup-title").textContent = t({ "zh-TW": "城市", "zh-CN": "城市", en: "Cities" });
$("done").textContent = t({ "zh-TW": "完成", "zh-CN": "完成", en: "Done" });
$("edit").onclick = openSetup;
$("done").onclick = () => { $("setup").hidden = true; $("view").hidden = false; render(); };
$("picked").onclick = (e) => {
  const b = e.target.closest("button.x");
  if (!b || list.length <= 1) return;
  list.splice(+b.dataset.i, 1);
  save();
  renderPicked();
};
$("find").oninput = showFound;
$("find").onkeydown = (e) => {
  if (e.key === "Enter") { e.preventDefault(); const f = matches($("find").value)[0]; if (f) add(f.id); }
  if (e.key === "Escape") $("done").click();
};
$("found").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) add(b.dataset.id); };

function schedule() {
  render();
  setTimeout(schedule, 60000 - (Date.now() % 60000) + 50);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
widget.storage.get("cities").then((saved) => {
  list = Array.isArray(saved) && saved.some(byId) ? saved.filter(byId).slice(0, MAX) : defaults();
  schedule();
});
