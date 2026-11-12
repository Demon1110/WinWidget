"use strict";
/* WinWidget control center. The host pushes the whole state on every change ("state");
   this page renders it and calls the host for each change the user makes. */

const host = window.chrome && window.chrome.webview;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const round = (n) => Math.round(Number(n) || 0);

let S = null; // latest state from the host
const ui = load() || { page: "mine", sel: null, tab: "content" };
let fontsLoaded = false;

function load() {
  try { return JSON.parse(localStorage.getItem("ui")); } catch { return null; }
}
function remember() {
  try { localStorage.setItem("ui", JSON.stringify(ui)); } catch { /* private storage may be off */ }
}

// ───────────────────────── host calls ─────────────────────────

let seq = 0;
const pending = new Map();
function call(m, p) {
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error("no host"));
    const id = ++seq;
    pending.set(id, { resolve, reject });
    host.postMessage(JSON.stringify({ id, m, p }));
  });
}
/** A host call; a failure is shown as a toast. */
function api(m, p) {
  return call(m, p).catch((e) => { toast(t("沒有成功：{msg}", { msg: e.message })); throw e; });
}

let loadTimer = 0;
if (host) {
  host.addEventListener("message", (e) => {
    const msg = e.data || {};
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.e !== undefined ? p.reject(new Error(msg.e)) : p.resolve(msg.r);
    } else if (msg.ev === "state") {
      clearTimeout(loadTimer);
      S = msg.d;
      LANG = S.lang || "zh-TW";
      applyPalette();
      try { render(); } catch (err) { console.error(err); loadFailed(); }
    } else if (msg.ev === "stateError") {
      if (S) toast(t("沒有成功：{msg}", { msg: msg.d })); else loadFailed();
    } else if (msg.ev === "select") {
      flushEdits();
      disarm();
      Object.assign(ui, { page: "mine", sel: msg.d });
      remember();
      render();
    } else if (msg.ev === "page") {
      flushEdits();
      disarm();
      ui.page = msg.d === "create" ? "add" : msg.d;
      remember();
      render();
      if (msg.d === "create" && !sheet) openSheet("create", {});
    } else if (msg.ev === "install") {
      if (sheet && sheet.kind === "install" && sheet.data.token !== msg.d.token) api("package.cancel", { token: sheet.data.token });
      openSheet("install", msg.d);
    } else if (msg.ev === "installError") {
      openSheet("error", msg.d);
    } else if (msg.ev === "consent") {
      openSheet("allow", msg.d);
    }
  });
  host.postMessage(JSON.stringify({ m: "ready" }));
  loadTimer = setTimeout(loadFailed, 6000);
}

/** The host couldn't send what the page shows, or it never came: say so, with a way to try
    again, rather than leave the page blank. */
function loadFailed() {
  if (!S && navigator.language.toLowerCase().startsWith("zh-cn")) LANG = "zh-CN";
  else if (!S && !navigator.language.toLowerCase().startsWith("zh")) LANG = "en";
  const main = document.getElementById("main");
  main.innerHTML = `<div class="empty"><h3>${t("控制中心沒有載入成功")}</h3>
    <div>${t("可以再試一次。如果一直這樣，請在問題回報附上資料夾 local › logs 裡的 app.log。")}</div>
    <div class="row-btns"><button class="btn primary" id="load-retry">${t("再試一次")}</button>
    <button class="btn" id="load-folder">${t("打開資料夾")}</button></div></div>`;
  document.getElementById("load-retry").onclick = () => {
    main.innerHTML = "";
    loadTimer = setTimeout(loadFailed, 6000);
    host.postMessage(JSON.stringify({ m: "ready" }));
  };
  document.getElementById("load-folder").onclick = () => host.postMessage(JSON.stringify({ m: "app.openFolder", p: { which: "data" } }));
}

// ───────────────────────── words ─────────────────────────

const LAYERS = [
  ["top", "置頂", "永遠在所有視窗上面。"],
  ["normal", "普通", "和一般視窗一樣，點到時會到前面。"],
  ["desktop", "桌面層", "在所有視窗下面，按 Win+D 回到桌面時仍然看得到。"],
];
const layerName = (l) => t((LAYERS.find((x) => x[0] === l) || LAYERS[2])[1]);
const themeName = (id) => (S.themes.find((th) => th.id === id) || {}).name || id;
const instThemeName = (i) => (i.themeId ? themeName(i.themeId) : t("跟隨全局"));

/** Appearance fields, shared by a widget's 外觀 tab and the global tweaks on the 主題 page. */
const LOOK = [
  { group: "風格" },
  { key: "style", label: "卡片", type: "seg", options: [["transparent", "透明"], ["frosted", "毛玻璃"]], desc: "毛玻璃會模糊後面的桌布。" },
  { key: "shadow", label: "陰影", type: "toggle", desc: "只在透明卡片上顯示。" },
  { group: "顏色" },
  { key: "background", label: "背景顏色", type: "color" },
  { key: "backgroundOpacity", label: "背景不透明度", type: "range", min: 0, max: 1, step: 0.01, pct: true },
  { key: "textColor", label: "文字顏色", type: "color" },
  { key: "accentColor", label: "強調色", type: "color", desc: "進度、圓環、選中的項目用這個顏色。" },
  { group: "文字" },
  { key: "fontFamily", label: "字體", type: "font" },
  { key: "fontScale", label: "字號", type: "range", min: 0.7, max: 1.6, step: 0.05, pct: true },
  { group: "形狀" },
  { key: "radius", label: "圓角", type: "range", min: 0, max: 32, step: 1, unit: "px" },
  { key: "padding", label: "內距", type: "range", min: 0, max: 40, step: 1, unit: "px" },
  { key: "opacity", label: "整體不透明度", type: "range", min: 0.3, max: 1, step: 0.01, pct: true },
];

// ───────────────────────── controls ─────────────────────────

/** data-scope says where a value goes; data-key which key. */
const at = (scope, key) => `data-scope="${scope}" data-k="${esc(key)}"`;

function control(f, value, scope) {
  const a = at(scope, f.key);
  switch (f.type) {
    case "toggle":
      return `<button class="switch" role="switch" aria-checked="${!!value}" aria-label="${esc(t(f.label))}" data-act="toggle" ${a}></button>`;
    case "seg":
      return seg(f.options, value, a);
    case "select":
      return `<select class="select wide" ${a} data-value="${esc(JSON.stringify(value))}">${f.options.map(([v, l]) =>
        `<option value="${esc(JSON.stringify(v))}"${JSON.stringify(v) === JSON.stringify(value) ? " selected" : ""}>${esc(t(l))}</option>`).join("")}</select>`;
    case "range": {
      const v = Number(value ?? f.min);
      const p = ((v - f.min) / (f.max - f.min)) * 100;
      return `<div class="range"><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" style="--p:${p}%" ${a}
        data-fmt="${f.pct ? "pct" : f.unit || ""}"><output>${fmtRange(v, f)}</output></div>`;
    }
    case "color": {
      const hex = toHex(value);
      return `<div class="color"><span class="swatch"><i style="background:${hex}"></i><input type="color" value="${hex}" ${a} data-act="color"></span>
        <input class="field" value="${hex}" ${a} data-act="hex" maxlength="7" spellcheck="false"></div>`;
    }
    case "font":
      return `<input class="field wide" list="fonts" value="${esc(value || "")}" placeholder="${esc(t("跟隨主題"))}" ${a} data-act="font" spellcheck="false">`;
    case "textarea":
      return `<textarea class="area${f.code ? " code" : ""}" ${a} spellcheck="false" placeholder="${esc(t(f.placeholder) || "")}">${esc(value ?? "")}</textarea>`;
    case "number":
      return `<input class="field short" type="number" value="${esc(value ?? "")}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} ${f.step != null ? `step="${f.step}"` : ""} ${a}>`;
    case "date":
      return `<input class="field" type="date" value="${esc(value || "")}" ${a}>`;
    case "folder":
      return `<div class="folder"><span class="folder-path${value ? "" : " none"}" title="${esc(value || "")}">${esc(value ? shortPath(value) : t("還沒選擇資料夾"))}</span>
        <button class="btn small" data-action="pickFolder" data-k="${esc(f.key)}">${t("選擇…")}</button></div>`;
    default:
      return `<input class="field wide" value="${esc(value ?? "")}" placeholder="${esc(f.placeholder || "")}" ${a} spellcheck="false">`;
  }
}

/** "C:\Users\Ray\Pictures\Family" → "…\Pictures\Family" when it doesn't fit. */
function shortPath(p) {
  const parts = String(p).split("\\").filter(Boolean);
  return p.length <= 34 || parts.length <= 3 ? p : "…\\" + parts.slice(-2).join("\\");
}

function seg(options, value, attrs) {
  return `<div class="seg" ${attrs}><span class="seg-mark"></span>${options.map(([v, l]) =>
    `<button data-act="seg" data-v="${esc(JSON.stringify(v))}" class="${JSON.stringify(v) === JSON.stringify(value) ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`;
}

const fmtRange = (v, f) => (f.pct ? `${Math.round(v * 100)}%` : `${v}${f.unit || ""}`);

