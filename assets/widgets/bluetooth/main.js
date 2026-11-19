const $ = (id) => document.getElementById(id);
const t = widget.t;

const TXT = {
  title: { "zh-TW": "藍牙裝置", "zh-CN": "蓝牙设备", en: "Bluetooth" },
  loading: { "zh-TW": "正在讀取…", "zh-CN": "正在读取…", en: "Reading…" },
  loadingList: { "zh-TW": "正在讀取藍牙裝置…", "zh-CN": "正在读取蓝牙设备…", en: "Reading Bluetooth devices…" },
  connected: { "zh-TW": "已連線", "zh-CN": "已连接", en: "Connected" },
  disconnected: { "zh-TW": "未連線", "zh-CN": "未连接", en: "Disconnected" },
  summary: { "zh-TW": "{on} 台已連線 · 共 {all} 台", "zh-CN": "{on} 台已连接 · 共 {all} 台", en: "{on} connected · {all} paired" },
  none: { "zh-TW": "尚無裝置", "zh-CN": "暂无设备", en: "No devices" },
  empty: { "zh-TW": "還沒有配對的藍牙裝置", "zh-CN": "还没有配对的蓝牙设备", en: "No paired Bluetooth devices yet" },
  emptyOff: { "zh-TW": "開啟藍牙後再試一次", "zh-CN": "打开蓝牙后再试一次", en: "Turn Bluetooth on and try again" },
  emptyMissing: { "zh-TW": "這台電腦沒有藍牙適配器", "zh-CN": "这台电脑没有蓝牙适配器", en: "This PC has no Bluetooth adapter" },
  emptyHidden: { "zh-TW": "沒有已連線的裝置", "zh-CN": "没有已连接的设备", en: "No connected devices" },
  emptyError: { "zh-TW": "讀取藍牙裝置失敗", "zh-CN": "读取蓝牙设备失败", en: "Could not read Bluetooth devices" },
  offShort: { "zh-TW": "藍牙已關閉", "zh-CN": "蓝牙已关闭", en: "Bluetooth is off" },
  missingShort: { "zh-TW": "未找到藍牙適配器", "zh-CN": "未找到蓝牙适配器", en: "No Bluetooth adapter" },
  errorShort: { "zh-TW": "讀取失敗", "zh-CN": "读取失败", en: "Read failed" },
  settings: { "zh-TW": "開啟藍牙設定", "zh-CN": "打开蓝牙设置", en: "Bluetooth settings" },
  retry: { "zh-TW": "重試", "zh-CN": "重试", en: "Retry" },
  refresh: { "zh-TW": "重新整理", "zh-CN": "刷新", en: "Refresh" },
  noBattery: { "zh-TW": "未回報電量", "zh-CN": "未上报电量", en: "No battery reported" },
};

const KIND = {
  audio: { "zh-TW": "耳機 / 音響", "zh-CN": "耳机 / 音箱", en: "Headphones / speaker" },
  phone: { "zh-TW": "手機", "zh-CN": "手机", en: "Phone" },
  computer: { "zh-TW": "電腦", "zh-CN": "电脑", en: "Computer" },
  keyboard: { "zh-TW": "鍵盤", "zh-CN": "键盘", en: "Keyboard" },
  mouse: { "zh-TW": "滑鼠", "zh-CN": "鼠标", en: "Mouse" },
  peripheral: { "zh-TW": "周邊裝置", "zh-CN": "外设", en: "Peripheral" },
  wearable: { "zh-TW": "穿戴裝置", "zh-CN": "穿戴设备", en: "Wearable" },
  network: { "zh-TW": "網路裝置", "zh-CN": "网络设备", en: "Network" },
  imaging: { "zh-TW": "影像裝置", "zh-CN": "影像设备", en: "Imaging" },
  toy: { "zh-TW": "玩具", "zh-CN": "玩具", en: "Toy" },
  health: { "zh-TW": "健康裝置", "zh-CN": "健康设备", en: "Health" },
  other: { "zh-TW": "藍牙裝置", "zh-CN": "蓝牙设备", en: "Bluetooth device" },
};

const ICONS = {
  audio: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.6" y="13" width="4.2" height="6.4" rx="1.8"/><rect x="17.2" y="13" width="4.2" height="6.4" rx="1.8"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.6" width="10" height="18.8" rx="2.2"/><path d="M10.6 5.4h2.8"/></svg>',
  computer: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.4"/><path d="M8.5 20h7M12 16.5V20"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/></svg>',
  mouse: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="5.5"/><path d="M12 6.5v3.5"/></svg>',
  peripheral: '<svg viewBox="0 0 24 24"><path d="M7 8.5H5.2a2.7 2.7 0 0 0 0 5.4H7M17 8.5h1.8a2.7 2.7 0 0 1 0 5.4H17"/><rect x="7" y="6" width="10" height="12" rx="4.5"/><path d="M10.5 10.5v2M12.5 10.5v2"/></svg>',
  wearable: '<svg viewBox="0 0 24 24"><rect x="8" y="6.5" width="8" height="11" rx="2.4"/><path d="M9.5 6.5 10 3h4l.5 3.5M9.5 17.5 10 21h4l.5-3.5"/><path d="M12 10v2.5l1.6 1"/></svg>',
  network: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.5 3.9 5.6 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.6-3.9-9S9.4 5.5 12 3Z"/></svg>',
  imaging: '<svg viewBox="0 0 24 24"><path d="M3.5 8.5h3l1.6-2h7.8l1.6 2h3v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-9Z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  toy: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="4"/><path d="M8 17v3M16 17v3M7.5 11.5h2M8.5 10.5v2"/><circle cx="16" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/></svg>',
  health: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.8c0 5.1-7.5 9.7-7.5 9.7Z"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M12 3.4v17.2l5.6-4.3L7.2 8.4M12 3.4l5.6 4.2L7.2 15.6"/></svg>',
};

