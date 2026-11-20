/* 玩出花 Bloom —— 卡片这一侧只管画廊、开关和「哪块屏」，
 * 真正的像素活在上屏的 overlay.html + effects/ 里（原封不动搬过来的那套）。
 */
const $ = (id) => document.getElementById(id);
const t = widget.t;
const INSTANCE = widget.instanceId;
const BEAT = "bloom:beat";

// ── 特效目录：与「玩出花」原版一一对应（38 款），另补了文案里的「复古网格」 ──
const CATALOG = [
  { id: "matrix", cat: "hard", icon: "💻", color: "#00ff00",
    name: { "zh-CN": "代码雨", "zh-TW": "代碼雨", en: "Code rain" },
    desc: { "zh-CN": "黑客帝国般的赛博流", "zh-TW": "黑客帝國般的賽博流", en: "Matrix-style digital rain" } },
  { id: "cyberPulse", cat: "hard", icon: "⚡", color: "#ff00ff",
    name: { "zh-CN": "霓虹脉冲", "zh-TW": "霓虹脈衝", en: "Neon pulse" },
    desc: { "zh-CN": "极速穿梭的赛博光条", "zh-TW": "極速穿梭的賽博光條", en: "Streaking neon light bars" } },
  { id: "retroGrid", cat: "hard", icon: "🌇", color: "#ff9f43",
    name: { "zh-CN": "复古网格", "zh-TW": "復古網格", en: "Retro grid" },
    desc: { "zh-CN": "80 年代赛博复古波", "zh-TW": "80 年代賽博復古波", en: "80s synthwave grid" } },
  { id: "glitchVision", cat: "hard", icon: "📺", color: "#ff0044",
    name: { "zh-CN": "故障视界", "zh-TW": "故障視界", en: "Glitch vision" },
    desc: { "zh-CN": "RGB 分离、扫描线的干扰美学", "zh-TW": "RGB 分離、掃描線的干擾美學", en: "Split channels, scan lines, torn data" } },
  { id: "fireVortex", cat: "hard", icon: "🔥", color: "#ff4500",
    name: { "zh-CN": "火焰漩涡", "zh-TW": "火焰漩渦", en: "Fire vortex" },
    desc: { "zh-CN": "螺旋升腾的炽热火焰", "zh-TW": "螺旋升騰的熾熱火焰", en: "Fire spiralling into itself" } },
  { id: "rainNeon", cat: "hard", icon: "🌧️", color: "#ff1493",
    name: { "zh-CN": "雨夜霓虹", "zh-TW": "雨夜霓虹", en: "Rainy neon" },
    desc: { "zh-CN": "暴雨夜的玻璃窗，霓虹闪烁", "zh-TW": "暴雨夜的玻璃窗，霓虹閃爍", en: "Neon seen through a rain-soaked pane" } },
  { id: "fireworks", cat: "hard", icon: "🎆", color: "#ff6347",
    name: { "zh-CN": "烟花", "zh-TW": "煙花", en: "Fireworks" },
    desc: { "zh-CN": "夜空中绽放的绚烂", "zh-TW": "夜空中綻放的絢爛", en: "Bursts of colour in the night" } },

  { id: "sakura", cat: "heal", icon: "🌸", color: "#ffb7c5",
    name: { "zh-CN": "落樱缤纷", "zh-TW": "落櫻繽紛", en: "Falling sakura" },
    desc: { "zh-CN": "窗前细雨，落樱满天", "zh-TW": "窗前細雨，落櫻滿天", en: "Petals drifting like spring rain" } },
  { id: "snowfield", cat: "heal", icon: "❄️", color: "#e0ffff",
    name: { "zh-CN": "极地落雪", "zh-TW": "極地落雪", en: "Polar snow" },
    desc: { "zh-CN": "纯净的漫天飞雪", "zh-TW": "純淨的漫天飛雪", en: "Pure, quiet snowfall" } },
  { id: "aurora", cat: "heal", icon: "🌈", color: "#00ff88",
    name: { "zh-CN": "极光", "zh-TW": "極光", en: "Aurora" },
    desc: { "zh-CN": "北极上空的光之幕帘", "zh-TW": "北極上空的光之幕簾", en: "Curtains of northern light" } },
  { id: "gravityParticles", cat: "heal", icon: "✨", color: "#80aaff",
    name: { "zh-CN": "重力粒子", "zh-TW": "重力粒子", en: "Gravity particles" },
    desc: { "zh-CN": "星尘与引力的华尔兹", "zh-TW": "星塵與引力的華爾茲", en: "Stardust dancing with gravity" } },
  { id: "sunsetSea", cat: "heal", icon: "🌇", color: "#ff4500",
    name: { "zh-CN": "暮色残阳", "zh-TW": "暮色殘陽", en: "Sunset sea" },
    desc: { "zh-CN": "日照金山，落日沉海", "zh-TW": "日照金山，落日沉海", en: "Sun sinking into a golden sea" } },
  { id: "galaxy", cat: "heal", icon: "🌀", color: "#b388ff",
    name: { "zh-CN": "星河旋转", "zh-TW": "星河旋轉", en: "Spinning galaxy" },
    desc: { "zh-CN": "缓缓转动的银河漩涡", "zh-TW": "緩緩轉動的銀河漩渦", en: "A slowly turning spiral galaxy" } },
  { id: "nebula", cat: "heal", icon: "🔮", color: "#aa44ff",
    name: { "zh-CN": "3D 星云", "zh-TW": "3D 星雲", en: "3D nebula" },
    desc: { "zh-CN": "宇宙深处的彩色粒子云", "zh-TW": "宇宙深處的彩色粒子雲", en: "Colour clouds deep in space" } },
  { id: "crystal", cat: "heal", icon: "♾️", color: "#e0aaff",
    name: { "zh-CN": "幻空之结", "zh-TW": "幻空之結", en: "Glass knot" },
    desc: { "zh-CN": "流光溢彩的数学玻璃结", "zh-TW": "流光溢彩的數學玻璃結", en: "A luminous mathematical knot" } },
  { id: "inkSpring", cat: "heal", icon: "🎋", color: "#f2ede4",
    name: { "zh-CN": "水墨春意", "zh-TW": "水墨春意", en: "Ink spring" },
    desc: { "zh-CN": "宣纸上的花枝、飞鸟与落樱", "zh-TW": "宣紙上的花枝、飛鳥與落櫻", en: "Blossoms, birds and petals on rice paper" } },
  { id: "inkKoi", cat: "heal", icon: "🎏", color: "#ff4b4b",
    name: { "zh-CN": "水墨游鱼", "zh-TW": "水墨游魚", en: "Ink koi" },
    desc: { "zh-CN": "墨香跃屏幕，游鱼动清涟", "zh-TW": "墨香躍螢幕，游魚動清漣", en: "Ink koi swimming across the screen" } },
  { id: "inkBloom", cat: "heal", icon: "🖋", color: "#262428",
    name: { "zh-CN": "墨韵晕染", "zh-TW": "墨韻暈染", en: "Ink bloom" },
    desc: { "zh-CN": "墨滴入水，晕染成不规则枝蔓", "zh-TW": "墨滴入水，暈染成不規則枝蔓", en: "Ink dropped into water, branching out" } },
  { id: "cloudRain", cat: "heal", icon: "🌫", color: "#8ba5b5",
    name: { "zh-CN": "云动雨斜", "zh-TW": "雲動雨斜", en: "Cloud drift" },
    desc: { "zh-CN": "淡墨山岚，细雨斜风", "zh-TW": "淡墨山嵐，細雨斜風", en: "Pale mountains under slanting rain" } },
  { id: "butterflyDream", cat: "heal", icon: "🦋", color: "#ff63db",
    name: { "zh-CN": "幻梦蝶影", "zh-TW": "幻夢蝶影", en: "Dream butterflies" },
    desc: { "zh-CN": "发光蝴蝶起舞，拖曳流光尾迹", "zh-TW": "發光蝴蝶起舞，拖曳流光尾跡", en: "Glowing butterflies trailing light" } },
  { id: "glowVine", cat: "heal", icon: "🌿", color: "#a855f7",
    name: { "zh-CN": "光之藤蔓", "zh-TW": "光之藤蔓", en: "Glowing vine" },
    desc: { "zh-CN": "深紫夜空下，发光藤蔓缓缓生长", "zh-TW": "深紫夜空下，發光藤蔓緩緩生長", en: "Vines growing in a violet sky" } },
  { id: "lightVine", cat: "heal", icon: "🌿", color: "#4ade80",
    name: { "zh-CN": "光迹藤蔓", "zh-TW": "光跡藤蔓", en: "Vine trail" },
    desc: { "zh-CN": "鼠标轨迹上生长发光藤蔓", "zh-TW": "滑鼠軌跡上生長發光藤蔓", en: "Vines blooming along the pointer path" } },
  { id: "ribbon", cat: "heal", icon: "🎀", color: "#ff7eb6",
    name: { "zh-CN": "流光丝带", "zh-TW": "流光絲帶", en: "Ribbon of light" },
    desc: { "zh-CN": "柔顺发光的彩带正弦飘动", "zh-TW": "柔順發光的彩帶正弦飄動", en: "A soft ribbon swaying in phase" } },
  { id: "morphText", cat: "heal", icon: "✒️", color: "#8ef0c8", customText: true,
    name: { "zh-CN": "千字流转", "zh-TW": "千字流轉", en: "Morphing words" },
    desc: { "zh-CN": "粒子在字与字之间蜿蜒流淌", "zh-TW": "粒子在字與字之間蜿蜒流淌", en: "Particles flowing from word to word" } },
  { id: "skyLantern", cat: "heal", icon: "🏮", color: "#ff9a3c",
    name: { "zh-CN": "千灯夜航", "zh-TW": "千燈夜航", en: "Sky lanterns" },
    desc: { "zh-CN": "孔明灯携着炉火升上夜空", "zh-TW": "孔明燈攜著爐火升上夜空", en: "Lanterns rising into the night" } },
  { id: "constellation", cat: "heal", icon: "🌠", color: "#a8c8ff",
    name: { "zh-CN": "拾星成图", "zh-TW": "拾星成圖", en: "Constellation draw" },
    desc: { "zh-CN": "鼠标停顿时自动连成星座", "zh-TW": "滑鼠停頓時自動連成星座", en: "Stars gather into constellations as you pause" } },
  { id: "constellationTour", cat: "heal", icon: "🔭", color: "#d8b982",
    name: { "zh-CN": "星野图鉴", "zh-TW": "星野圖鑑", en: "Star atlas" },
    desc: { "zh-CN": "真实星座连线与恒星色温", "zh-TW": "真實星座連線與恆星色溫", en: "Real constellations, real star colours" } },

  { id: "deepSea", cat: "relax", icon: "🫧", color: "#96c8ff",
    name: { "zh-CN": "深海浮游", "zh-TW": "深海浮游", en: "Deep-sea plankton" },
    desc: { "zh-CN": "深海中发光的浮游生物", "zh-TW": "深海中發光的浮游生物", en: "Glowing plankton in the deep" } },
  { id: "starfield", cat: "relax", icon: "🌌", color: "#ffffff",
    name: { "zh-CN": "星际穿越", "zh-TW": "星際穿越", en: "Warp stars" },
    desc: { "zh-CN": "感受光速飞行的浪漫", "zh-TW": "感受光速飛行的浪漫", en: "Cruise at light speed" } },
  { id: "fireflies", cat: "relax", icon: "🌟", color: "#adff2f",
    name: { "zh-CN": "森之萤火", "zh-TW": "森之螢火", en: "Forest fireflies" },
    desc: { "zh-CN": "暗夜中起舞的精灵", "zh-TW": "暗夜中起舞的精靈", en: "Sprites dancing in the dark" } },
  { id: "ocean", cat: "relax", icon: "🌊", color: "#0088aa",
    name: { "zh-CN": "3D 海洋", "zh-TW": "3D 海洋", en: "3D ocean" },
    desc: { "zh-CN": "黄昏下起伏的真实海浪", "zh-TW": "黃昏下起伏的真實海浪", en: "Real waves rolling in golden light" } },
  { id: "quantumEntangle", cat: "relax", icon: "🔗", color: "#00ffc8",
    name: { "zh-CN": "量子纠缠", "zh-TW": "量子糾纏", en: "Quantum pairs" },
    desc: { "zh-CN": "成对粒子跨越时空，连线交织", "zh-TW": "成對粒子跨越時空，連線交織", en: "Paired particles linked across space" } },
  { id: "ripple", cat: "relax", icon: "💧", color: "#4fc3f7",
    name: { "zh-CN": "涟漪", "zh-TW": "漣漪", en: "Ripple" },
    desc: { "zh-CN": "水面泛起的层层波纹", "zh-TW": "水面泛起的層層波紋", en: "Rings spreading on still water" } },
  { id: "kaleido", cat: "relax", icon: "🌸", color: "#e055ff",
    name: { "zh-CN": "万华镜", "zh-TW": "萬華鏡", en: "Kaleidoscope" },
    desc: { "zh-CN": "动态色彩绽放永不重复的曼陀罗", "zh-TW": "動態色彩綻放永不重複的曼陀羅", en: "Endless mirrored colour" } },
  { id: "lavaFlow", cat: "relax", icon: "🌋", color: "#ff6a00",
    name: { "zh-CN": "熔岩流", "zh-TW": "熔岩流", en: "Lava flow" },
    desc: { "zh-CN": "炽热蜡团缓慢升降融合", "zh-TW": "熾熱蠟團緩慢升降融合", en: "Slow, heavy blobs of molten colour" } },
  { id: "mouseFollow", cat: "relax", icon: "✨", color: "#00e5ff",
    name: { "zh-CN": "星尘光标", "zh-TW": "星塵游標", en: "Stardust cursor" },
    desc: { "zh-CN": "鼠标移动时涌出飘散的星尘", "zh-TW": "滑鼠移動時湧出飄散的星塵", en: "Stardust trailing the pointer" } },
  { id: "glyphDust", cat: "relax", icon: "🔤", color: "#7fd4ff", customText: true,
    name: { "zh-CN": "星尘成字", "zh-TW": "星塵成字", en: "Glyph dust" },
    desc: { "zh-CN": "文字凝成粒子星阵，鼠标划过掀浪", "zh-TW": "文字凝成粒子星陣，滑鼠劃過掀浪", en: "Words made of dust, stirred by the pointer" } },
  { id: "ironGlyph", cat: "relax", icon: "🧲", color: "#9fb6cc", customText: true,
    name: { "zh-CN": "铁画银钩", "zh-TW": "鐵畫銀鉤", en: "Iron glyph" },
    desc: { "zh-CN": "万枚铁屑凝成书法", "zh-TW": "萬枚鐵屑凝成書法", en: "Ten thousand filings forming calligraphy" } },
  { id: "glyphFireworks", cat: "relax", icon: "🧨", color: "#ffc46b", customText: true,
    name: { "zh-CN": "字火烟花", "zh-TW": "字火煙花", en: "Glyph fireworks" },
    desc: { "zh-CN": "每隔几秒有一个字炸成烟花", "zh-TW": "每隔幾秒有一個字炸成煙花", en: "A character bursts into fireworks, then returns" } },
];