function toHex(v) {
  const s = String(v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("").toLowerCase();
  return "#000000";
}

function row(label, desc, ctl, opts = {}) {
  return `<div class="row${opts.tall ? " tall" : ""}" data-key="row-${esc(opts.key || label)}">
    <div class="lab">${esc(t(label))}${opts.mark ? `<span class="mark" title="${esc(t("已自訂"))}"></span>` : ""}${desc ? `<small>${esc(t(desc))}</small>` : ""}</div>
    <div class="ctl${opts.stack ? " stack" : ""}">${ctl}${opts.reset ? `<button class="link" data-act="reset" ${opts.reset}>${t("重設")}</button>` : ""}</div>
  </div>`;
}

/** The appearance form; `scope` is "look" (one widget) or "glook" (global tweaks). */
function lookForm(look, overrides, scope) {
  let html = "";
  for (const f of LOOK) {
    if (f.group) { html += `<div class="group-title">${t(f.group)}</div>`; continue; }
    const set = Object.prototype.hasOwnProperty.call(overrides || {}, f.key);
    html += row(f.label, f.desc, control(f, look[f.key], scope), {
      key: f.key, mark: set, reset: set ? at(scope, f.key) : "", tall: false,
    });
  }
  return html;
}

// ───────────────────────── pages ─────────────────────────

const PAGES = { mine: pageMine, add: pageAdd, themes: pageThemes, settings: pageSettings };

function names() {
  // "時鐘", or "時鐘 #2" when there are several of the same widget
  const count = {}, seen = {};
  for (const i of S.instances) count[i.widget] = (count[i.widget] || 0) + 1;
  const out = {};
  for (const i of S.instances) out[i.id] = count[i.widget] > 1 ? `${i.name} #${(seen[i.widget] = (seen[i.widget] || 0) + 1)}` : i.name;
  return out;
}

/** A widget's icon; without one, the first letter of its name. */
const tile = (i, big) => `<span class="tile${big ? " big" : ""}${i.missing ? " missing" : ""}">${i.icon ? `<img src="${i.icon}" alt="">`
  : i.missing ? "!" : `<span class="letter">${esc([...String(i.name || "?").trim()][0] || "?")}</span>`}</span>`;

function pageMine() {
  const list = S.instances;
  if (!list.length) {
    return `<div class="page-head" data-key="h-mine"><h1>${t("我的組件")}</h1></div>
      <div class="empty" data-key="empty"><h3>${t("桌面上還沒有組件")}</h3><div>${t("從組件庫挑一個放上桌面。")}</div>
      <button class="btn primary" data-action="goto" data-page="add">${t("去添加組件")}</button></div>`;
  }
  if (!list.some((i) => i.id === ui.sel)) ui.sel = list[0].id;
  const nm = names();
  const inst = list.find((i) => i.id === ui.sel);
  const items = list.map((i) => {
    const flags = [i.locked ? `<span class="flag">${t("鎖定")}</span>` : "", i.clickThrough ? `<span class="flag warn">${t("穿透")}</span>` : ""].join("");
    return `<button class="item${i.id === ui.sel ? " on" : ""}" data-action="select" data-id="${i.id}" data-key="${i.id}">
      ${tile(i)}
      <span style="min-width:0"><div class="name">${esc(nm[i.id])}${flags ? `<span class="flags">${flags}</span>` : ""}</div>
      <div class="meta">${i.missing ? t("組件已不存在") : `${layerName(i.layer)} · ${esc(instThemeName(i))}`}</div></span>
      <span class="size">${round(i.width)}×${round(i.height)}</span>
    </button>`;
  }).join("");
  return `<div class="page-head" data-key="h-mine"><h1>${t("我的組件")}<span class="sub">${t("桌面上有 {n} 個", { n: list.length })}</span></h1>
      <div class="head-tools">
        <button class="btn quiet danger" data-action="clearAll">${t("清除全部")}</button>
        <button class="btn" data-action="goto" data-page="add">${t("＋ 添加組件")}</button>
      </div></div>
    <div class="mine stagger" data-key="mine">
      <div class="list scroll" style="--i:0"><div class="list-mark"></div>${items}</div>
      <section class="editor" style="--i:1">${editor(inst, nm[inst.id])}</section>
    </div>`;
}

function editor(i, name) {
  if (i.missing) {
    return `<div class="empty" data-key="missing-${i.id}"><h3>${t("「{name}」已不在組件資料夾裏", { name: esc(i.widget) })}</h3>
      <div>${t("可能被刪除或改名了。放回資料夾後到「添加組件」按「重新掃描」，它就會回來。")}</div>
      <button class="btn danger" data-action="remove">${t("移除這一項")}</button></div>`;
  }
  const tabs = [["content", "內容"], ["look", "外觀"], ["behavior", "位置與行為"]];
  const body = ui.tab === "look" ? tabLook(i) : ui.tab === "behavior" ? tabBehavior(i) : tabContent(i);
  const pending = i.pending && i.pending.length
    ? `<div class="notice ask" data-key="pending-${i.id}"><span>${t("它要求新的權限：{list}。允許之前，這部分功能用不了。", { list: list(i.pending.map(permName).map(esc)) })}</span>
        <button class="btn small" data-action="grant" data-widget="${esc(i.widget)}">${t("查看並允許")}</button></div>` : "";
  return `<div class="ed-head" data-key="ed-head">
      ${tile(i, true)}
      <div class="ed-title"><h2>${esc(name)}</h2>
        <div class="meta">${layerName(i.layer)} · ${esc(instThemeName(i))}</div></div>
      <div class="ed-actions">
        <button class="btn" data-action="identify" title="${esc(t("讓它在桌面上閃兩下"))}">${t("定位")}</button>
        <button class="btn quiet" data-action="reload">${t("重新載入")}</button>
        <button class="btn quiet" data-action="duplicate">${t("複製一份")}</button>
        <button class="btn quiet danger" data-action="remove">${t("移除")}</button>
      </div>
    </div>
    ${pending}<div class="tabs" role="tablist" data-key="tabs"><div class="tabs-mark"></div>
      ${tabs.map(([k, l]) => `<button role="tab" data-action="tab" data-tab="${k}" class="${ui.tab === k ? "on" : ""}">${t(l)}</button>`).join("")}
    </div>
    <div class="ed-body scroll fade" data-key="${i.id}-${ui.tab}">${body}</div>`;
}

function tabContent(i) {
  if (!i.schema || !i.schema.length) return `<div class="empty-note">${t("這個組件沒有可以調整的內容。")}</div>`;
  return `<div class="form">${i.schema.map((s) => {
    const f = { ...s, options: (s.options || []).map((o) => [o.value, o.label]) };
    if (f.type === "select" && f.options.length <= 3 && f.options.every((o) => String(o[1]).length <= 6)) f.type = "seg";
    if (f.type === "slider") f.type = "range";
    const wide = f.type === "textarea";
    return row(s.label, s.description, control(f, i.settings[s.key], "setting"), { key: s.key, tall: wide, stack: wide });
  }).join("")}</div>`;
}

function tabLook(i) {
  const themeOpts = [[null, t("跟隨全局（{name}）", { name: themeName(S.themeId) })], ...S.themes.map((th) => [th.id, th.name])];
  return `<div class="form">
    ${row("主題", "只換這個組件，其他不受影響。", control({ key: "theme", type: "select", options: themeOpts }, i.themeId ?? null, "inst"), { key: "theme" })}
    ${lookForm(i.look, i.overrides, "look")}
    <div class="group-title">${t("進階")}</div>
    ${row("自訂 CSS", "寫給這個組件的樣式，離開輸入框時套用。例：body { letter-spacing: .05em }", control({ key: "css", type: "textarea", code: true, placeholder: "/* 例如 */\n.time { color: gold; }" }, i.customCss, "css"), { key: "css", tall: true, stack: true })}
  </div>`;
}

function tabBehavior(i) {
  const layer = LAYERS.find((x) => x[0] === i.layer) || LAYERS[2];
  const s = i.size || {};
  return `<div class="form">
    ${row("層級", layer[2], seg(LAYERS.map((x) => [x[0], x[1]]), i.layer, at("inst", "layer")), { key: "layer" })}
    ${row("鎖定位置", "鎖定後不能拖動或縮放。排列模式下會暫時解鎖。", control({ key: "locked", type: "toggle", label: "鎖定位置" }, i.locked, "inst"), { key: "locked" })}
    ${row("滑鼠穿透", "點擊會穿過組件落到後面。要關閉，回到這裏或用托盤選單。", control({ key: "clickThrough", type: "toggle", label: "滑鼠穿透" }, i.clickThrough, "inst"), { key: "ct" })}
    ${row("尺寸", t("寬 {w1}–{w2}，高 {h1}–{h2}。也可以在桌面上拖右下角。", { w1: round(s.minWidth), w2: round(s.maxWidth), h1: round(s.minHeight), h2: round(s.maxHeight) }),
      `${control({ key: "width", type: "number", min: s.minWidth, max: s.maxWidth, step: 1 }, round(i.width), "size")}<span class="num" style="color:var(--faint)">×</span>
       ${control({ key: "height", type: "number", min: s.minHeight, max: s.maxHeight, step: 1 }, round(i.height), "size")}`, { key: "size" })}
    ${row("位置", "直接在桌面上拖動組件來移動。", `<span class="num" style="color:var(--muted)">X ${i.x} · Y ${i.y}</span>`, { key: "pos" })}
    ${row("識別碼", "命令行和組件保存的資料用這個名字。", `<span class="num" style="color:var(--muted);user-select:text">${i.id}</span>`, { key: "id" })}
    ${S.developer ? `<div class="group-title">${t("開發者")}</div>
      ${row("開發者工具", "查看這個組件的頁面、日誌和錯誤。也可以在組件上按 F12。", `<button class="btn small" data-action="devtools">${t("打開")}</button>`, { key: "devtools" })}
      ${i.builtin ? "" : row("組件資料夾", "改裏面的檔案並存檔，這個組件就會重新載入。", `<button class="btn small" data-action="widgetFolder" data-widget="${esc(i.widget)}">${t("打開")}</button>`, { key: "wfolder" })}` : ""}
  </div>`;
}

const author = (m) => (m.builtin ? t("內建") : m.own ? t("自己寫的") : esc(m.author || t("第三方")));

/** Widget library groups, as sent by the host in each widget's "category". */
const CATS = [["time", "時間"], ["weather", "天氣"], ["system", "系統"], ["productivity", "效率"], ["info", "資訊"], ["media", "媒體與裝飾"], ["other", "其他"]];
let query = ""; // search text on the add page; not remembered

function card(m, n) {
  const perms = m.builtin || !m.permissions.length ? "" : `<div class="perm">${t("需要：")}${list(m.permissions.map((p) => `<span class="nb">${esc(permName(p))}</span>`))}</div>`;
  const tools = m.builtin ? "" : `<div class="card-tools">
      <button class="link" data-action="export" data-widget="${esc(m.id)}">${t("匯出 .fwz")}</button>
      <button class="link" data-action="widgetFolder" data-widget="${esc(m.id)}">${t("資料夾")}</button>
      <button class="link danger" data-action="uninstall" data-widget="${esc(m.id)}">${t("解除安裝")}</button></div>`;
  // with a preview picture the card leads with it; otherwise with the icon
  const thumb = m.preview ? `<div class="thumb"><img src="${esc(m.preview)}" alt="" loading="lazy" draggable="false"></div>` : "";
  return `<article class="card${m.preview ? " has-thumb" : ""}" data-key="c-${m.id}" style="--i:${n}">${thumb}
    <div class="card-top">${m.preview ? "" : tile(m, true)}<div style="min-width:0"><h3>${esc(m.name)}</h3>
      <div class="by">${author(m)} · <span class="num">v${esc(m.version)}</span></div></div></div>
    <p>${esc(m.description || "")}</p>${perms}${tools}
    <div class="card-foot"><span class="have">${m.count ? t("桌面上有 {n} 個", { n: m.count }) : t("還沒放上桌面")}</span>
      <button class="btn${m.count ? "" : " primary"} small" data-action="add" data-widget="${esc(m.id)}">${m.count ? t("再放一個") : t("放到桌面")}</button></div>
  </article>`;
}

// ── the online market (Core/Market.cs) ──
let market = null;      // { widgets, site, offline } from the host
let marketErr = "", marketBusy = false, installing = null;

function loadMarket(refresh) {
  if (marketBusy) return;
  marketBusy = true;
  marketErr = "";
  render();
  call("market.list", { refresh: !!refresh })
    .then((r) => { market = r; })
    .catch((e) => { marketErr = e.message; })
    .finally(() => { marketBusy = false; render(); });
}

/** "1.10.0" vs "1.9.2", by numbers. */
function cmpVer(a, b) {
  const p = (v) => String(v).split(/[-+]/)[0].split(".").map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
  return 0;
}
/** "new", "update", "installed" or "builtin" (a built-in widget has that id). */
function marketState(w) {
  const have = widgetOf(w.id);
  return !have ? "new" : have.builtin ? "builtin" : cmpVer(w.version, have.version) > 0 ? "update" : "installed";
}
const marketList = () => (market ? market.widgets.filter((w) => marketState(w) !== "builtin") : []);
const updatesCount = () => marketList().filter((w) => marketState(w) === "update").length;
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** The widget's picture in the global theme and the app's language, falling back like the library does. */
function previewFor(w) {
  if (!w.preview) return null;
  if (!w.preview.includes("{")) return w.preview;
  const want = (th, l) => w.preview.replace("{theme}", th).replace("{lang}", l);
  const have = new Set(w.previews || []);
  const tries = [want(S.themeId, LANG), want(S.themeId, "en"), want(S.themeId, "zh-TW"), ...S.themes.map((th) => want(th.id, LANG))];
  return tries.find((u) => have.has(u)) || (w.previews && w.previews[0]) || null;
}

function marketCard(w, n) {
  const st = marketState(w), have = widgetOf(w.id);
  const perms = w.permissions.length ? `<div class="perm">${t("需要：")}${list(w.permissions.map((p) => `<span class="nb">${esc(permName(p))}</span>`))}</div>`
    : `<div class="perm quiet">${t("不需要任何權限")}</div>`;
  const img = previewFor(w);
  const thumb = img ? `<div class="thumb"><img src="${esc(img)}" alt="" loading="lazy" draggable="false"></div>` : "";
  const busy = installing === w.id;
  const label = busy ? t("下載中…") : st === "update" ? t("更新到 v{v}", { v: esc(w.version) }) : t("安裝");
  const btn = st === "new" || st === "update"
    ? `<button class="btn primary small" data-action="mInstall" data-widget="${esc(w.id)}"${busy ? " disabled" : ""}>${label}</button>`
    : `<button class="btn small" data-action="add" data-widget="${esc(w.id)}">${t("放到桌面")}</button>`;
  const left = st === "new" ? `<span class="num">${esc(kb(w.bytes))}</span>` : t("已安裝 v{v}", { v: esc(have.version) });
  return `<article class="card${img ? " has-thumb" : ""}" data-key="m-${w.id}" style="--i:${n}">${thumb}
    <div class="card-top">${img ? "" : w.icon ? `<span class="tile big"><img src="${esc(w.icon)}" alt=""></span>` : ""}<div style="min-width:0"><h3>${esc(w.name)}</h3>
      <div class="by">${esc(w.author || t("第三方"))} · <span class="num">v${esc(w.version)}</span></div></div></div>
    <p>${esc(w.description || "")}</p>${perms}
    <div class="card-tools"><button class="link" data-action="mPage" data-url="${esc(w.page)}">${t("在網站上看")}</button></div>
    <div class="card-foot"><span class="have">${left}</span>${btn}</div>
  </article>`;
}

function sourceSwitch(online) {
  const ups = updatesCount();
  return `<div class="seg source" data-key="source"><span class="seg-mark"></span>
    <button data-action="source" data-v="local" class="${online ? "" : "on"}">${t("已安裝")}</button>
    <button data-action="source" data-v="online" class="${online ? "on" : ""}">${t("線上")}${ups ? `<span class="badge" title="${esc(t("{n} 個可以更新", { n: ups }))}">${ups}</span>` : ""}</button></div>`;
}

function pageOnline() {
  const all = marketList();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cats = CATS.filter(([c]) => all.some((w) => w.category === c));
  if (ui.cat && !cats.some(([c]) => c === ui.cat)) ui.cat = null;
  const found = all.filter((w) => (!ui.cat || w.category === ui.cat)
    && words.every((x) => `${w.id} ${w.name} ${w.description} ${w.author}`.toLowerCase().includes(x)));
  let body;
  if (!market && (marketBusy || !marketErr)) body = `<div class="none" data-key="m-wait">${t("正在讀取組件市場…")}</div>`;
  else if (!market) body = `<div class="none" data-key="m-err">${esc(marketErr)}<br><button class="btn small" data-action="mRefresh" style="margin-top:12px">${t("重試")}</button></div>`;
  else {
    const note = market.offline ? `<div class="market-note" data-key="m-off">${t("連不上組件市場，顯示的是上次的清單。")}</div>` : "";
    // updates first, then the newest
    const ups = found.filter((w) => marketState(w) === "update");
    const rest = found.filter((w) => marketState(w) !== "update").sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    let n = 0;
    body = note + ([...ups, ...rest].map((w) => marketCard(w, n++)).join("")
      || `<div class="none" data-key="m-none">${all.length ? t("沒有名稱或說明含「{q}」的組件", { q: esc(query.trim()) }) : t("市場裏還沒有組件。")}</div>`)
      + `<article class="card dev" data-key="m-dev" style="--i:${n}">
          <div class="card-top"><div><h3>${t("把你的組件放上市場")}</h3><div class="by">GitHub</div></div></div>
          <p>${t("寫好的組件可以投稿到組件市場，審核通過後大家都能在這裏安裝。")}</p>
          <div class="card-foot wrap"><button class="btn small" data-action="mSite">${t("怎樣投稿")}</button></div>
        </article>`;
  }
  const chips = market && all.length ? [[null, "全部", all.length], ...cats.map(([c, l]) => [c, l, all.filter((w) => w.category === c).length])]
    .map(([c, l, k]) => `<button class="chip${(ui.cat || null) === c ? " on" : ""}" data-action="cat" data-cat="${c || ""}">${t(l)}<span class="num">${k}</span></button>`).join("") : "";
  return `<div class="page-head" data-key="h-add"><h1>${t("添加組件")}</h1>${sourceSwitch(true)}
      <div class="head-tools">
        <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>
          <input class="field" id="add-search" type="search" value="${esc(query)}" placeholder="${esc(t("搜尋組件"))}" aria-label="${esc(t("搜尋組件"))}" spellcheck="false" autocomplete="off"></label>
        <button class="btn quiet" data-action="mRefresh"${marketBusy ? " disabled" : ""}>${t("重新整理")}</button>
        <button class="btn" data-action="mSite">${t("在網站上看")}</button>
      </div></div>
    <div class="cats" data-key="cats-m">${chips}</div>
    <div class="gallery scroll stagger" data-key="gallery-m">${body}</div>`;
}

function pageAdd() {
  if (ui.source === "online") {
    if (!market && !marketBusy && !marketErr) setTimeout(() => loadMarket(false));
    return pageOnline();
  }
  // someone who has third-party widgets gets told about their updates
  if (!market && !marketBusy && !marketErr && S.catalog.some((m) => !m.builtin && !m.own)) setTimeout(() => loadMarket(false));
  const cats = CATS.filter(([c]) => S.catalog.some((m) => m.category === c));
  if (ui.cat && !cats.some(([c]) => c === ui.cat)) ui.cat = null;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? S.catalog.filter((m) => words.every((w) => m.search.includes(w))) : null;
  let n = 0;
  let body;
  if (found) {
    body = found.length ? found.map((m) => card(m, n++)).join("")
      : `<div class="none" data-key="none">${t("沒有名稱或說明含「{q}」的組件", { q: esc(query.trim()) })}</div>`;
  } else {
    body = cats.filter(([c]) => !ui.cat || c === ui.cat).map(([c, label]) => {
      const group = S.catalog.filter((m) => m.category === c);
      return `<h2 class="cat-head" data-key="cat-${c}">${t(label)}<span class="num">${group.length}</span></h2>` + group.map((m) => card(m, n++)).join("");
    }).join("");
  }
  const chips = [[null, "全部", S.catalog.length], ...cats.map(([c, l]) => [c, l, S.catalog.filter((m) => m.category === c).length])]
    .map(([c, l, k]) => `<button class="chip${!found && (ui.cat || null) === c ? " on" : ""}" data-action="cat" data-cat="${c || ""}">${t(l)}<span class="num">${k}</span></button>`).join("");
  const problems = !found && S.problems && S.problems.length ? `<section class="problems" data-key="problems">
      <div class="problems-head"><b>${t("{n} 個組件資料夾沒有載入", { n: S.problems.length })}</b>
        <button class="btn quiet small" data-action="openFolder" data-which="widgets">${t("打開組件目錄")}</button></div>
      ${S.problems.map((p) => `<div class="problem"><span class="num">${esc(p.folder)}</span><span>${esc(p.message)}</span></div>`).join("")}
    </section>` : "";
  const dev = found || (ui.cat && ui.cat !== "other") ? "" : `<article class="card dev" data-key="c-dev" style="--i:${n}">
      <div class="card-top"><div><h3>${t("自己寫一個組件")}</h3><div class="by">HTML / CSS / JS</div></div></div>
      <p>${t("從模板開始，十分鐘做出第一個。改了檔案存檔，桌面上就會更新。")}</p>
      <div class="card-foot wrap"><button class="btn primary small" data-action="create">${t("新建組件")}</button>
        <button class="btn small" data-action="guide">${t("開發文檔")}</button>
        ${S.developer ? "" : `<button class="btn quiet small" data-action="rescan" title="${esc(t("放進新的組件資料夾後按這裏"))}">${t("重新掃描")}</button>`}</div>
    </article>`;
  return `<div class="page-head" data-key="h-add"><h1>${t("添加組件")}</h1>${sourceSwitch(false)}
      <div class="head-tools">
        <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>
          <input class="field" id="add-search" type="search" value="${esc(query)}" placeholder="${esc(t("搜尋組件"))}" aria-label="${esc(t("搜尋組件"))}" spellcheck="false" autocomplete="off"></label>
        <button class="btn tool" data-action="import" title="${esc(t("也可以把 .fwz / .upx 檔案拖到這個視窗"))}" aria-label="${esc(t("安裝 .fwz / .upx 檔案…"))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/></svg><span>${t("安裝 .fwz / .upx…")}</span></button>
        <button class="btn tool" data-action="create" title="${esc(t("用 HTML / CSS / JS 自己寫一個"))}" aria-label="${esc(t("新建組件…"))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>${t("新建組件…")}</span></button>
      </div></div>
    <div class="cats" data-key="cats">${chips}</div>
    <div class="gallery scroll stagger" data-key="gallery">${problems}${body}${dev}</div>`;
}

function permName(p) {
  if (p === "system") return t("系統資訊");
  if (p === "shell.open") return t("打開網址");
  if (p === "notify") return t("通知");
  if (p === "audio") return t("音量");
  if (p === "media") return t("媒體播放");
  if (p === "clipboard") return t("剪貼簿");
  if (p === "screen") return t("螢幕擷取");
  if (p === "shell.launch") return t("打開程式");
  if (p.startsWith("network:")) return p.slice(8) === "*" ? t("連到任何網站") : t("連網 {host}", { host: p.slice(8) });
  return p;
}

/** What each permission lets a widget do, for the install and allow dialogs. */
function permInfo(p) {
  if (p === "system") return { icon: "chip", title: t("讀取系統資訊"), desc: t("處理器、記憶體、網速、磁碟和電池的使用情況。") };
  if (p === "shell.open") return { icon: "open", title: t("打開網址"), desc: t("用你的瀏覽器打開網頁或郵件連結。") };
  if (p === "notify") return { icon: "bell", title: t("顯示通知"), desc: t("在螢幕角落彈出 Windows 通知，例如時間到了。") };
  if (p === "shell.launch") return { icon: "open", title: t("打開程式和檔案"), desc: t("打開你電腦上的程式、資料夾和檔案，並讀取它們的名稱和圖標。只在你信任這個組件時允許。"), warn: true };
  if (p === "audio") return { icon: "speaker", title: t("調整音量"), desc: t("讀取和改變系統音量，也可以靜音。") };
  if (p === "media") return { icon: "note", title: t("讀取和控制正在播放的媒體"), desc: t("看到正在播放的歌名、歌手和封面，可以播放、暫停和切換曲目。") };
  if (p === "clipboard") return { icon: "note", title: t("讀寫剪貼簿"), desc: t("讀取你複製的文字，或把文字放進剪貼簿。只在你信任這個組件時允許。"), warn: true };
  if (p === "screen") return { icon: "chip", title: t("擷取螢幕畫面"), desc: t("把整個螢幕截成圖片交給組件處理。只在你信任這個組件時允許。"), warn: true };
  const h = p.slice(8);
  if (h === "*") return { icon: "globe", title: t("連到任何網站"), desc: t("可以和任何網站收發資料。"), warn: true };
  if (h.startsWith("*.")) return { icon: "globe", title: t("連到 {host} 和它的子網域", { host: h.slice(2) }), desc: t("和這些網站收發資料。") };
  return { icon: "globe", title: t("連到 {host}", { host: h }), desc: t("和這個網站收發資料。") };
}

const PERM_ICONS = {
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5h4"/>',
  chip: '<path d="M6 6h12v12H6z"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.2-3.6-8.5s1-6.1 3.6-8.5z"/>',
  open: '<path d="M13 4.5h6.5V11M19.5 4.5 11 13"/><path d="M10 6.5H4.5v13h13V14"/>',
  note: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
};

function permList(list, fresh = [], unknown = []) {
  if (!list.length && !unknown.length) {
    return `<div class="perm-none">${t("它不需要任何權限：只顯示自己的內容，不能連網，也讀不到你電腦上的資訊。")}</div>`;
  }
  const items = list.map((p) => {
    const x = permInfo(p);
    return `<li class="${x.warn ? "warn" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true">${PERM_ICONS[x.icon]}</svg>
      <div><b>${esc(x.title)}${fresh.includes(p) ? `<span class="tag">${t("新")}</span>` : ""}</b><small>${esc(x.desc)}</small></div></li>`;
  }).join("") + unknown.map((p) => `<li class="off"><svg viewBox="0 0 24 24" aria-hidden="true">${PERM_ICONS.chip}</svg>
      <div><b>${esc(p)}</b><small>${t("這個版本的 WinWidget 不認得，會被忽略。")}</small></div></li>`).join("");
  return `<div class="perm-title">${t("它可以：")}</div><ul class="perms">${items}</ul>`;
}

function pageThemes() {
  const cards = S.themes.map((th, n) => `<button class="theme${th.id === S.themeId ? " on" : ""}" data-action="theme" data-id="${th.id}" data-key="t-${th.id}" style="--i:${n}">
      <img src="img/theme-${th.id}.png" alt="">
      <div class="t-name">${esc(th.name)}${th.id === S.themeId ? `<span class="tag">${t("使用中")}</span>` : ""}</div>
      <div class="t-desc">${esc(th.description || "")}</div>
    </button>`).join("");
  const n = Object.keys(S.themeOverrides || {}).length;
  return `<div class="page-head" data-key="h-themes"><h1>${t("主題")}<span class="sub">${t("所有組件預設的外觀")}</span></h1></div>
    <div class="scroll stagger" data-key="themes-body">
      <div class="themes" style="--i:0">${cards}</div>
      <section class="panel" style="--i:1">
        <div class="panel-head"><div><h2>${t("全局微調")}</h2><p>${t("在「{name}」上調整，套用到所有組件；換主題時會清空。", { name: esc(themeName(S.themeId)) })}</p></div>
          ${n ? `<button class="btn small" data-action="resetTheme">${t("全部重設（{n}）", { n })}</button>` : ""}</div>
        <div class="form">${lookForm(S.globalLook, S.themeOverrides, "glook")}</div>
      </section>
    </div>`;
}

function pageSettings() {
  const langs = [["auto", "跟隨系統"], ["zh-TW", "繁體中文"], ["zh-CN", "简体中文"], ["en", "English"]];
  const palettes = [["auto", "跟隨系統"], ["light", "淺色"], ["dark", "深色"]];
  const restart = S.lowResource !== S.lowResourceActive
    ? `<div class="notice"><span>${t("重新啟動後生效")}</span><button class="btn small" data-action="restart">${t("立即重新啟動")}</button></div>` : "";
  return `<div class="page-head" data-key="h-settings"><h1>${t("設定")}</h1></div>
    <div class="settings scroll stagger" data-key="settings-body">
      <section class="panel" style="--i:0"><div class="form">
        <div class="group-title">${t("一般")}</div>
        ${row("語言", "介面、組件裏的文字和日期格式。", control({ key: "language", type: "select", options: langs }, S.language, "app"), { key: "lang" })}
        ${row("介面外觀", "控制中心的配色；「跟隨系統」會跟著 Windows 的淺色／深色設定切換。", control({ key: "uiTheme", type: "seg", options: palettes }, S.uiTheme, "app"), { key: "palette" })}
        ${row("開機自動啟動", "登入 Windows 後自動打開 WinWidget。", control({ key: "autostart", type: "toggle", label: "開機自動啟動" }, S.autostart, "app"), { key: "auto" })}
        ${row("雙擊 .fwz 安裝", "讓 Windows 用 WinWidget 打開下載的組件檔案。", control({ key: "fileAssociation", type: "toggle", label: "雙擊 .fwz 安裝" }, S.fileAssociation, "app"), { key: "assoc" })}
        <div class="group-title">${t("桌面")}</div>
        ${row("隱藏全部組件", "暫時收起所有組件；它們會停止更新，不佔用處理器。", control({ key: "hideAll", type: "toggle", label: "隱藏全部組件" }, S.hideAll, "app"), { key: "hide" })}
        ${row("鎖定位置", "一次鎖定或解鎖所有組件。", `<button class="btn" data-action="lockAll" data-on="true">${t("全部鎖定")}</button><button class="btn quiet" data-action="lockAll" data-on="false">${t("全部解鎖")}</button>`, { key: "lock" })}
        <div class="group-title">${t("快捷鍵")}</div>
        ${row("顯示／隱藏全部組件", "在任何地方按下都能切換。", hotkeyCtl("toggleAll"), { key: "hk-all", stack: true })}
        ${row("叫出便籤", "便籤會來到最前面，直接打字；再按一次或點別處就回去。桌面上沒有便籤時會新增一張。", hotkeyCtl("notes"), { key: "hk-notes", stack: true })}
        ${row("叫出待辦清單", "待辦清單會來到最前面，直接輸入新的一項；再按一次或點別處就回去。桌面上沒有待辦清單時會新增一個。", hotkeyCtl("todo"), { key: "hk-todo", stack: true })}
        <div class="group-title">${t("效能")}</div>
        ${row("全螢幕時暫停", "玩遊戲、看全螢幕影片或簡報時，那個螢幕上的組件會隱藏並停止更新。", control({ key: "pauseFullscreen", type: "toggle", label: "全螢幕時暫停" }, S.pauseFullscreen, "app"), { key: "pausefs" })}
        ${row("低資源模式", "關閉 GPU 加速並降低記憶體目標，約省 15 MB；複雜動畫會改由處理器繪製。", control({ key: "lowResource", type: "toggle", label: "低資源模式" }, S.lowResource, "app") , { key: "low" })}
        ${restart}
        <div class="group-title">${t("開發者")}</div>
        ${row("開發者模式", "存檔後組件自動重新載入；組件出錯時在卡片上顯示；按 F12 打開開發者工具。", control({ key: "developer", type: "toggle", label: "開發者模式" }, S.developer, "app"), { key: "dev" })}
        ${row("開發文檔", "怎樣寫組件，以及 widget.json 和 API 的完整說明。", `<button class="btn small" data-action="guide">${t("打開")}</button>`, { key: "guide" })}
        ${row("組件目錄", "放自己寫的或下載的組件。", `<span class="path" title="${esc(S.widgetsDir)}">${esc(S.widgetsDir)}</span><button class="btn small" data-action="openFolder" data-which="widgets">${t("打開")}</button>`, { key: "wdir" })}
        ${row("資料位置", S.portable ? "便攜模式：資料存在程式資料夾裏。" : "設定與組件保存的內容。", `<span class="path" title="${esc(S.dataDir)}">${esc(S.dataDir)}</span><button class="btn small" data-action="openFolder" data-which="data">${t("打開")}</button>`, { key: "ddir" })}
        <div class="group-title">${t("關於")}</div>
        ${row("版本", updateNote(), updateCtl(), { key: "ver" })}
        ${row("自動檢查更新", "每天看一兩次有沒有新版本，有的話在托盤提示。只連 GitHub，不會自己安裝。", control({ key: "updateAuto", type: "toggle", label: "自動檢查更新" }, S.update?.auto === true, "app"), { key: "upd-auto" })}
      </div></section>
    </div>`;
}

// ───────────────────────── updates ─────────────────────────

const UPDATE_ERRORS = {
  offline: "連不上 GitHub，稍後再試。",
  download: "下載中斷了，再試一次吧。",
  verify: "下載的檔案和發佈的不一致，沒有安裝。再試一次吧。",
  signature: "新版本的簽章不對，沒有安裝。",
  noAsset: "這個版本沒有適合這份 WinWidget 的檔案。",
  readonly: "WinWidget 所在的資料夾不能寫入，請到網站下載新版本。",
  dev: "開發用的副本不會自己更新。",
  noChannel: "還沒有設定更新來源，請到網站下載新版本。",
  noRelease: "GitHub 上還沒有發佈任何版本，之後再來看看吧。",
  failed: "沒有安裝成功，請到網站下載新版本。",
};

/** The line under "版本": where the update stands. */
function updateNote() {
  const u = S.update;
  if (!u) return "";
  switch (u.status) {
    case "checking": return "正在檢查更新…";
    case "latest": return t("已是最新版本") + (u.checkedAt ? t("（{time}檢查）", { time: ago(u.checkedAt) }) : "");
    case "available": return t("v{v} 可以更新了。下載約 {size}，裝好後自動重新打開。", { v: u.latest, size: kb(u.size) });
    case "downloading": return t("正在下載 v{v}…", { v: u.latest });
    case "applying": return "正在安裝，WinWidget 會自動關閉再重新打開…";
    case "error": return UPDATE_ERRORS[u.error] || UPDATE_ERRORS.failed;
    default: return "";
  }
}

function updateCtl() {
  const u = S.update || { status: "idle", current: S.version };
  const ver = `<span class="num upd-ver">WinWidget ${esc(S.version)}</span>`;
  const blocked = u.blocked && (u.status === "available" || u.blocked !== "dev");
  switch (u.status) {
    case "checking":
      return `${ver}<button class="btn small" disabled>${t("檢查中…")}</button>`;
    case "available":
      return blocked
        ? `${ver}<button class="btn small primary" data-action="updatePage">${t("到網站下載")}</button>`
        : `${ver}<button class="link" data-action="updatePage">${t("新版本說明")}</button><button class="btn small primary" data-action="updateInstall">${t("更新到 v{v}", { v: esc(u.latest) })}</button>`;
    case "downloading": {
      const pct = Math.round((u.progress || 0) * 100);
      return `<div class="upd-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <span class="num upd-pct">${pct}%</span><button class="btn small quiet" data-action="updateCancel">${t("取消")}</button>`;
    }
    case "applying":
      return `${ver}<button class="btn small" disabled>${t("安裝中…")}</button>`;
    case "error":
      return u.error === "readonly" || u.error === "failed" || u.error === "noAsset" || u.error === "signature"
        ? `${ver}<button class="btn small" data-action="updatePage">${t("到網站下載")}</button>`
        : u.error === "dev" ? ver
        : `${ver}<button class="btn small" data-action="${u.latest && u.latest !== S.version && u.error !== "offline" ? "updateInstall" : "updateCheck"}">${t("再試一次")}</button>`;
    default:
      return `${ver}<button class="btn small" data-action="updateCheck">${t("檢查更新")}</button>`;
  }
}

/** "剛剛", "5 分鐘前", "3 小時前", or the date. */
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return t("剛剛");
  if (m < 60) return t("{n} 分鐘前", { n: m });
  if (m < 1440) return t("{n} 小時前", { n: Math.round(m / 60) });
  return new Date(ms).toLocaleDateString(LANG === "en" ? "en" : LANG === "zh-CN" ? "zh-CN" : "zh-TW");
}

