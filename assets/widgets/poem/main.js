const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

// A small curated set: accurate texts, short enough to fit one card.
const TANG = "唐";
const SONG = "宋";

const POEMS = [
  { d: TANG, a: "李白", t: "靜夜思", l: ["床前明月光，疑是地上霜。", "舉頭望明月，低頭思故鄉。"] },
  { d: TANG, a: "李白", t: "早發白帝城", l: ["朝辭白帝彩雲間，", "千里江陵一日還。", "兩岸猿聲啼不住，", "輕舟已過萬重山。"] },
  { d: TANG, a: "李白", t: "望廬山瀑布", l: ["日照香爐生紫煙，", "遙看瀑布掛前川。", "飛流直下三千尺，", "疑是銀河落九天。"] },
  { d: TANG, a: "李白", t: "黃鶴樓送孟浩然之廣陵", l: ["故人西辭黃鶴樓，", "煙花三月下揚州。", "孤帆遠影碧空盡，", "唯見長江天際流。"] },
  { d: TANG, a: "孟浩然", t: "春曉", l: ["春眠不覺曉，處處聞啼鳥。", "夜來風雨聲，花落知多少。"] },
  { d: TANG, a: "王之渙", t: "登鸛雀樓", l: ["白日依山盡，黃河入海流。", "欲窮千里目，更上一層樓。"] },
  { d: TANG, a: "王維", t: "相思", l: ["紅豆生南國，春來發幾枝。", "願君多採擷，此物最相思。"] },
  { d: TANG, a: "王維", t: "山居秋暝", l: ["空山新雨後，天氣晚來秋。", "明月松間照，清泉石上流。", "竹喧歸浣女，蓮動下漁舟。", "隨意春芳歇，王孫自可留。"] },
  { d: TANG, a: "王維", t: "送元二使安西", l: ["渭城朝雨浥輕塵，", "客舍青青柳色新。", "勸君更盡一杯酒，", "西出陽關無故人。"] },
  { d: TANG, a: "杜甫", t: "絕句", l: ["兩個黃鸝鳴翠柳，", "一行白鷺上青天。", "窗含西嶺千秋雪，", "門泊東吳萬里船。"] },
  { d: TANG, a: "杜甫", t: "春望", l: ["國破山河在，城春草木深。", "感時花濺淚，恨別鳥驚心。", "烽火連三月，家書抵萬金。", "白頭搔更短，渾欲不勝簪。"] },
  { d: TANG, a: "柳宗元", t: "江雪", l: ["千山鳥飛絕，萬徑人蹤滅。", "孤舟蓑笠翁，獨釣寒江雪。"] },
  { d: TANG, a: "李紳", t: "憫農", l: ["鋤禾日當午，汗滴禾下土。", "誰知盤中飧，粒粒皆辛苦。"] },
  { d: TANG, a: "陳子昂", t: "登幽州臺歌", l: ["前不見古人，後不見來者。", "念天地之悠悠，獨愴然而涕下。"] },
  { d: TANG, a: "杜牧", t: "山行", l: ["遠上寒山石徑斜，", "白雲生處有人家。", "停車坐愛楓林晚，", "霜葉紅於二月花。"] },
  { d: SONG, a: "蘇軾", t: "題西林壁", l: ["橫看成嶺側成峰，", "遠近高低各不同。", "不識廬山真面目，", "只緣身在此山中。"] },
  { d: SONG, a: "蘇軾", t: "飲湖上初晴後雨", l: ["水光瀲灩晴方好，", "山色空濛雨亦奇。", "欲把西湖比西子，", "淡妝濃抹總相宜。"] },
  { d: SONG, a: "王安石", t: "元日", l: ["爆竹聲中一歲除，", "春風送暖入屠蘇。", "千門萬戶曈曈日，", "總把新桃換舊符。"] },
  { d: SONG, a: "王安石", t: "泊船瓜洲", l: ["京口瓜洲一水間，", "鐘山只隔數重山。", "春風又綠江南岸，", "明月何時照我還。"] },
  { d: SONG, a: "陸游", t: "遊山西村", l: ["莫笑農家臘酒渾，豐年留客足雞豚。", "山重水複疑無路，柳暗花明又一村。", "簫鼓追隨春社近，衣冠簡樸古風存。", "從今若許閒乘月，拄杖無時夜叩門。"] },
  { d: SONG, a: "朱熹", t: "觀書有感", l: ["半畝方塘一鑑開，", "天光雲影共徘徊。", "問渠那得清如許？", "為有源頭活水來。"] },
  { d: SONG, a: "李清照", t: "如夢令", l: ["昨夜雨疏風驟，濃睡不消殘酒。", "試問捲簾人，卻道海棠依舊。", "知否，知否，應是綠肥紅瘦。"] },
  { d: SONG, a: "林升", t: "題臨安邸", l: ["山外青山樓外樓，", "西湖歌舞幾時休？", "暖風薰得遊人醉，", "直把杭州作汴州。"] },
];