const CATS = [
  { id: "all", name: { "zh-CN": "全部", "zh-TW": "全部", en: "All" } },
  { id: "hard", name: { "zh-CN": "硬核系", "zh-TW": "硬核系", en: "Hardcore" } },
  { id: "heal", name: { "zh-CN": "治愈系", "zh-TW": "治愈系", en: "Healing" } },
  { id: "relax", name: { "zh-CN": "解压系", "zh-TW": "解壓系", en: "Chill" } },
];

// ── 状态 ──
let wins = [];          // [{ id, displayId, fresh }]
let running = null;     // 正在跑的 effect id
let filter = "all";
let hover = null;
let busy = false;

const setting = (key, fallback) => {
  const v = widget.settings.get(key);
  return v === undefined || v === null ? fallback : v;
};
const fxOf = (id) => CATALOG.find((f) => f.id === id) || null;
const latest = () => (running ? fxOf(running) : null);

// 文字特效（星尘成字/铁画银钩/字火烟花）的自定义文本：按码点数校验 2-10，
// 不合法就回落空串（各特效用自己的默认文案）。
function glyphTextOf(effectId) {
  const fx = fxOf(effectId);
  if (!fx || !fx.customText) return "";
  const raw = String(setting("glyphText", "") || "").trim();
  const len = [...raw].length;
  return len >= 2 && len <= 10 ? raw : "";
}