// ───────────────────────── shortcuts ─────────────────────────

let recording = null;    // which shortcut is waiting for keys
let recordHint = "";     // why the last key press wasn't taken

const KEY_LABEL = { Up: "↑", Down: "↓", Left: "←", Right: "→", Win: "Win" };

function hotkeyCtl(action) {
  const h = (S.hotkeys || {})[action] || { keys: "", ok: true };
  const rec = recording === action;
  const keys = h.keys
    ? h.keys.split("+").map((k) => `<kbd>${esc(KEY_LABEL[k] || k)}</kbd>`).join("")
    : `<span class="none">${t("未設定")}</span>`;
  const note = rec
    ? `<small class="hk-note">${esc(recordHint || t("按下新的組合，Esc 取消，Backspace 清除"))}</small>`
    : !h.ok ? `<small class="hk-note warn">${t("已被其他程式佔用，換一個組合吧")}</small>` : "";
  return `<div class="hotkey${rec ? " rec" : ""}${h.ok ? "" : " bad"}">
      <button class="keys" data-action="hotkeyRecord" data-hk="${action}" aria-label="${esc(t("更改快捷鍵"))}">${rec ? `<span class="wait">${t("請按鍵…")}</span>` : keys}</button>
      ${h.keys && !rec ? `<button class="link" data-action="hotkeyClear" data-hk="${action}">${t("清除")}</button>` : ""}
    </div>${note}`;
}