let pool = POEMS.slice();
let index = 0;
let offset = 0;
let shown = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dayNo = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const sourceOf = () => String(widget.settings.get("source") || "all");
 const sizeSetting = () => Math.min(20, Math.max(13, Math.round(Number(widget.settings.get("size")) || 15)));

function buildPool() {
  const src = sourceOf();
  pool = src === "tang" ? POEMS.filter((p) => p.d === TANG) : src === "song" ? POEMS.filter((p) => p.d === SONG) : POEMS.slice();
  const n = dayNo();
  let seed = 0;
  for (let i = 0; i < n.length; i++) seed = (seed * 31 + n.charCodeAt(i)) % 100000;
  index = ((seed % pool.length) + offset + pool.length) % pool.length;
}

function paint() {
  const p = pool[index];
  if (!p) return;
  $("dyn").textContent = `${p.d} · ${p.a}`;
  $("pt").textContent = p.t;
  const text = shown || {};
  const lines = text.l || p.l;
  $("lines").innerHTML = lines.map((line) => `<span class="line">${esc(line)}</span>`).join("");
  $("lines").style.fontSize = `${sizeSetting()}px`;
  $("mark").textContent = offset === 0
    ? L("今日", "今日", "Today")
    : offset > 0
      ? L(`+${offset} 首`, `+${offset} 首`, `+${offset}`)
      : L(`${offset} 首`, `${offset} 首`, `${offset}`);

  const locale = String(widget.locale || "");
  shown = null;
  if (locale.indexOf("zh-CN") === 0) {
    // the poems are stored in traditional; ask the host for simplified
    widget.convertChinese([p.t, ...p.l].join("\n"), "simplified").then((converted) => {
      const parts = String(converted == null ? "" : converted).split("\n");
      if (!parts[0]) return;                       // host said nothing useful, keep traditional
      shown = { t: parts[0], l: parts.length > 1 ? parts.slice(1) : p.l };
      $("pt").textContent = shown.t;
      $("lines").innerHTML = shown.l.map((line) => `<span class="line">${esc(line)}</span>`).join("");
    }).catch(() => {});
  }
}

function step(delta) {
  offset += delta;
  buildPool();
  paint();
  widget.storage.set("pick", { day: dayNo(), offset }).catch(() => {});
}

$("title").textContent = L("每日詩詞", "每日诗词", "Daily poem");
$("copy").textContent = L("複製", "复制", "Copy");
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("copy").onclick = () => {
  const p = pool[index];
  if (!p) return;
  const body = `${shown ? shown.t : p.t}\n${(shown ? shown.l : p.l).join("\n")}\n——${p.d}·${p.a}`;
  widget.clipboard.writeText(body).then(() => {
    $("mark").textContent = L("已複製", "已复制", "Copied");
    setTimeout(paint, 1500);
  }).catch(() => {});
};

widget.settings.onChange(() => { buildPool(); paint(); });

buildPool();
paint();

widget.storage.get("pick").then((v) => {
  if (v && v.day === dayNo() && Number.isFinite(v.offset)) offset = v.offset;
  buildPool();
  paint();
}).catch(() => {});