// 壁纸透明度：0-100，垫在特效底下的桌面壁纸显示多清楚
const wallpaperOpacity = () => {
  const v = Number(setting("wallpaperOpacity", 100));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100;
};

// 传给特效页 startEffect 的启动参数：壁纸透明度 + 自定义文字
const effectOptions = (effectId) => {
  const opt = { wallpaperOpacity: wallpaperOpacity() };
  const txt = glyphTextOf(effectId);
  if (txt) opt.text = txt;
  return opt;
};

// ── 文字 ──
const S = {
  name: t({ "zh-CN": "玩出花", "zh-TW": "玩出花", en: "Bloom" }),
  tagline: t({ "zh-CN": "让你的屏幕开出赛博时代的浪漫", "zh-TW": "讓螢幕開出賽博時代的浪漫", en: "Full-screen effects that leave your work alone" }),
  idle: t({ "zh-CN": "未运行", "zh-TW": "未運行", en: "Idle" }),
  running: t({ "zh-CN": "正在运行", "zh-TW": "正在運行", en: "Running" }),
  blind: t({ "zh-CN": "随便开朵花", "zh-TW": "隨便開朵花", en: "Surprise me" }),
  stop: t({ "zh-CN": "停止运行", "zh-TW": "停止運行", en: "Stop" }),
  hint: t({
    "zh-CN": "特效在最底层穿透运行，不遮挡、不抢焦点；鼠标照点、代码照写。",
    "zh-TW": "特效在最底層穿透執行，不遮擋、不搶焦點；滑鼠照點、程式照寫。",
    en: "The effect runs underneath: nothing is blocked, nothing steals focus.",
  }),
  screens: t({ "zh-CN": "块屏", "zh-TW": "塊螢幕", en: "displays" }),
  noScreen: t({ "zh-CN": "没检测到屏幕，检查显示器连接", "zh-TW": "沒偵測到螢幕，檢查顯示器連線", en: "No display found" }),
  needScreen: t({
    "zh-CN": "需要「屏幕」权限：到控制中心 → 我的组件 → 玩出花 里授权一次",
    "zh-TW": "需要「螢幕」權限：到控制中心 → 我的組件 → 玩出花 裡授權一次",
    en: "The screen permission is not granted yet — allow it in the control center first.",
  }),
  started: (name) => t({ "zh-CN": `已开启「${name}」`, "zh-TW": `已開啟「${name}」`, en: `Started: ${name}` }),
  stopped: t({ "zh-CN": "已停止运行", "zh-TW": "已停止運行", en: "Effect stopped" }),
  badGlyphText: t({
    "zh-CN": "自定义文字需 2-10 个字，先用各特效默认文案",
    "zh-TW": "自訂文字需 2-10 個字，先用各特效默認文案",
    en: "Custom text takes 2-10 characters; using each effect's default for now",
  }),
};