/** KeyboardEvent.code → the name the host understands ("A", "5", "F7", "Num3", "Up", "`"…). */
function keyName(code) {
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return "Num" + m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if ((m = code.match(/^Arrow(Up|Down|Left|Right)$/))) return m[1];
  const named = {
    Space: "Space", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  };
  return named[code] || null;
}

function startRecording(action) {
  recording = action;
  recordHint = "";
  api("app.hotkeysPause", { on: true }).catch(() => {});
  render();
  document.querySelector(".hotkey.rec .keys")?.focus();
}

function stopRecording() {
  if (!recording) return;
  recording = null;
  recordHint = "";
  api("app.hotkeysPause", { on: false }).catch(() => {});
  render();
}

function saveHotkey(action, keys) {
  const name = t({ notes: "叫出便籤", todo: "叫出待辦清單" }[action] || "顯示／隱藏全部組件");
  api("app.hotkey", { action, keys })
    .then(() => toast(keys ? t("「{name}」改成 {keys}", { name, keys }) : t("已關閉「{name}」", { name })))
    .catch(() => {})
    .finally(stopRecording);
}

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat || ["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
  if (!mods.length && e.key === "Escape") return stopRecording();
  if (!mods.length && (e.key === "Backspace" || e.key === "Delete")) return saveHotkey(recording, "");
  const key = keyName(e.code);
  if (!key) { recordHint = t("這個鍵不能用，換一個吧"); return render(); }
  if (!mods.length && !/^F\d+$/.test(key)) { recordHint = t("要加上 Ctrl、Alt、Shift 或 Win"); return render(); }
  saveHotkey(recording, [...mods, key].join("+"));
}, true);

