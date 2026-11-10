const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let data = null;      // { base, at, updated, rates } from the service
let previous = null;  // the day before, for the change arrows
let amount = null;    // what the user typed, in the base currency
let failed = false;

const names = new Intl.DisplayNames(widget.locale, { type: "currency" });
const nameOf = (c) => { try { return names.of(c); } catch { return c; } };
const base = () => (/^[A-Z]{3}$/.test(opts.base || "") ? opts.base : "USD");
const boc = () => opts.source === "boc";
/** Which rates are kept: market rates by base, Bank of China rates also by the price used. */
const feed = () => (boc() ? `boc-${opts.price || "middle"}:${base()}` : base());
const list = () => [...new Set(String(opts.list || "").toUpperCase().split(/[^A-Z]+/).filter((c) => c.length === 3 && c !== base()))].slice(0, 12);

// currencies without minor units, or with huge numbers per dollar
const WHOLE = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK", "HUF", "TWD"]);
function money(v, code) {
  const digits = WHOLE.has(code) && Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  return new Intl.NumberFormat(widget.locale, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) }).format(v);
}

/** Market rates, once a day: 1 base = rates[c] c. */
async function marketRates() {
  const r = await widget.fetch(`https://open.er-api.com/v6/latest/${base()}`);
  const j = await r.json();
  if (j.result !== "success") throw new Error(j["error-type"] || "failed");
  return { base: j.base_code, updated: j.time_last_update_unix * 1000, rates: j.rates };
}

// Bank of China lists currencies by their Chinese names
const BOC_CODES = {
  "美元": "USD", "欧元": "EUR", "英镑": "GBP", "日元": "JPY", "港币": "HKD", "澳门元": "MOP", "新台币": "TWD",
  "韩国元": "KRW", "新加坡元": "SGD", "林吉特": "MYR", "泰国铢": "THB", "澳大利亚元": "AUD", "新西兰元": "NZD",
  "加拿大元": "CAD", "瑞士法郎": "CHF", "瑞典克朗": "SEK", "挪威克朗": "NOK", "丹麦克朗": "DKK", "卢布": "RUB",
  "阿联酋迪拉姆": "AED", "文莱元": "BND", "巴西雷亚尔": "BRL", "捷克克朗": "CZK", "匈牙利福林": "HUF",
  "印尼卢比": "IDR", "以色列谢克尔": "ILS", "印度卢比": "INR", "柬埔寨瑞尔": "KHR", "科威特第纳尔": "KWD",
  "哈萨克斯坦坚戈": "KZT", "蒙古图格里克": "MNT", "毛里求斯卢比": "MUR", "墨西哥比索": "MXN", "尼泊尔卢比": "NPR",
  "菲律宾比索": "PHP", "巴基斯坦卢比": "PKR", "波兰兹罗提": "PLN", "卡塔尔里亚尔": "QAR", "罗马尼亚列伊": "RON",
  "塞尔维亚第纳尔": "RSD", "沙特里亚尔": "SAR", "土耳其里拉": "TRY", "越南盾": "VND", "南非兰特": "ZAR", "赞比亚克瓦查": "ZMW",
};
// table columns after the name; a price the bank doesn't quote falls back to its partner, then the middle rate
const BOC_COLUMNS = { spotBuy: 1, cashBuy: 2, spotSell: 3, cashSell: 4, middle: 5 };
const BOC_PARTNER = { spotBuy: "cashBuy", cashBuy: "spotBuy", spotSell: "cashSell", cashSell: "spotSell", middle: "middle" };

/** Bank of China board rates (yuan per 100 units, updated through the day), turned into
 *  1 base = rates[c] c by way of the yuan. */