$("name").textContent = S.name;
$("blind").textContent = S.blind;
$("stop").textContent = S.stop;

// ── 画廊 ──
function buildCats() {
  const nav = $("cats");
  nav.innerHTML = "";
  for (const c of CATS) {
    const b = document.createElement("button");
    b.className = "cat" + (filter === c.id ? " is-on" : "");
    b.textContent = t(c.name);
    b.dataset.cat = c.id;
    b.addEventListener("click", () => {
      filter = c.id;
      buildCats();
      buildGrid();
    });
    nav.appendChild(b);
  }
}

function buildGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  for (const fx of CATALOG) {
    if (filter !== "all" && fx.cat !== filter) continue;
    const tile = document.createElement("button");
    tile.className = "fx";
    tile.dataset.id = fx.id;
    tile.style.setProperty("--fxcolor", fx.color);
    tile.title = `${t(fx.name)} · ${t(fx.desc)}`;

    const top = document.createElement("span");
    top.className = "fx-top";
    const icon = document.createElement("span");
    icon.className = "fx-icon";
    icon.textContent = fx.icon;
    const name = document.createElement("span");
    name.className = "fx-name";
    name.textContent = t(fx.name);
    top.append(icon, name);

    const desc = document.createElement("span");
    desc.className = "fx-desc";
    desc.textContent = t(fx.desc);

    tile.append(top, desc);
    tile.addEventListener("click", () => run(fx.id));
    tile.addEventListener("mouseenter", () => { hover = fx.id; paintStatus(); });
    tile.addEventListener("mouseleave", () => { hover = null; paintStatus(); });
    grid.appendChild(tile);
  }
  paintGrid();
}