// clicking anywhere else, or leaving the window, cancels
document.addEventListener("mousedown", (e) => { if (recording && !e.target.closest(".hotkey.rec")) stopRecording(); }, true);
window.addEventListener("blur", stopRecording);

// ───────────────────────── rendering ─────────────────────────

/** Which palette the window wears. The host has already answered the "auto" case (it reads
    Windows' app-theme switch and re-pushes the state when it changes), so the page only puts the
    answer on the root element and lets the stylesheet pick the matching block. */
function applyPalette() {
  const pinned = S?.uiTheme === "light" || S?.uiTheme === "dark";
  document.documentElement.dataset.uiTheme = pinned ? S.uiTheme : S?.systemLight ? "light" : "dark";
}

/** Static text in index.html: data-t holds the Traditional Chinese wording. */
function renderFrame() {
  document.documentElement.lang = LANG === "en" ? "en" : LANG === "zh-CN" ? "zh-Hans" : "zh-Hant";
  document.title = t("WinWidget 控制中心");
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.innerHTML = t(el.dataset.t).split("\n").map(esc).join("<br>");
  });
  document.querySelectorAll("[data-t-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tLabel)));
}

function render() {
  if (!S) return;
  renderFrame();
  $("version").textContent = `v${S.version}`;
  $("count-mine").textContent = S.instances.length;
  $("count-add").textContent = S.catalog.length;
  $("edit-switch").setAttribute("aria-checked", String(S.editMode));
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === ui.page));

  morph($("main"), `<div data-key="page-${ui.page}" style="display:contents">${PAGES[ui.page]()}</div>`);
  placeMarks();
  if (document.body.classList.contains("enter")) setTimeout(() => document.body.classList.remove("enter"), 900);
}

