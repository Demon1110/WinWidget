// 萬年曆 — a month calendar you can browse, with the Chinese almanac behind it.
//
// Everything is worked out on the machine, nothing is fetched: the lunar date comes from the
// browser's Chinese calendar (Intl), the solar terms from the sun's apparent longitude, and the
// day's 干支 from the continuous sixty-day cycle. The almanac line (建除十二神, 宜, 忌, 沖煞) is
// the traditional 建除 reading of that day — a common, well-defined rule, not a full 通書.

const $ = (id) => document.getElementById(id);
const DAY_MS = 86400000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";

const zh = widget.locale.toLowerCase().startsWith("zh");
const hans = /^zh-(cn|sg|hans|mo)/i.test(widget.locale);
/** The text for the user's script: simplified for zh-CN/zh-SG, traditional otherwise, English for the rest. */
const p = (cn, tw) => (!zh ? cn : hans ? cn : tw);
const t = (cn, tw, en) => (zh ? p(cn, tw) : en);

let opts = widget.settings.get();

// ── dates ───────────────────────────────────────────────────────────
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
};
// Zero-padded, so these keys can be compared as strings (a term on 11-7 must sort before 11-13).
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const sameDay = (a, b) => keyOf(a) === keyOf(b);
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);

// ── 節氣: the sun's apparent longitude, every 15° ────────────────────
const TERM_CN = ["春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露",
  "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰"];
const TERM_TW = ["春分", "清明", "穀雨", "立夏", "小滿", "芒種", "夏至", "小暑", "大暑", "立秋", "處暑", "白露",
  "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "驚蟄"];
/** 節 (the odd ones) start a new 節氣月; the even ones are 中氣. */
const termName = (i) => p(TERM_CN[i], TERM_TW[i]);

const RAD = Math.PI / 180;
function sunLon(ms) {
  const t = (ms / DAY_MS + 2440587.5 - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const M = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * RAD;
  const C = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(M)
    + (0.019993 - 0.000101 * t) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * t) * RAD;
  return (((L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) % 360) + 360) % 360;
}

/** The moment the sun reaches `angle`, by Newton's method on the longitude above (UTC ms). */
function termTime(year, angle) {
  let guess = Date.UTC(year, 0, 1);
  guess += (((angle - sunLon(guess)) + 360) % 360) / 0.98564736 * DAY_MS;
  for (let i = 0; i < 6; i++) {
    const diff = ((angle - sunLon(guess) + 540) % 360) - 180;
    guess += diff / 0.98564736 * DAY_MS;
  }
  return guess;
}

const termsByYear = new Map();
/** The 24 terms of that Gregorian year as { i, key } — key is the Beijing date (y-m-d). */
function terms(year) {
  let hit = termsByYear.get(year);
  if (hit) return hit;
  hit = [];
  for (let i = 0; i < 24; i++) {
    const bj = new Date(termTime(year, i * 15) + 8 * 3600000);
    hit.push({ i, key: `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}` });
  }
  termsByYear.set(year, hit);
  return hit;
}

/** The solar term standing on that date, if any. */
function termOn(d) {
  const key = keyOf(d);
  for (const want of [d.getFullYear() - 1, d.getFullYear()]) {
    const hit = terms(want).find((x) => x.key === key);
    if (hit) return termName(hit.i);
  }
  return null;
}

/** The last 節 at or before that date: what starts the 節氣月 it falls in. */
function lastJie(d) {
  const key = keyOf(d);
  let best = null;
  for (const year of [d.getFullYear() - 1, d.getFullYear()]) {
    for (const x of terms(year)) {
      if (x.i % 2 === 0) continue; // 中氣, not 節
      if (x.key <= key && (!best || x.key >= best.key)) best = x;
    }
  }
  return best; // always found: 大雪 of last year is more than a year back
}

// ── 農曆 (the browser's Chinese calendar) ────────────────────────────
const LUNAR_DAYS = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
const MONTH_NUM = {
  正月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6, 七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 腊月: 12, 臘月: 12,
};

const lunarFmt = zh ? new Intl.DateTimeFormat(hans ? "zh-CN-u-ca-chinese" : "zh-TW-u-ca-chinese",
  { year: "numeric", month: "long", day: "numeric" }) : null;
const lunarCache = new Map();

/** { text: "十月", day: "初五", n: 5, m: 10, leap: false, yearGZ: "丙午" } */
function lunarOf(d) {
  if (!lunarFmt) return null;
  const key = keyOf(d);
  const hit = lunarCache.get(key);
  if (hit) return hit;
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const parts = Object.fromEntries(lunarFmt.formatToParts(noon).map((x) => [x.type, x.value]));
  const text = parts.month || "";
  const leap = /^[闰閏]/.test(text);
  const bare = text.replace(/^[闰閏]/, "");
  const n = Number(parts.day);
  const info = {
    text,
    leap,
    month: bare,
    m: MONTH_NUM[bare] || 0,
    n,
    day: LUNAR_DAYS[n - 1] || String(n),
    yearGZ: parts.yearName || "",
  };
  lunarCache.set(key, info);
  return info;
}

// ── 干支, 建除, 沖煞 ────────────────────────────────────────────────
/** 立春 starts the 干支 year; before it the date still belongs to last year's. */
function solarYear(d) {
  const y = d.getFullYear();
  const lichun = terms(y)[21].key;
  return keyOf(d) < lichun ? y - 1 : y;
}

const gzYearName = (y) => {
  const i = (((y - 4) % 60) + 60) % 60;
  return GAN[i % 10] + ZHI[i % 12];
};

/** 月干支: the 節氣月's branch, then 五虎遁 from the year's 干. */
function gzMonth(d) {
  const jie = lastJie(d);
  const branch = (((jie.i + 1) / 2 + 3) % 12 + 12) % 12;
  const yearGan = GAN.indexOf(gzYearName(solarYear(d))[0]);
  const start = (yearGan * 2 + 2) % 10;
  const gan = (start + ((branch - 2 + 12) % 12)) % 10;
  return { gan, branch, text: GAN[gan] + ZHI[branch] };
}

/** 日干支: the same sixty-day cycle since 甲子, read off the Julian day number. */
function gzDay(d) {
  const jdn = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) + 2440588;
  const i = (((jdn + 49) % 60) + 60) % 60;
  return { i, text: GAN[i % 10] + ZHI[i % 12] };
}