function paintGrid() {
  for (const tile of $("grid").children) {
    tile.classList.toggle("is-on", tile.dataset.id === running);
  }
}

function paintStatus() {
  const fx = latest();
  const dot = $("dot");
  if (fx) {
    dot.style.background = fx.color;
    dot.classList.add("is-live");
    $("stateText").textContent = `${t(fx.name)} · ${wins.length} ${S.screens}`;
    $("sub").textContent = `${S.running} · ${t(fx.name)}`;
    $("stop").disabled = false;
  } else {
    dot.style.background = "";
    dot.classList.remove("is-live");
    $("stateText").textContent = S.idle;
    $("sub").textContent = S.tagline;
    $("stop").disabled = true;
  }
  const hovered = hover ? fxOf(hover) : null;
  $("hint").textContent = hovered ? `${t(hovered.name)} · ${t(hovered.desc)}` : S.hint;
  paintGrid();
}

let toastTimer = 0;
function toast(text, bad) {
  const el = $("toast");
  el.textContent = text;
  el.classList.toggle("is-bad", !!bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ── 宿主窗口 ──
async function listDisplays() {
  let list = [];
  try {
    list = (await widget.call("screen.displays")) || [];
  } catch (e) {
    toast(S.needScreen, true);
    return [];
  }
  if (setting("displays", "all") === "primary" && list.length) {
    const primary = list.find((d) => d.primary) || list[0];
    return [primary];
  }
  return list;
}

async function openOverlay(display, effectId) {
  const b = (display && display.bounds) || {};
  const options = {
    x: Math.round(Number(b.x) || 0),
    y: Math.round(Number(b.y) || 0),
    width: Math.max(1, Math.round(Number(b.width) || 1920)),
    height: Math.max(1, Math.round(Number(b.height) || 1080)),
    title: "玩出花 - " + (fxOf(effectId) ? t(fxOf(effectId).name) : "特效"),
    // 关键：`wallpaper` 让宿主把窗口挂成桌面图标层（SHELLDLL_DefView）之下的子窗口。
    // 这样图标、桌面右键菜单、其它应用窗口天然都在特效之上，鼠标自然落回它们身上，
    // 不靠任何透明/穿透技巧去"假装"不挡。若用 `desktop`，窗口是顶层 owned 窗口，
    // 永远绘制在图标之上，怎么调透明度都会盖住桌面。
    layer: "wallpaper",
    // 壁纸层是不透明的：它本身就是新的桌面背景，不需要 per-pixel alpha / seeThrough。
    frame: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: false,
    closable: true,
    focusable: false,
    show: false,
    // 兜底：即便 Explorer 重建导致 z 序短暂异常，也不让窗口吃掉鼠标或抢焦点。
    ignoreMouseEvents: true,
    // 深色底，与各款霓虹/星空特效的调性一致；壁纸层不透明，这个颜色就是桌面底色。
    backgroundColor: "#0a0e1a",
  };
  let url = "overlay.html?fx=" + encodeURIComponent(effectId) + "&d=" + encodeURIComponent(String(display.id)) + "&wop=" + wallpaperOpacity();
  const txt = glyphTextOf(effectId);
  if (txt) url += "&txt=" + encodeURIComponent(txt);
  const reply = await widget.call("win.create", {
    file: url,
    options,
  });
  const id = reply && reply.id;
  if (!id && id !== 0) throw new Error("window was not created");
  // 先把「点得穿」办好，再让它无声无息地出现：出现这一下绝不能把用户正在打字的窗口顶掉。
  await widget.call("win.setIgnoreMouseEvents", { win: id, ignore: true });
  await widget.call("win.showInactive", { win: id });
  return { id, displayId: display.id, fresh: true };
}

const js = (text) => JSON.stringify(text);

async function sendEffect(win, effectId) {
  const fx = fxOf(effectId);
  if (fx) widget.call("win.setTitle", { win: win.id, title: "玩出花 - " + t(fx.name) }).catch(() => {});
  try {
    await widget.call("win.executeJavaScript", {
      win: win.id,
      code: `window.startEffect && window.startEffect(${js(effectId)}, ${JSON.stringify(effectOptions(effectId))})`,
    });
  } catch (e) {
    /* 页面可能还在加载：它自己会照 URL 上的 fx 先跑一支 */
  }
}

async function closeWin(win) {
  try { await widget.call("win.destroy", { win: win.id }); } catch (e) {}
}

async function run(effectId) {
  if (busy) return;
  const fx = fxOf(effectId);
  if (!fx) return;
  // 文字特效带了一份没通过校验的自定义文本时，温和提醒（特效本身照常用默认文案）
  if (fx.customText) {
    const raw = String(setting("glyphText", "") || "").trim();
    const len = [...raw].length;
    if (raw && (len < 2 || len > 10)) toast(S.badGlyphText, true);
  }
  busy = true;
  try {
    const displays = await listDisplays();
    if (!displays.length) { toast(S.noScreen, true); return; }

    const keepIds = displays.map((d) => d.id);
    const stale = wins.filter((w) => keepIds.indexOf(w.displayId) < 0);
    wins = wins.filter((w) => keepIds.indexOf(w.displayId) >= 0);
    for (const w of stale) await closeWin(w);

    const carried = wins.slice();
    for (const d of displays) {
      if (wins.some((w) => w.displayId === d.id)) continue;
      try {
        const w = await openOverlay(d, effectId);
        if (w) wins.push(w);
      } catch (e) {
        toast(String((e && e.message) || e), true);
      }
    }

    running = effectId;
    paintStatus();
    for (const w of carried) await sendEffect(w, effectId);
    // 刚开的窗口页面可能还没起来：等它落定再补一条，保证跑的是你最后点的这支
    for (const w of wins) {
      if (!w.fresh) continue;
      w.fresh = false;
      setTimeout(() => { if (running === effectId) sendEffect(w, effectId); }, 900);
    }
    try { localStorage.setItem("bloom:fx", effectId); } catch (e) {}
    toast(S.started(t(fx.name)));
  } finally {
    busy = false;
  }
}

async function stopAll(quiet) {
  const gone = wins;
  wins = [];
  running = null;
  try { localStorage.removeItem("bloom:fx"); } catch (e) {}
  for (const w of gone) await closeWin(w);
  paintStatus();
  if (!quiet) toast(S.stopped);
}

// ── 心跳：页面重载后靠它把还在跑的特效接回来（窗口 id 也一并恢复到手） ──
if (window.ipcRenderer) {
  window.ipcRenderer.on(BEAT, (evt, beat) => {
    if (!beat || !beat.win) return;
    const id = Number(beat.win);
    if (!Number.isFinite(id)) return;
    if (!wins.some((w) => w.id === id)) {
      const d = Number(beat.d);
      wins.push({ id, displayId: Number.isFinite(d) ? d : String(beat.d || ""), fresh: false });
    }
    if (!running && beat.fx && fxOf(beat.fx)) running = beat.fx;
    paintStatus();
  });
}

// 盲盒：从全目录均匀随机抽一朵，连续两次不重样。
// 之前按时段分小组（每组只有 4 个），随机面太窄，翻来覆去总是那几个。
let lastBlind = "";
function blindBox() {
  const pool = CATALOG.map((f) => f.id).filter((id) => id !== lastBlind);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastBlind = pick;
  run(pick);
}

// ── 交互绑定 ──
$("blind").addEventListener("click", blindBox);
$("stop").addEventListener("click", () => stopAll(false));

// 设置热更新：只有壁纸透明度变了就轻量同步（拖滑条不重启特效）；
// 「仅主屏 / 全部屏」或自定义文字变了才就地重排 / 换字重跑。
let lastDisplays = setting("displays", "all");
let lastGlyphText = setting("glyphText", "");

widget.settings.onChange(() => {
  if (running) {
    const displays = setting("displays", "all");
    const glyphText = setting("glyphText", "");
    const opacityOnly = displays === lastDisplays && glyphText === lastGlyphText;
    lastDisplays = displays;
    lastGlyphText = glyphText;
    if (opacityOnly) {
      const op = wallpaperOpacity();
      for (const w of wins) {
        widget.call("win.executeJavaScript", {
          win: w.id,
          code: `window.__bloomSetWallpaperOpacity && window.__bloomSetWallpaperOpacity(${op})`,
        }).catch(() => {});
      }
    } else {
      run(running);   // 换屏数或换文字：就地重排
    }
  } else paintStatus();
});

// 卡片被卸载（用户删掉这个组件）时，屏幕上的特效一并收走；换主题之类的重载则保留。
widget.on("unload", (d) => { if (d && d.kill) stopAll(true); });

// 页面起来后：先听 1.2 秒心跳，把上一轮的特效接回来
buildCats();
buildGrid();
paintStatus();
setTimeout(() => {
  if (!running) return;
  if (setting("keepOnReload", true) === false) stopAll(true);
  else paintStatus();
}, 1200);

// 宿主重启后没有心跳可听（overlay 窗口已随进程销毁），靠 localStorage 把特效接回来。
// 等心跳先跑完再动手，两者不会打架：有心跳（overlay 活着）时 running 已有值。
setTimeout(() => {
  if (running) return;
  let saved = "";
  try { saved = localStorage.getItem("bloom:fx") || ""; } catch (e) {}
  if (saved && fxOf(saved)) run(saved);
}, 2000);