async function bocRates() {
  const r = await widget.fetch("https://www.boc.cn/sourcedb/whpj/");
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  const kind = BOC_COLUMNS[opts.price] ? opts.price : "middle";
  const yuan = { CNY: 100 }; // yuan per 100 units
  let updated = 0;
  for (const tr of doc.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
    const code = BOC_CODES[cells[0]];
    if (!code || cells.length < 7) continue;
    const pick = (k) => parseFloat(cells[BOC_COLUMNS[k]]);
    const v = [kind, BOC_PARTNER[kind], "middle"].map(pick).find((x) => x > 0);
    if (!v) continue;
    yuan[code] = v;
    // published in Beijing time: "2026/11/09 05:30:00"
    const m = cells[6].match(/(\d{4})\/(\d{2})\/(\d{2})\s*(\d{2}:\d{2}:\d{2})/);
    if (m) updated = Math.max(updated, Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}+08:00`));
  }
  if (Object.keys(yuan).length < 10) throw new Error("boc: no table");
  const b = base();
  if (!yuan[b]) throw new Error(`boc: no ${b}`);
  const rates = {};
  for (const [c, v] of Object.entries(yuan)) rates[c] = yuan[b] / v;
  return { base: b, updated: updated || Date.now(), rates };
}

/** The day a reading belongs to, by Beijing time (both sources publish around then). */
const dayOf = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

async function refresh() {
  const key = feed();
  try {
    const next = { ...(boc() ? await bocRates() : await marketRates()), feed: key, at: Date.now() };
    if (key !== feed()) return; // settings changed while loading
    // keep the last day's rates for comparison
    const days = (await widget.storage.get("days")) || {};
    const day = dayOf(next.updated);
    days[`${key}:${day}`] = next.rates;
    const mine = (k) => k.startsWith(`${key}:`) && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(key.length + 1));
    const keys = Object.keys(days).filter(mine).sort();
    for (const k of keys.slice(0, -2)) delete days[k];
    await widget.storage.set("days", days);
    const prevKey = keys.filter((k) => k < `${key}:${day}`).pop();
    previous = prevKey ? days[prevKey] : null;
    data = next;
    failed = false;
    widget.storage.set("last", data);
  } catch (e) {
    widget.log(`currency: ${e.message}`);
    if (key !== feed()) return;
    failed = true;
    if (!data || (data.feed || data.base) !== key) {
      data = null;
      const missing = /^boc: no [A-Z]{3}$/.test(e.message);
      showMessage(missing
        ? t({ "zh-TW": `中國銀行沒有 ${base()} 的牌價`, "zh-CN": `中国银行没有 ${base()} 的牌价`, en: `Bank of China doesn't quote ${base()}` })
        : t({ "zh-TW": "暫時取不到匯率", "zh-CN": "暂时取不到汇率", en: "Can't load rates right now" }), !missing);
      return;
    }
  }
  render();
}

function showMessage(text, retry) {
  $("rows").hidden = true;
  $("msg").hidden = false;
  $("msg-text").textContent = text;
  $("retry").hidden = !retry;
}

function render() {
  if (!data) return;
  $("msg").hidden = true;
  $("rows").hidden = false;
  const b = data.base;
  $("base").textContent = b;
  $("amt").placeholder = t({ "zh-TW": "輸入金額來換算", "zh-CN": "输入金额来换算", en: "Amount to convert" });
  $("rows").innerHTML = list().filter((c) => data.rates[c]).map((c) => {
    const rate = data.rates[c];                 // 1 base = rate c
    const per = 1 / rate;                       // 1 c = per base
    const unit = WHOLE.has(c) && per < 0.5 ? 100 : 1; // "100 JPY = 20.7 TWD" reads better than 0.207
    let change = "";
    if (previous && previous[c]) {
      // change in what one unit of c costs in base; up = c got dearer
      const pct = ((previous[c] / rate) - 1) * 100;
      if (Math.abs(pct) >= 0.01) change = `<span class="chg ${pct > 0 ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%</span>`;
    }
    // the headline: what one (or a hundred) of that currency costs in mine; the conversion only when asked
    const conv = amount != null
      ? `${money(amount, b)} ${b} = ${money(amount * rate, c)} ${c}`
      : `${unit} ${c} → ${b}`;
    return `<li class="row">
      <span class="code w-num">${c}</span>
      <span class="name">${esc(nameOf(c))}</span>
      <span class="val w-num">${money(per * unit, b)}</span>
      <span class="per">${conv}${change}</span>
    </li>`;
  }).join("") || `<li class="none">${esc(t({ "zh-TW": "在設定裏填上要看的貨幣", "zh-CN": "在设置里填写要看的货币", en: "Choose currencies in Settings" }))}</li>`;
  const d = new Intl.DateTimeFormat(widget.locale, boc()
    ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : { month: "numeric", day: "numeric" }).format(data.updated);
  $("date").textContent = failed ? t({ "zh-TW": `離線 · ${d} 的匯率`, "zh-CN": `离线 · ${d} 的汇率`, en: `Offline · rates of ${d}` })
    : t({ "zh-TW": `${d} 更新`, "zh-CN": `${d} 更新`, en: `Updated ${d}` });
}