const JIANCHU_CN = ["建", "除", "满", "平", "定", "执", "破", "危", "成", "收", "开", "闭"];
const JIANCHU_TW = ["建", "除", "滿", "平", "定", "執", "破", "危", "成", "收", "開", "閉"];
/** 除、定、執、危、成、開 are the 黃道 days; the other six are 黑道. */
const HUANG_DAO = new Set([1, 4, 5, 7, 8, 10]);

/** What each 建除 day traditionally allows and avoids. */
const YJ = [
  { yi: "出行 上任 祈福 求嗣 动土", yiT: "出行 上任 祈福 求嗣 動土", ji: "破土 安葬 开仓", jiT: "破土 安葬 開倉" },
  { yi: "扫舍 治病 解除 沐浴 整容", yiT: "掃舍 治病 解除 沐浴 整容", ji: "出行 嫁娶 开市", jiT: "出行 嫁娶 開市" },
  { yi: "祭祀 祈福 开市 交易 立券", yiT: "祭祀 祈福 開市 交易 立券", ji: "安葬 动土 服药", jiT: "安葬 動土 服藥" },
  { yi: "修饰 交易 平治道涂 出行", yiT: "修飾 交易 平治道塗 出行", ji: "开渠 动土 安葬", jiT: "開渠 動土 安葬" },
  { yi: "嫁娶 开市 交易 入学 签约", yiT: "嫁娶 開市 交易 入學 簽約", ji: "诉讼 出行 搬迁", jiT: "訴訟 出行 搬遷" },
  { yi: "修造 捕捉 纳财 收账", yiT: "修造 捕捉 納財 收帳", ji: "开市 出行 安葬", jiT: "開市 出行 安葬" },
  { yi: "求医 破屋 坏垣 拆卸", yiT: "求醫 破屋 壞垣 拆卸", ji: "嫁娶 开市 动土 出行", jiT: "嫁娶 開市 動土 出行" },
  { yi: "安床 祭祀 祈福 修造", yiT: "安床 祭祀 祈福 修造", ji: "登高 出行 动土", jiT: "登高 出行 動土" },
  { yi: "嫁娶 开市 入学 动土 安葬", yiT: "嫁娶 開市 入學 動土 安葬", ji: "诉讼 争执 破土", jiT: "訴訟 爭執 破土" },
  { yi: "纳财 收账 买田 修屋", yiT: "納財 收帳 買田 修屋", ji: "开市 出行 安葬", jiT: "開市 出行 安葬" },
  { yi: "开市 嫁娶 入学 动土 出行", yiT: "開市 嫁娶 入學 動土 出行", ji: "安葬 破土 诉讼", jiT: "安葬 破土 訴訟" },
  { yi: "安葬 修坟 筑堤 补垣", yiT: "安葬 修墳 築堤 補垣", ji: "开市 出行 嫁娶 求医", jiT: "開市 出行 嫁娶 求醫" },
];