const OPTIONS = widget.settings.get();
let opts = { showDisconnected: OPTIONS.showDisconnected !== false, showAddress: !!OPTIONS.showAddress };
let state = { supported: false, adapter: "unknown", devices: [], error: null, updated: 0 };
let loading = true;
let inFlight = false;

const list = $("list");
const empty = $("empty");
const emptyText = $("empty-text");
const tip = $("tip");
const retryBtn = $("retry");
const settingsBtn = $("settings");
const refreshBtn = $("refresh");
const sub = $("sub");

$("title").textContent = t(TXT.title);
retryBtn.textContent = t(TXT.retry);
settingsBtn.textContent = t(TXT.settings);
refreshBtn.title = t(TXT.refresh);

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function kindLabel(kind) {
  return t(KIND[kind] || KIND.other);
}

function tone(level) {
  if (level == null) return "";
  if (level <= 20) return "low";
  if (level <= 45) return "mid";
  return "";
}

function batteryCell(device) {
  if (device.battery == null) return "";
  const level = Math.max(0, Math.min(100, device.battery));
  const cls = tone(level);
  return `<span class="batt"><span class="pct ${cls}">${level}%</span><span class="meter"><i class="${cls}" style="width:${level}%"></i></span></span>`;
}

function row(device) {
  const kind = ICONS[device.kind] ? device.kind : "other";
  const name = device.name || kindLabel(kind);
  const detail = [kindLabel(kind), device.connected ? t(TXT.connected) : t(TXT.disconnected)];
  if (opts.showAddress && device.address) detail.push(device.address);
  const dot = device.connected ? `<span class="dot">●</span> ` : "";
  return `<li class="dev ${device.connected ? "on" : "off"}">
    <span class="ico" aria-hidden="true">${ICONS[kind]}</span>
    <span class="meta"><b title="${esc(device.name || name)}">${esc(name)}</b><em>${dot}${esc(detail.join(" · "))}</em></span>
    ${batteryCell(device)}
  </li>`;
}

function visibleDevices() {
  const items = state.devices.filter((d) => opts.showDisconnected || d.connected);
  items.sort((a, b) => Number(b.connected) - Number(a.connected) || String(a.name || "").localeCompare(String(b.name || "")));
  return items;
}

function setEmpty(text, buttons) {
  empty.hidden = false;
  list.hidden = true;
  emptyText.textContent = text;
  settingsBtn.hidden = !buttons.settings;
  retryBtn.hidden = !buttons.retry;
}

function render() {
  const items = visibleDevices();
  const connected = state.devices.filter((d) => d.connected).length;

  let heading;
  if (loading) heading = t(TXT.loading);
  else if (state.adapter === "off" || state.adapter === "disabled") heading = t(TXT.offShort);
  else if (!state.supported) heading = t(TXT.missingShort);
  else if (state.error) heading = t(TXT.errorShort);
  else if (!state.devices.length) heading = t(TXT.none);
  else heading = t(TXT.summary).replace("{on}", connected).replace("{all}", state.devices.length);
  sub.textContent = heading;

  if (!items.length) {
    list.innerHTML = "";
    list.classList.remove("more");
    tip.hidden = true;
    if (loading) setEmpty(t(TXT.loadingList), { settings: false, retry: false });
    else if (state.error) setEmpty(t(TXT.emptyError), { settings: false, retry: true });
    else if (state.adapter === "off" || state.adapter === "disabled") setEmpty(t(TXT.emptyOff), { settings: true, retry: false });
    else if (!state.supported) setEmpty(t(TXT.emptyMissing), { settings: false, retry: false });
    else if (!state.devices.length) setEmpty(t(TXT.empty), { settings: true, retry: false });
    else setEmpty(t(TXT.emptyHidden), { settings: false, retry: false });
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  const top = list.scrollTop;
  list.innerHTML = items.map(row).join("");
  list.scrollTop = top;
  tip.hidden = !state.error;
  tip.textContent = state.error ? `${t(TXT.errorShort)} · ${state.error}` : "";
  markOverflow();
}

function markOverflow() {
  list.classList.toggle("more", list.scrollHeight - list.clientHeight - list.scrollTop > 2);
}

async function load(force) {
  if (inFlight) return;
  inFlight = true;
  refreshBtn.classList.add("busy");
  try {
    const result = await widget.bluetooth.list({ refresh: !!force });
    state = {
      supported: !!result.supported,
      adapter: result.adapter || "unknown",
      devices: Array.isArray(result.devices) ? result.devices : [],
      error: result.error || null,
      updated: result.updated || 0,
    };
  } catch (error) {
    state.error = (error && error.message) || String(error);
  } finally {
    inFlight = false;
    loading = false;
    refreshBtn.classList.remove("busy");
    render();
  }
}

list.addEventListener("scroll", markOverflow);

refreshBtn.addEventListener("click", () => load(true));
retryBtn.addEventListener("click", () => load(true));
settingsBtn.addEventListener("click", () => {
  widget.shell.open("ms-settings:bluetooth").catch(() => {});
});
widget.settings.onChange((next) => {
  opts = {
    showDisconnected: next.showDisconnected !== false,
    showAddress: !!next.showAddress,
  };
  render();
});
widget.on("show", () => load(false));

render();
load(false);
setInterval(() => {
  if (document.visibilityState === "visible") load(false);
}, 30 * 1000);