/** Sliding selection blocks: nav, widget list, tabs and segmented controls. */
function placeMarks() {
  const nav = document.querySelector(".nav button.on");
  if (nav) slide(document.querySelector(".nav-mark"), { y: nav.offsetTop, h: nav.offsetHeight });
  const item = document.querySelector(".item.on");
  if (item) slide(document.querySelector(".list-mark"), { y: item.offsetTop, h: item.offsetHeight });
  const tab = document.querySelector(".tabs button.on");
  if (tab) slide(document.querySelector(".tabs-mark"), { x: tab.offsetLeft, w: tab.offsetWidth });
  document.querySelectorAll(".seg").forEach((s) => {
    const on = s.querySelector("button.on");
    const mark = s.querySelector(".seg-mark");
    if (on) slide(mark, { x: on.offsetLeft, w: on.offsetWidth });
    if (mark) mark.style.opacity = on ? "1" : "0";
  });
  document.querySelectorAll('input[type="range"]').forEach(fillRange);
}

function slide(mark, { x = 0, y = 0, w, h }) {
  if (!mark) return;
  const first = !mark.dataset.placed;
  if (first) mark.style.transition = "none"; // new marks appear in place, they don't fly in
  mark.style.transform = `translate(${x}px, ${y}px)`;
  if (w != null) mark.style.width = `${w}px`;
  if (h != null) mark.style.height = `${h}px`;
  if (first) {
    mark.dataset.placed = "1";
    mark.getBoundingClientRect();
    requestAnimationFrame(() => (mark.style.transition = ""));
  }
}

function fillRange(r) {
  const p = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty("--p", `${p}%`);
}

/** Updates `target` to match `html` in place, keeping focus, scroll, typing and animations. */
let dragging = null;
function morph(target, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morphChildren(target, tpl.content);
}

function morphChildren(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  for (let i = 0; i < bc.length; i++) {
    const x = ac[i], y = bc[i];
    if (!x) { a.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute("data-key") !== y.getAttribute("data-key"))) {
      a.replaceChild(y, x);
      continue;
    }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    syncAttrs(x, y);
    if (x.nodeName === "TEXTAREA") { syncValue(x, y.textContent); continue; }
    morphChildren(x, y);
    if (x.nodeName === "INPUT") syncValue(x, y.getAttribute("value") ?? "");
    if (x.nodeName === "SELECT") {
      const sel = y.querySelector("option[selected]");
      if (sel) syncValue(x, sel.getAttribute("value"));
    }
  }
  for (let i = ac.length - 1; i >= bc.length; i--) a.removeChild(ac[i]);
}

function syncAttrs(x, y) {
  for (const { name } of [...x.attributes]) if (!y.hasAttribute(name) && name !== "style" && name !== "data-placed") x.removeAttribute(name);
  for (const { name, value } of [...y.attributes]) {
    if (name === "style" && /(nav|list|tabs|seg)-mark/.test(x.className)) continue; // positioned by slide()
    if (x.getAttribute(name) !== value) x.setAttribute(name, value);
  }
  if (!y.hasAttribute("style") && x.hasAttribute("style") && !/mark/.test(x.className)) x.removeAttribute("style");
}

function syncValue(el, value) {
  if (el === document.activeElement || el === dragging) return; // never fight the user
  if (el.value !== value) el.value = value;
}

// ───────────────────────── changes ─────────────────────────

/** Edits typed into a field are sent a moment later. Each one remembers the widget it was typed
 *  for, so switching to another widget before it is sent can't redirect it (and flushEdits sends
 *  it right away when the selection changes). */
const timers = new Map(); // field → { timer, run }
function later(el, ms, fn) {
  const id = ui.sel;
  const prev = timers.get(el);
  if (prev) clearTimeout(prev.timer);
  const run = () => { timers.delete(el); fn(id); };
  timers.set(el, { timer: setTimeout(run, ms), run });
}
/** A delayed commit with everything fixed now: the widget, the setting and the value typed. */
function laterCommit(el, ms, scope, key, value) {
  later(el, ms, (id) => commit(scope, key, value, id));
}
function flushEdits() {
  for (const { timer, run } of [...timers.values()]) { clearTimeout(timer); run(); }
}