const ZODIAC_CN = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const ZODIAC_TW = ["鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"];
/** 申子辰煞南, 寅午戌煞北, 亥卯未煞西, 巳酉丑煞東. */
const SHA_CN = ["南", "东", "北", "西"]; // by branch group: 子→0, 丑→1, 寅→2, 卯→3 …
const SHA_TW = ["南", "東", "北", "西"];

/** The almanac reading of one day. */
function almanac(d) {
  const monthBranch = gzMonth(d).branch;
  const day = gzDay(d);
  const dayBranch = day.i % 12;
  const jc = ((dayBranch - monthBranch) % 12 + 12) % 12;
  const chongBranch = (dayBranch + 6) % 12;
  const shaGroup = dayBranch % 4;
  return {
    day,
    dayBranch,
    monthBranch,
    jc,
    name: p(JIANCHU_CN[jc] + "日", JIANCHU_TW[jc] + "日"),
    huang: HUANG_DAO.has(jc),
    yi: p(YJ[jc].yi, YJ[jc].yiT).split(" "),
    ji: p(YJ[jc].ji, YJ[jc].jiT).split(" "),
    chong: p(ZODIAC_CN[chongBranch], ZODIAC_TW[chongBranch]),
    sha: p(SHA_CN[shaGroup], SHA_TW[shaGroup]),
  };
}

// ── 節日 ────────────────────────────────────────────────────────────
const SOLAR_FEST = {
  "1-1": ["元旦", "元旦"], "2-14": ["情人节", "情人節"], "3-8": ["妇女节", "婦女節"],
  "4-1": ["愚人节", "愚人節"], "5-1": ["劳动节", "勞動節"], "5-4": ["青年节", "青年節"],
  "6-1": ["儿童节", "兒童節"], "7-1": ["建党节", "建黨節"], "8-1": ["建军节", "建軍節"],
  "9-10": ["教师节", "教師節"], "10-1": ["国庆节", "國慶節"], "12-25": ["圣诞节", "聖誕節"],
};
const LUNAR_FEST = {
  "1-1": ["春节", "春節"], "1-15": ["元宵节", "元宵節"], "2-2": ["龙抬头", "龍抬頭"],
  "5-5": ["端午节", "端午節"], "7-7": ["七夕", "七夕"], "8-15": ["中秋节", "中秋節"],
  "9-9": ["重阳节", "重陽節"], "12-8": ["腊八节", "臘八節"],
};