/** The whole text must be an amount: "1000", "1,000.50", ".5", full-width digits too. Empty is
 *  null (no amount); anything else ("12abc", "1.2.3") is NaN. */
function readAmount(text) {
  const s = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, ".").replace(/[，、]/g, ",").replace(/\s/g, "");
  if (!s) return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$|^\.\d+$/.test(s)) return NaN;
  return Number(s.replace(/,/g, ""));
}

$("amt").addEventListener("input", () => {
  const v = readAmount($("amt").value);
  const bad = Number.isNaN(v);
  $("amt").classList.toggle("bad", bad);
  $("amt").toggleAttribute("aria-invalid", bad);
  $("amt-hint").hidden = !bad;
  // a typo converts nothing and isn't saved: the last good amount stays for next time
  amount = bad ? null : v;
  render();
  if (!bad) widget.storage.set("amount", amount);
});
$("amt-hint").textContent = t({ "zh-TW": "只能填數字，例如 1,000.50", "zh-CN": "只能填数字，例如 1,000.50", en: "Numbers only, e.g. 1,000.50" });
// where the rates come from (ExchangeRate-API's terms ask for this credit)
function credit() {
  $("credit").textContent = boc()
    ? t({ "zh-TW": "資料：中國銀行", "zh-CN": "数据：中国银行", en: "Rates by Bank of China" })
    : t({ "zh-TW": "資料：ExchangeRate-API", "zh-CN": "数据：ExchangeRate-API", en: "Rates by ExchangeRate-API" });
}
credit();
$("credit").onclick = (e) => {
  e.preventDefault();
  widget.shell.open(boc() ? "https://www.boc.cn/sourcedb/whpj/" : "https://www.exchangerate-api.com").catch(() => {});
};
$("retry").textContent = t({ "zh-TW": "重試", "zh-CN": "重试", en: "Retry" });
$("retry").onclick = refresh;

widget.settings.onChange((s) => {
  const was = feed();
  opts = s;
  credit();
  if (feed() !== was) {
    data = null; previous = null;
    showMessage(t({ "zh-TW": "正在載入…", "zh-CN": "正在加载…", en: "Loading…" }), false);
    refresh();
  } else render();
});
widget.appearance.onChange(render);

// market rates change once a day; Bank of China's through the day
const stale = () => !data || Date.now() - data.at > (boc() ? 30 * 60e3 : 3 * 3600e3);

(async () => {
  amount = await widget.storage.get("amount");
  if (amount != null) $("amt").value = String(amount);
  const last = await widget.storage.get("last");
  if (last && (last.feed || last.base) === feed()) {
    data = last;
    const days = (await widget.storage.get("days")) || {};
    const keys = Object.keys(days).filter((k) => k.startsWith(`${feed()}:`)).sort();
    const prevKey = keys.filter((k) => k < `${feed()}:${dayOf(data.updated)}`).pop();
    previous = prevKey ? days[prevKey] : null;
    render();
  } else showMessage(t({ "zh-TW": "正在載入…", "zh-CN": "正在加载…", en: "Loading…" }), false);
  if (stale()) await refresh();
  setInterval(() => { if (stale()) refresh(); }, 5 * 60e3);
})();