/** Sends one value to wherever its scope says; id is the widget it belongs to. */
function commit(scope, key, value, id = ui.sel) {
  switch (scope) {
    case "setting": return api("instance.setting", { id, key, value });
    case "look": return api("instance.appearance", { id, key, value });
    case "glook": return api("theme.override", { key, value });
    case "css": return api("instance.css", { id, css: value });
    case "size": {
      const inst = S.instances.find((i) => i.id === id);
      return api("instance.size", { id, width: key === "width" ? value : inst.width, height: key === "height" ? value : inst.height });
    }
    case "inst":
      if (key === "layer") return api("instance.layer", { id, layer: value });
      if (key === "locked") return api("instance.locked", { id, on: value });
      if (key === "clickThrough") return api("instance.clickThrough", { id, on: value });
      if (key === "theme") return api("instance.theme", { id, theme: value });
      return;
    case "app":
      if (key === "language") return api("app.language", { lang: value });
      if (key === "uiTheme") return api("app.uiTheme", { theme: value });
      return api(`app.${key}`, { on: value });
  }
}

function valueOf(el) {
  if (el.type === "range" || el.type === "number") return Number(el.value);
  if (el.tagName === "SELECT") return JSON.parse(el.value);
  return el.value;
}

document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act) return onControl(act, e);
  const a = e.target.closest("[data-action]");
  if (a) onAction(a);
});

function onControl(el) {
  if (el.dataset.act === "toggle") {
    const on = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", String(on)); // answer at once; the host's state confirms
    if (el.id === "edit-switch") return api("app.editMode", { on });
    commit(el.dataset.scope, el.dataset.k, on);
  } else if (el.dataset.act === "seg") {
    const segEl = el.closest(".seg");
    segEl.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el));
    placeMarks();
    commit(segEl.dataset.scope, segEl.dataset.k, JSON.parse(el.dataset.v));
  } else if (el.dataset.act === "reset") {
    commit(el.dataset.scope, el.dataset.k, null);
  }
}

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "add-search") { query = el.value; render(); return; }
  if (!el.dataset || !el.dataset.scope) return;
  if (el.type === "range") {
    fillRange(el);
    const f = { pct: el.dataset.fmt === "pct", unit: el.dataset.fmt === "pct" ? "" : el.dataset.fmt };
    el.nextElementSibling.textContent = fmtRange(Number(el.value), f);
    return laterCommit(el, 60, el.dataset.scope, el.dataset.k, Number(el.value));
  }
  if (el.dataset.act === "color") {
    const box = el.closest(".color");
    box.querySelector("i").style.background = el.value;
    box.querySelector(".field").value = el.value;
    return laterCommit(el, 80, el.dataset.scope, el.dataset.k, el.value);
  }
  if (el.dataset.act === "hex") {
    const v = el.value.startsWith("#") ? el.value : "#" + el.value;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      el.closest(".color").querySelector("i").style.background = v;
      laterCommit(el, 300, el.dataset.scope, el.dataset.k, v.toLowerCase());
    }
    return;
  }
  if (el.dataset.act === "font") {
    if (!el.value) return laterCommit(el, 300, el.dataset.scope, el.dataset.k, null);
    return laterCommit(el, 500, el.dataset.scope, el.dataset.k, el.value);
  }
  if (el.dataset.scope === "css") return; // applied on blur
  if (el.tagName === "INPUT" && el.type !== "number" && el.type !== "date") return laterCommit(el, 400, el.dataset.scope, el.dataset.k, el.value);
  if (el.tagName === "TEXTAREA") return laterCommit(el, 600, el.dataset.scope, el.dataset.k, el.value);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.scope) return;
  if (el.tagName === "SELECT" || el.type === "number" || el.type === "date") {
    if (el.type === "number" && el.value === "") return;
    commit(el.dataset.scope, el.dataset.k, valueOf(el));
  }
});

document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.scope === "css") commit("css", "css", el.value);
  setTimeout(render, 0); // catch up on anything that arrived while this field was busy
});

document.addEventListener("focusin", (e) => {
  if (e.target.dataset && e.target.dataset.act === "font" && !fontsLoaded) {
    fontsLoaded = true;
    api("fonts.list").then((list) => { $("fonts").innerHTML = list.map((f) => `<option value="${esc(f)}">`).join(""); });
  }
});

document.addEventListener("pointerdown", (e) => { if (e.target.type === "range") dragging = e.target; });
document.addEventListener("pointerup", () => { if (dragging) { dragging = null; setTimeout(render, 0); } });

/** Two clicks for anything that can't be undone here: the first one asks. The question belongs to
 *  one thing (key, e.g. "remove:<instance id>"): a click meant for anything else asks again. */
let arm = null; // { key, el, label, timer }
function disarm() {
  if (!arm) return;
  clearTimeout(arm.timer);
  if (arm.el.isConnected) { arm.el.classList.remove("confirm"); arm.el.textContent = arm.label; }
  arm = null;
}
function armed(a, confirmLabel, key) {
  if (arm && arm.key === key && arm.el === a && a.classList.contains("confirm")) {
    clearTimeout(arm.timer);
    arm = null;
    return true;
  }
  disarm();
  arm = { key, el: a, label: a.textContent, timer: setTimeout(disarm, 3000) };
  a.classList.add("confirm");
  a.textContent = confirmLabel;
  return false;
}

const widgetOf = (id) => S.catalog.find((m) => m.id === id);

function addWidget(widgetId, grant) {
  const m = widgetOf(widgetId);
  const card = document.querySelector(`[data-key="c-${CSS.escape(widgetId)}"]`);
  return api("widget.add", { widget: widgetId, grant: !!grant }).then((r) => {
    // Web Animations, so the next redraw can't cut it short
    const pop = card && card.querySelector(".thumb img, .tile");
    if (pop) pop.animate(
      [{ transform: "scale(1)" }, { transform: `scale(${pop.tagName === "IMG" ? 1.06 : 1.18})` }, { transform: "scale(1)" }],
      { duration: 450, easing: "cubic-bezier(0.3, 1.45, 0.5, 1)" });
    toast(t("已把「{name}」放到桌面", { name: m.name }), t("設定它"), () => { ui.sel = r.id; ui.tab = "content"; go("mine"); });
  });
}

function onAction(a) {
  flushEdits();
  if (!["remove", "uninstall", "clearAll"].includes(a.dataset.action)) disarm();
  const id = ui.sel;
  const inst = S && S.instances.find((i) => i.id === id);
  if (a.dataset.action.startsWith("sheet")) return onSheetAction(a);
  switch (a.dataset.action) {
    case "goto": go(a.dataset.page); break;
    case "cat":
      ui.cat = a.dataset.cat || null;
      query = "";
      remember();
      render();
      $("main").querySelector(".gallery").scrollTop = 0;
      break;
    case "select": ui.sel = a.dataset.id; remember(); render(); break;
    case "tab": ui.tab = a.dataset.tab; remember(); render(); break;
    case "identify": api("instance.identify", { id }); break;
    case "reload": api("instance.reload", { id }).then(() => toast(t("已重新載入"))); break;
    case "duplicate":
      api("instance.duplicate", { id }).then((r) => { ui.sel = r.id; remember(); toast(t("已複製一份，放在桌面的空位")); });
      break;
    case "remove":
      if (armed(a, t("再按一次移除"), "remove:" + id)) {
        const name = inst ? inst.name : "";
        api("instance.remove", { id }).then(() => toast(t("已移除「{name}」，它保存的內容也已刪除", { name })));
      }
      break;
    case "clearAll":
      if (armed(a, t("再按一次清除"), "clearAll")) {
        const n = S.instances.length;
        api("instance.clearAll").then((r) => {
          ui.sel = null;
          toast(t("已清除 {n} 個組件", { n: (r && r.removed) || n }));
        });
      }
      break;
    case "add": {
      const m = widgetOf(a.dataset.widget);
      if (m.pending.length) openSheet("allow", { widget: m.id, then: "add" });
      else addWidget(m.id);
      break;
    }
    case "grant": openSheet("allow", { widget: a.dataset.widget, then: "grant" }); break;
    case "devtools": api("instance.devtools", { id }); break;
    case "source":
      ui.source = a.dataset.v === "online" ? "online" : "local";
      ui.cat = null;
      query = "";
      remember();
      render();
      break;
    case "mRefresh": loadMarket(true); break;
    case "mSite": api("market.open"); break;
    case "mPage": api("market.open", { url: a.dataset.url }); break;
    case "mInstall":
      if (installing) break;
      installing = a.dataset.widget;
      render();
      // the host downloads and checks it, then shows the usual install sheet with its permissions
      api("market.install", { id: installing }).catch(() => {}).finally(() => { installing = null; render(); });
      break;
    case "pickFolder":
      api("instance.pickFolder", { id, key: a.dataset.k }).then((r) => {
        if (r) toast(t("已選擇「{name}」", { name: r.split("\\").filter(Boolean).pop() }));
      });
      break;
    case "import": api("package.import"); break;
    case "create": openSheet("create", {}); break;
    case "guide": api("app.guide"); break;
    case "widgetFolder": api("widget.openFolder", { widget: a.dataset.widget }); break;
    case "export": {
      const m = widgetOf(a.dataset.widget);
      api("widget.export", { widget: m.id }).then((r) => {
        if (r) toast(t("已匯出「{name}」", { name: r.name }), t("打開位置"), () => api("app.reveal", { path: r.path }));
      });
      break;
    }
    case "uninstall": {
      const m = widgetOf(a.dataset.widget);
      if (armed(a, t("再按一次解除安裝"), "uninstall:" + m.id)) {
        api("widget.uninstall", { widget: m.id }).then(() => toast(t("已解除安裝「{name}」，資料夾已移到資源回收筒", { name: m.name })));
      }
      break;
    }
    case "theme": api("theme.global", { id: a.dataset.id }); break;
    case "resetTheme": api("theme.reset"); break;
    case "hotkeyRecord": recording === a.dataset.hk ? stopRecording() : startRecording(a.dataset.hk); break;
    case "hotkeyClear": saveHotkey(a.dataset.hk, ""); break;
    case "lockAll": api("app.lockAll", { on: a.dataset.on === "true" }).then(() => toast(a.dataset.on === "true" ? t("已鎖定全部組件") : t("已解鎖全部組件"))); break;
    case "openFolder": api("app.openFolder", { which: a.dataset.which }); break;
    case "rescan": api("app.rescan").then(() => toast(t("已重新掃描組件目錄"))); break;
    case "restart": api("app.restart"); break;
    case "updateCheck": api("app.updateCheck").catch(() => {}); break;
    case "updateInstall": api("app.updateInstall").catch(() => {}); break;
    case "updateCancel": api("app.updateCancel").catch(() => {}); break;
    case "updatePage": api("app.updatePage").catch(() => {}); break;
  }
}