function festivalOf(d, lun) {
  const key = `${d.getMonth() + 1}-${d.getDate()}`;
  const solar = SOLAR_FEST[key];
  if (solar) return p(solar[0], solar[1]);
  if (!lun || lun.leap) return null; // a leap month doesn't own the festival
  const lunar = LUNAR_FEST[`${lun.m}-${lun.n}`];
  if (lunar) return p(lunar[0], lunar[1]);
  // 除夕: the last day of 腊月, i.e. the day before 正月初一
  if (lun.m === 12) {
    const next = lunarOf(addDays(d, 1));
    if (next && next.m === 1 && next.n === 1) return p("除夕", "除夕");
  }
  return null;
}

// ── 每日一言 ────────────────────────────────────────────────────────
const QUOTES = [
  ["天行健，君子以自强不息。", "天行健，君子以自強不息。", "《周易》"],
  ["千里之行，始于足下。", "千里之行，始於足下。", "《老子》"],
  ["知人者智，自知者明。", "知人者智，自知者明。", "《老子》"],
  ["上善若水，水善利万物而不争。", "上善若水，水善利萬物而不爭。", "《老子》"],
  ["不积跬步，无以至千里。", "不積跬步，無以至千里。", "《荀子》"],
  ["锲而不舍，金石可镂。", "鍥而不捨，金石可鏤。", "《荀子》"],
  ["生于忧患，死于安乐。", "生於憂患，死於安樂。", "《孟子》"],
  ["静以修身，俭以养德。", "靜以修身，儉以養德。", "《诸葛亮》"],
  ["非淡泊无以明志，非宁静无以致远。", "非淡泊無以明志，非寧靜無以致遠。", "《诸葛亮》"],
  ["读书破万卷，下笔如有神。", "讀書破萬卷，下筆如有神。", "杜甫"],
  ["长风破浪会有时，直挂云帆济沧海。", "長風破浪會有時，直掛雲帆濟滄海。", "李白"],
  ["莫等闲，白了少年头，空悲切。", "莫等閒，白了少年頭，空悲切。", "岳飞"],
  ["山重水复疑无路，柳暗花明又一村。", "山重水複疑無路，柳暗花明又一村。", "陆游"],
  ["宝剑锋从磨砺出，梅花香自苦寒来。", "寶劍鋒從磨礪出，梅花香自苦寒來。", "古训"],
  ["海内存知己，天涯若比邻。", "海內存知己，天涯若比鄰。", "王勃"],
  ["业精于勤，荒于嬉。", "業精於勤，荒於嬉。", "韩愈"],
];
function quoteOf(d) {
  const i = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) % QUOTES.length;
  const q = QUOTES[i];
  return { text: p(q[0], q[1]), by: p(q[2], q[2]) };
}

// ── state ───────────────────────────────────────────────────────────
let today = startOfDay(new Date());
let selected = new Date(today);
let view = firstOfMonth(today);

const showLunar = () => zh && opts.showLunar !== false;
const showAlmanac = () => zh && opts.showAlmanac !== false;
const showQuote = () => zh && opts.showQuote !== false;

