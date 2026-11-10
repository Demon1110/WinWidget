const $ = (id) => document.getElementById(id);
const t = widget.t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let opts = widget.settings.get();
let pc = null;

const EDITIONS = {
  Core: { "zh-TW": "家用版", "zh-CN": "家庭版", en: "Home" },
  CoreN: { "zh-TW": "家用版", "zh-CN": "家庭版", en: "Home" },
  CoreSingleLanguage: { "zh-TW": "家用版", "zh-CN": "家庭中文版", en: "Home" },
  CoreCountrySpecific: { "zh-TW": "家用版", "zh-CN": "家庭中文版", en: "Home" },
  Professional: { "zh-TW": "專業版", "zh-CN": "专业版", en: "Pro" },
  ProfessionalN: { "zh-TW": "專業版", "zh-CN": "专业版", en: "Pro" },
  ProfessionalWorkstation: { "zh-TW": "專業工作站版", "zh-CN": "专业工作站版", en: "Pro for Workstations" },
  ProfessionalEducation: { "zh-TW": "專業教育版", "zh-CN": "专业教育版", en: "Pro Education" },
  Enterprise: { "zh-TW": "企業版", "zh-CN": "企业版", en: "Enterprise" },
  Education: { "zh-TW": "教育版", "zh-CN": "教育版", en: "Education" },
  IoTEnterprise: { "zh-TW": "IoT 企業版", "zh-CN": "IoT 企业版", en: "IoT Enterprise" },
};

function osTitle(os) {
  const base = (os.name.match(/^Windows \d+/) || ["Windows"])[0];
  return EDITIONS[os.edition] ? `${base} ${t(EDITIONS[os.edition])}` : os.name;
}

/** "13th Gen Intel(R) Core(TM) i7-13700H" → "Intel Core i7-13700H" */
function cpuName(name) {
  return name.replace(/\((R|TM|C)\)/gi, "").replace(/^\d+(st|nd|rd|th) Gen\s+/i, "").replace(/\s+CPU\b/i, "").replace(/\s*@.*$/, "")
    .replace(/\s+(w\/|with)\s+Radeon.*$/i, "").replace(/\s+\d+-Core Processor$/i, "").replace(/\s+Processor$/i, "")
    .replace(/\s+/g, " ").trim();
}

/** The graphics card that matters most (a laptop's NVIDIA or AMD one before the built-in one), tidied. */
function gpu(list) {
  const clean = (n) => n.replace(/\((R|TM)\)/gi, "").replace(/\s+GPU$/i, "").replace(/\s+/g, " ").trim();
  const rank = (n) => (/nvidia|radeon rx|arc a/i.test(n) ? 0 : 1);
  const sorted = [...list].sort((a, b) => rank(a) - rank(b)).map(clean);
  return [sorted[0], sorted.length > 1 ? `+${sorted.length - 1}` : ""];
}

function gb(bytes) {
  const g = bytes / 1024 ** 3;
  return `${g >= 4 ? Math.round(g) : g.toFixed(1)} GB`;
}

function uptime(ms) {
  const m = Math.floor(ms / 6e4), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return t({ "zh-TW": `${d} 天 ${h % 24} 小時`, "zh-CN": `${d} 天 ${h % 24} 小时`, en: `${d} d ${h % 24} h` });
  if (h) return t({ "zh-TW": `${h} 小時 ${m % 60} 分`, "zh-CN": `${h} 小时 ${m % 60} 分`, en: `${h} h ${m % 60} min` });
  return t({ "zh-TW": `${m} 分鐘`, "zh-CN": `${m} 分钟`, en: `${m} min` });
}

function render() {
  if (!pc) return;
  const up = uptime(Date.now() - pc.bootTime);
  $("up").textContent = up;
  $("up-k").textContent = t({ "zh-TW": "已開機", "zh-CN": "已开机", en: "since start-up" });
  $("os").textContent = osTitle(pc.os);
  $("build").textContent = [pc.os.version, t({ "zh-TW": `組建 ${pc.os.build}`, "zh-CN": `内部版本 ${pc.os.build}`, en: `Build ${pc.os.build}` })].filter(Boolean).join(" · ");

  const screen = pc.screens.find((s) => s.primary) || pc.screens[0];
  const rows = [
    [t({ "zh-TW": "已開機", "zh-CN": "已开机", en: "Up for" }), up, "", "uptime"],
    [t({ "zh-TW": "處理器", "zh-CN": "处理器", en: "Processor" }), cpuName(pc.cpu.name),
      pc.cpu.threads > pc.cpu.cores
        ? t({ "zh-TW": `${pc.cpu.cores} 核 ${pc.cpu.threads} 執行緒`, "zh-CN": `${pc.cpu.cores} 核 ${pc.cpu.threads} 线程`, en: `${pc.cpu.cores} cores, ${pc.cpu.threads} threads` })
        : t({ "zh-TW": `${pc.cpu.cores} 核`, "zh-CN": `${pc.cpu.cores} 核`, en: `${pc.cpu.cores} cores` })],
    [t({ "zh-TW": "記憶體", "zh-CN": "内存", en: "Memory" }), gb(pc.memory.installed), ""],
  ];
  if (opts.showGpu !== false && pc.gpus.length) rows.push([t({ "zh-TW": "顯示卡", "zh-CN": "显卡", en: "Graphics" }), ...gpu(pc.gpus)]);
  if (screen) rows.push([t({ "zh-TW": "螢幕", "zh-CN": "屏幕", en: "Screen" }), `${screen.width} × ${screen.height}`,
    pc.screens.length > 1 ? t({ "zh-TW": `共 ${pc.screens.length} 個`, "zh-CN": `共 ${pc.screens.length} 个`, en: `${pc.screens.length} screens` }) : ""]);
  if (opts.showName !== false) rows.push([t({ "zh-TW": "電腦名稱", "zh-CN": "电脑名称", en: "PC name" }), pc.computer, ""]);
  $("rows").innerHTML = rows.map(([k, v, note, cls]) => `<div class="${cls || ""}"><dt>${esc(k)}</dt>
    <dd title="${esc(v)}${note ? ` ${esc(note)}` : ""}">${esc(v)}${note ? `<small>${esc(note)}</small>` : ""}</dd></div>`).join("");
  fitRows();
}

function tick() {
  render();
  setTimeout(tick, 60000 - (Date.now() % 60000) + 100);
}

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
widget.system.info().then((info) => { pc = info; tick(); }).catch((e) => {
  $("os").textContent = e.message;
});

/** Shows only the lines that fit whole; the last ones give way when the card is short. */
function fitRows() {
  const box = $("rows"), kids = [...box.children];
  kids.forEach((k) => { k.hidden = false; });
  for (let i = kids.length - 1; i > 0 && box.scrollHeight > box.clientHeight + 1; i--) kids[i].hidden = true;
}
new ResizeObserver(fitRows).observe(document.body);