// ───────────────────────── dialogs, drawn in the page ─────────────────────────

let sheet = null; // { kind, data }

function openSheet(kind, data) {
  sheet = { kind, data };
  renderSheet();
}

/** Closing an install without saying yes cancels it, so its unpacked files are removed. */
function closeSheet() {
  if (sheet && sheet.kind === "install") api("package.cancel", { token: sheet.data.token }).catch(() => {});
  sheet = null;
  renderSheet();
}

const SHEETS = { install: sheetInstall, allow: sheetAllow, create: sheetCreate, error: sheetError };

function renderSheet() {
  const box = $("sheet");
  if (!sheet) {
    box.classList.remove("show");
    box.setAttribute("aria-hidden", "true");
    return;
  }
  const html = SHEETS[sheet.kind](sheet.data);
  if (!html) { sheet = null; return renderSheet(); }
  box.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div>`;
  box.classList.add("show");
  box.removeAttribute("aria-hidden");
  const focus = box.querySelector("[autofocus]") || box.querySelector(".sheet-foot .btn.primary");
  if (focus) focus.focus();
}

function sheetHead(w, title, meta) {
  return `<div class="sheet-head">${tile(w, true)}
    <div style="min-width:0"><h2 id="sheet-title">${title}</h2>${meta ? `<div class="meta">${meta}</div>` : ""}</div></div>`;
}

const INSTALL_WORDS = {
  new: { title: "安裝「{name}」", button: "安裝並放到桌面" },
  newer: { title: "更新「{name}」", button: "更新", note: "桌面上的 {n} 個會一起更新，設定和保存的內容不變；現在的版本會移到資源回收筒。" },
  same: { title: "重新安裝「{name}」", button: "重新安裝", note: "桌面上的 {n} 個會一起重新安裝，設定和保存的內容不變；現在的版本會移到資源回收筒。" },
  older: { title: "換回「{name}」的舊版本", button: "換成這個版本", note: "這個檔案比已安裝的版本舊。桌面上的 {n} 個會換成這個版本，設定和保存的內容不變；現在的版本會移到資源回收筒。" },
};

function sheetInstall(d) {
  const up = d.update;
  const words = INSTALL_WORDS[up ? up.kind : "new"];
  const meta = `${d.author ? `${esc(d.author)} · ` : ""}<span class="num">v${esc(d.version)}</span>${up ? `<span class="was">　${t("目前是")} <span class="num">v${esc(up.from)}</span></span>` : ""}`;
  const note = up ? t(words.note, { n: up.count }) : "";
  return `${sheetHead(d, t(words.title, { name: esc(d.name) }), meta)}
    <div class="sheet-body">
      ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ""}
      ${permList(d.permissions, up ? d.newPermissions : [], d.unknown)}
      ${note ? `<p class="fine">${note}</p>` : ""}
    </div>
    <div class="sheet-foot"><span class="file num" title="${esc(d.file)}">${esc(d.file)}</span>
      <button class="btn quiet" data-action="sheetCancel">${t("取消")}</button>
      <button class="btn primary" data-action="sheetInstall">${t(words.button)}</button></div>`;
}

function sheetAllow(d) {
  const m = S && widgetOf(d.widget);
  if (!m) return "";
  const meta = `${author(m)} · <span class="num">v${esc(m.version)}</span>`;
  const others = m.permissions.filter((p) => !m.pending.includes(p));
  return `${sheetHead(m, t("允許「{name}」使用這些權限？", { name: esc(m.name) }), meta)}
    <div class="sheet-body">
      ${permList(m.pending)}
      ${others.length ? `<p class="fine">${t("之前已允許：{list}", { list: list(others.map(permName).map(esc)) })}</p>` : ""}
    </div>
    <div class="sheet-foot"><span class="file"></span>
      <button class="btn quiet" data-action="sheetCancel">${t("取消")}</button>
      <button class="btn primary" data-action="sheetAllow">${d.then === "add" ? t("允許並放到桌面") : t("允許")}</button></div>`;
}

function sheetCreate() {
  return `<div class="sheet-head"><div><h2 id="sheet-title">${t("新建組件")}</h2></div></div>
    <div class="sheet-body">
      <label class="field-label" for="new-name">${t("名稱")}</label>
      <input class="field wide" id="new-name" maxlength="40" placeholder="${esc(t("例如：每日一句"))}" autocomplete="off" spellcheck="false" autofocus>
      <p class="fine">${t("會在組件目錄建立一個資料夾，放一個到桌面，並打開開發者模式：改了檔案存檔，組件就會重新載入。")}</p>
      <p class="sheet-error" id="new-error" hidden></p>
    </div>
    <div class="sheet-foot"><span class="file"></span>
      <button class="btn quiet" data-action="sheetCancel">${t("取消")}</button>
      <button class="btn primary" data-action="sheetCreate">${t("建立")}</button></div>`;
}

function sheetError(d) {
  return `<div class="sheet-head"><span class="tile big missing">!</span><div style="min-width:0"><h2 id="sheet-title">${t("沒辦法安裝這個檔案")}</h2>
      <div class="meta num">${esc(d.file)}</div></div></div>
    <div class="sheet-body"><p class="desc">${esc(d.message)}</p></div>
    <div class="sheet-foot"><span class="file"></span><button class="btn primary" data-action="sheetCancel">${t("好")}</button></div>`;
}

function onSheetAction(a) {
  if (!sheet) return;
  const d = sheet.data;
  switch (a.dataset.action) {
    case "sheetCancel": closeSheet(); break;
    case "sheetInstall": {
      a.disabled = true;
      sheet = null; // answered: closing must not cancel it
      renderSheet();
      api("package.install", { token: d.token }).then((r) => {
        if (r.update) toast(t("「{name}」現在是 v{v}", { name: r.name, v: r.version }));
        else toast(t("已安裝「{name}」，放到桌面了", { name: r.name }), t("設定它"), () => { ui.sel = r.instanceId; ui.tab = "content"; go("mine"); });
      });
      break;
    }
    case "sheetAllow": {
      sheet = null;
      renderSheet();
      if (d.then === "add") addWidget(d.widget, true);
      else api("widget.grant", { widget: d.widget }).then(() => toast(t("已允許，組件已重新載入")));
      break;
    }
    case "sheetCreate": {
      const input = $("new-name");
      const name = input.value.trim();
      const err = $("new-error");
      if (!name) { input.focus(); return; }
      a.disabled = true;
      host.postMessage(JSON.stringify({ id: ++seq, m: "widget.create", p: { name } }));
      pending.set(seq, {
        resolve: () => { sheet = null; renderSheet(); toast(t("已建立「{name}」並放到桌面，資料夾已打開", { name }), t("開發文檔"), () => api("app.guide")); },
        reject: (e) => { a.disabled = false; err.textContent = e.message; err.hidden = false; input.focus(); },
      });
      break;
    }
  }
}

$("sheet").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeSheet(); });

document.addEventListener("keydown", (e) => {
  if (!sheet) return;
  if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
  else if (e.key === "Enter" && e.target.id === "new-name") { e.preventDefault(); document.querySelector('[data-action="sheetCreate"]').click(); }
  else if (e.key === "Tab") {
    // keep focus inside the dialog
    const f = [...$("sheet").querySelectorAll("button:not([disabled]), input")];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
});

// ───────────────────────── drop a .fwz on the window to install it ─────────────────────────

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");

document.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add("dropping");
});
document.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dropping"); }
});
document.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dropping");
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => /\.(fwz|zip)$/i.test(f.name));
  if (!files.length) return toast(t("只能安裝 .fwz 組件檔案"));
  if (host.postMessageWithAdditionalObjects) host.postMessageWithAdditionalObjects({ m: "package.drop" }, files);
});

function go(page) {
  ui.page = page;
  remember();
  render();
  const main = document.querySelector(".main .scroll");
  if (main) main.scrollTop = 0;
}

document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));

let toastTimer = 0;
function toast(text, actionLabel, action) {
  const box = $("toast");
  box.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button class="btn small primary">${esc(actionLabel)}</button>` : ""}`;
  if (actionLabel) box.querySelector("button").onclick = () => { box.classList.remove("show"); action(); };
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), actionLabel ? 4500 : 2400);
}

window.addEventListener("resize", () => placeMarks());