// ── the month ───────────────────────────────────────────────────────
function render() {
  today = startOfDay(new Date());
  const mondayFirst = opts.weekStart !== "sunday";
  const first = view;

  $("ym").textContent = zh
    ? `${first.getFullYear()}${p("年", "年")}${first.getMonth() + 1}${p("月", "月")}`
    : new Intl.DateTimeFormat(widget.locale, { year: "numeric", month: "long" }).format(first);
  $("ym").title = t("換一個月或年份", "換一個月或年份", "Jump to another month or year");
  $("prev").title = t("上一個月", "上一個月", "Previous month");
  $("next").title = t("下一個月", "下一個月", "Next month");
  $("go").textContent = t("今天", "今天", "Today");

  // weekday names, in the user's language, starting from the week's first day
  const names = [];
  const base = new Date(2024, 0, mondayFirst ? 1 : 7);
  for (let i = 0; i < 7; i++) {
    const d = addDays(base, i);
    const sun = d.getDay() === 0;
    names.push(`<span class="h${sun ? " sun" : ""}">${new Intl.DateTimeFormat(widget.locale, { weekday: "narrow" }).format(d)}</span>`);
  }
  $("week").innerHTML = names.join("");

  // always six weeks, so the grid keeps its height from month to month
  const offset = (first.getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
  const start = addDays(first, -offset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const lun = showLunar() ? lunarOf(d) : null;
    const fest = lun ? festivalOf(d, lun) : null;
    const term = lun ? termOn(d) : null;
    let text = "";
    let cls = "";
    if (fest) { text = fest; cls = " fest"; }
    else if (term) { text = term; cls = " term"; }
    else if (lun) text = lun.n === 1 ? lun.text : lun.day;
    const mods = [
      d.getMonth() !== first.getMonth() ? "out" : "",
      sameDay(d, today) ? "today" : "",
      sameDay(d, selected) ? "sel" : "",
      d.getDay() === 0 ? "sun" : "",
    ].filter(Boolean).join(" ");
    cells.push(`<div class="c ${mods}" data-k="${keyOf(d)}"><b>${d.getDate()}</b>${text ? `<small class="${cls.trim()}">${text}</small>` : ""}</div>`);
  }
  $("grid").innerHTML = cells.join("");
  renderFoot();
}

// ── the footer: the selected day at a glance ────────────────────────
function renderFoot() {
  const d = selected;
  const lun = showLunar() ? lunarOf(d) : null;
  const al = showAlmanac() ? almanac(d) : null;
  const diff = dayDiff(d, today);
  const away = diff === 0
    ? t("今天", "今天", "today")
    : diff < 0
      ? (zh ? `${-diff} ${p("天前", "天前")}` : `${-diff} ${-diff === 1 ? "day" : "days"} ago`)
      : (zh ? `${diff} ${p("天後", "天後")}` : `${diff} ${diff === 1 ? "day" : "days"} later`);

  const dateText = zh
    ? `${d.getMonth() + 1}${p("月", "月")}${d.getDate()}${p("日", "日")}`
    : new Intl.DateTimeFormat(widget.locale, { month: "long", day: "numeric" }).format(d);
  const weekday = new Intl.DateTimeFormat(widget.locale, { weekday: "long" }).format(d);
  const yearText = d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}` : "";

  const lunarLine = lun
    ? `${p("農曆", "農曆")}${lun.text}${lun.day} · ${lun.yearGZ || gzYearName(solarYear(d))}${p("年", "年")} ${p(ZODIAC_CN[(((solarYear(d) - 4) % 12) + 12) % 12], ZODIAC_TW[(((solarYear(d) - 4) % 12) + 12) % 12])}`
    + (al ? ` · ${al.name}` : "")
    : "";
  const yj = al
    ? `<span class="y">${p("宜", "宜")} ${al.yi.slice(0, 2).join(" ")}</span><span class="j">${p("忌", "忌")} ${al.ji.slice(0, 2).join(" ")}</span>`
    : "";
  const q = showQuote() ? quoteOf(d) : null;

  $("foot").innerHTML =
    `<span class="f-top"><span class="f-date">${yearText ? `${yearText}${p("年", "年")}` : ""}${dateText}</span>` +
    `<span class="f-wk">${weekday}</span><span class="f-away">${away}</span>` +
    `<span class="f-more">${t("詳情", "詳情", "Details")} ›</span></span>` +
    (lunarLine ? `<span class="f-lunar">${lunarLine}</span>` : "") +
    (yj ? `<span class="f-yj">${yj}</span>` : "") +
    (q ? `<span class="f-quote">「${q.text}」<i>${q.by}</i></span>` : "");
  $("foot").title = t("這一日的黃曆", "這一日的黃曆", "The almanac for this day");
}

// ── the hover card ──────────────────────────────────────────────────
const tip = $("tip");
function tipHtml(d) {
  const lun = showLunar() ? lunarOf(d) : null;
  const al = showAlmanac() ? almanac(d) : null;
  const gw = gzYearName(solarYear(d));
  const gz = gzMonth(d);
  const term = lun ? termOn(d) : null;
  const fest = lun ? festivalOf(d, lun) : null;
  const weekday = new Intl.DateTimeFormat(widget.locale, { weekday: "long" }).format(d);
  const head = zh
    ? `${d.getFullYear()}${p("年", "年")}${d.getMonth() + 1}${p("月", "月")}${d.getDate()}${p("日", "日")} ${weekday}`
    : `${new Intl.DateTimeFormat(widget.locale, { dateStyle: "long" }).format(d)} ${weekday}`;
  const lines = [`<div class="tp-h">${head}${sameDay(d, today) ? `<i>${t("今天", "今天", "today")}</i>` : ""}</div>`];
  if (lun) lines.push(`<div class="tp-l">${p("農曆", "農曆")}${lun.text}${lun.day}${fest ? ` · <b>${fest}</b>` : ""}${term ? ` · <b>${term}</b>` : ""}</div>`);
  if (lun) lines.push(`<div class="tp-g">${gw}${p("年", "年")} ${gz.text}${p("月", "月")} ${gzDay(d).text}${p("日", "日")}</div>`);
  if (al) {
    lines.push(`<div class="tp-a"><b>${al.name}</b><span>${al.huang ? p("黃道日", "黃道日") : p("黑道日", "黑道日")}</span>` +
      `<span>${p("沖", "沖")}${al.chong} ${p("煞", "煞")}${al.sha}</span></div>`);
    lines.push(`<div class="tp-yj"><span class="y">${p("宜", "宜")} ${al.yi.join(" ")}</span><span class="j">${p("忌", "忌")} ${al.ji.join(" ")}</span></div>`);
  } else if (!zh) {
    lines.push(`<div class="tp-l">${t("", "", "Chinese almanac details are available in Chinese")}</div>`);
  }
  return lines.join("");
}

function moveTip(cell) {
  const host = document.body.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  const k = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = (r.left - host.left + r.width / 2 - w * k / 2) / k;
  left = Math.max(4, Math.min(host.width / k - w - 4, left));
  let top = (r.top - host.top) / k - h - 6;
  if (top < 4) top = (r.bottom - host.top) / k + 6;
  top = Math.min(top, host.height / k - h - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

let tipped = null;
$("grid").addEventListener("mouseover", (e) => {
  const cell = e.target.closest && e.target.closest(".c");
  if (!cell || cell === tipped) return;
  tipped = cell;
  tip.innerHTML = tipHtml(fromKey(cell.dataset.k));
  tip.hidden = false;
  moveTip(cell);
});
$("grid").addEventListener("mouseout", (e) => {
  const cell = e.target.closest && e.target.closest(".c");
  if (!cell || (e.relatedTarget && cell.contains(e.relatedTarget))) return;
  hideTip();
});

function hideTip() {
  tipped = null;
  tip.hidden = true;
}
$("grid").addEventListener("click", (e) => {
  const cell = e.target.closest && e.target.closest(".c");
  if (!cell) return;
  select(fromKey(cell.dataset.k), false);
});

// ── selecting, moving ───────────────────────────────────────────────
function select(d, keepView) {
  selected = startOfDay(d);
  if (!keepView) view = firstOfMonth(selected);
  render();
  save();
}

function stepMonth(n) {
  const base = view;
  view = new Date(base.getFullYear(), base.getMonth() + n, 1);
  clampYear();
  render();
}

function clampYear() {
  if (view.getFullYear() < MIN_YEAR) view = new Date(MIN_YEAR, 0, 1);
  if (view.getFullYear() > MAX_YEAR) view = new Date(MAX_YEAR, 11, 1);
}

$("prev").onclick = () => stepMonth(-1);
$("next").onclick = () => stepMonth(1);
$("go").onclick = () => { today = startOfDay(new Date()); select(today); };

// ── the month / year picker ──────────────────────────────────────────
const pick = $("pick");
let pickYear = view.getFullYear();
let yearsMode = false;

function openPick() {
  pickYear = view.getFullYear();
  yearsMode = false;
  hideTip();
  pick.hidden = false;
  renderPick();
}

function renderPick() {
  $("pyear").textContent = zh ? `${pickYear}${p("年", "年")}` : String(pickYear);
  $("years").hidden = !yearsMode;
  $("months").hidden = yearsMode;
  if (yearsMode) {
    const buttons = [];
    for (let y = MIN_YEAR; y <= MAX_YEAR; y += 1) {
      buttons.push(`<button class="mb${y === pickYear ? " on" : ""}" data-year="${y}">${y}</button>`);
    }
    $("years").innerHTML = buttons.join("");
    const on = $("years").querySelector(".on");
    if (on) on.scrollIntoView({ block: "center" });
    return;
  }
  const fmt = new Intl.DateTimeFormat(widget.locale, { month: "short" });
  const buttons = [];
  for (let m = 0; m < 12; m++) {
    const on = pickYear === view.getFullYear() && m === view.getMonth();
    const label = zh ? `${m + 1}${p("月", "月")}` : fmt.format(new Date(2024, m, 1));
    buttons.push(`<button class="mb${on ? " on" : ""}" data-month="${m}">${label}</button>`);
  }
  $("months").innerHTML = buttons.join("");
}

$("ym").onclick = openPick;
$("pclose").onclick = () => { pick.hidden = true; };
$("pyear").onclick = () => { yearsMode = !yearsMode; renderPick(); };
$("py-").onclick = () => { pickYear = Math.max(MIN_YEAR, pickYear - 1); renderPick(); };
$("py+").onclick = () => { pickYear = Math.min(MAX_YEAR, pickYear + 1); renderPick(); };
pick.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) { pick.hidden = true; return; }
  const m = e.target.closest("[data-month]");
  if (m) {
    view = new Date(pickYear, Number(m.dataset.month), 1);
    selected = firstOfMonth(view);
    pick.hidden = true;
    render();
    save();
    return;
  }
  const y = e.target.closest("[data-year]");
  if (y) { pickYear = Number(y.dataset.year); yearsMode = false; renderPick(); }
});

// ── the details sheet ───────────────────────────────────────────────
const sheet = $("sheet");
function openSheet() {
  hideTip();
  sheet.hidden = false;
  renderSheet();
  const card = $("sheetCard");
  card.scrollTop = 0;
}

function renderSheet() {
  const d = selected;
  const lun = showLunar() ? lunarOf(d) : null;
  const al = showAlmanac() ? almanac(d) : null;
  const term = lun ? termOn(d) : null;
  const fest = lun ? festivalOf(d, lun) : null;
  const q = showQuote() ? quoteOf(d) : null;
  const diff = dayDiff(d, today);
  const weekday = new Intl.DateTimeFormat(widget.locale, { weekday: "long" }).format(d);
  const head = zh
    ? `${d.getFullYear()}${p("年", "年")}${d.getMonth() + 1}${p("月", "月")}${d.getDate()}${p("日", "日")}`
    : new Intl.DateTimeFormat(widget.locale, { dateStyle: "long" }).format(d);
  const away = diff === 0 ? t("今天", "今天", "today")
    : diff < 0 ? (zh ? `${-diff} ${p("天前", "天前")}` : `${-diff} ${-diff === 1 ? "day" : "days"} ago`)
      : (zh ? `${diff} ${p("天後", "天後")}` : `${diff} ${diff === 1 ? "day" : "days"} later`);

  const tags = [];
  if (fest) tags.push(`<span class="tag fest">${fest}</span>`);
  if (term) tags.push(`<span class="tag term">${term}</span>`);
  if (al) tags.push(`<span class="tag ${al.huang ? "huang" : "hei"}">${al.huang ? p("黃道日", "黃道日") : p("黑道日", "黑道日")}</span>`);

  const gw = gzYearName(solarYear(d));
  const gz = gzMonth(d);
  const gd = gzDay(d);
  const zodiacIdx = (((solarYear(d) - 4) % 12) + 12) % 12;

  const body = [];
  body.push(`<div class="sh-top"><span class="sh-date">${head}</span><span class="sh-wk">${weekday}</span>` +
    `<span class="sh-away">${away}</span><button class="w-btn sh-x" data-close>✕</button></div>`);
  if (lun) {
    body.push(`<div class="sh-lunar"><b>${lun.text}${lun.day}</b>` +
      `<span>${gw}${p("年", "年")}（${p(ZODIAC_CN[zodiacIdx], ZODIAC_TW[zodiacIdx])}）</span></div>`);
    body.push(`<div class="sh-gz"><span>${p("年柱", "年柱")} ${gw}</span><span>${p("月柱", "月柱")} ${gz.text}</span><span>${p("日柱", "日柱")} ${gd.text}</span></div>`);
  }
  if (tags.length) body.push(`<div class="sh-tags">${tags.join("")}</div>`);
  if (al) {
    body.push(`<div class="sh-jc"><span class="sh-jc-name">${al.name}</span>` +
      `<span>${p("沖", "沖")}${al.chong}</span><span>${p("煞", "煞")}${al.sha}</span></div>`);
    body.push(`<div class="sh-yj"><div class="sh-yi"><label>${p("宜", "宜")}</label><p>${al.yi.join(" · ")}</p></div>` +
      `<div class="sh-ji"><label>${p("忌", "忌")}</label><p>${al.ji.join(" · ")}</p></div></div>`);
    body.push(`<div class="sh-note">${p("依建除十二神排的傳統說法，僅供參考。", "依建除十二神排的傳統說法，僅供參考。", "")}</div>`);
  }
  if (q) body.push(`<div class="sh-quote"><p>「${q.text}」</p><i>${q.by}</i></div>`);
  if (!zh) body.push(`<div class="sh-note">Chinese lunar dates and the almanac are shown in Chinese.</div>`);
  $("sheetCard").innerHTML = body.join("");
}

$("foot").onclick = openSheet;
sheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) sheet.hidden = true;
});

// ── keyboard ────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!sheet.hidden) { sheet.hidden = true; e.preventDefault(); return; }
    if (!pick.hidden) { pick.hidden = true; e.preventDefault(); return; }
  }
  if (!sheet.hidden || !pick.hidden) return;
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key in moves) {
    select(addDays(selected, moves[e.key]), true);
    if (selected.getMonth() !== view.getMonth() || selected.getFullYear() !== view.getFullYear()) {
      view = firstOfMonth(selected);
      render();
    }
    e.preventDefault();
  } else if (e.key === "PageUp") { stepMonth(-1); e.preventDefault(); }
  else if (e.key === "PageDown") { stepMonth(1); e.preventDefault(); }
  else if (e.key === "Home") { $("go").onclick(); e.preventDefault(); }
});

// ── keeping up: settings, midnight, the remembered day ───────────────
widget.settings.onChange((s) => { opts = s; render(); });

function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { render(); scheduleMidnight(); }, next - now);
}

// Reopening the card brings back the day you were looking at — but only while it is still
// that same day. Come back tomorrow and the card starts on today, which is what a calendar
// should do rather than dropping you into a month you browsed weeks ago.
function save() {
  try {
    widget.storage.set("date", keyOf(selected));
    widget.storage.set("day", keyOf(new Date()));
  } catch (e) { /* storage is best effort */ }
}

function restore() {
  Promise.all([widget.storage.get("date"), widget.storage.get("day")]).then(([k, day]) => {
    if (day !== keyOf(new Date())) return;
    if (typeof k !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    const d = fromKey(k);
    if (d.getFullYear() < MIN_YEAR || d.getFullYear() > MAX_YEAR) return;
    if (!Number.isFinite(d.getTime())) return;
    selected = d;
    view = firstOfMonth(d);
    render();
  }).catch(() => {});
}

render();
restore();
scheduleMidnight();
