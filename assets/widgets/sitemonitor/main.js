const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let sites = [];   // { url, name, ok, ms, at, err }
let running = false;
let timer = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const interval = () => Math.max(30, Math.round(Number(widget.settings.get("interval")) || 60)) * 1000;
const timeout = () => Math.min(5000, Math.max(200, Math.round(Number(widget.settings.get("timeout")) || 2500)));
const cap = () => Math.max(2, Math.round(Number(widget.settings.get("max")) || 8));

const hostOf = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname;
  } catch (e) {
    return "";
  }
};
const pretty = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  const h = hostOf(s);
  return h || s;
};

function save() {
  widget.storage.set("sites", sites).catch(() => {});
}

function render() {
  const up = sites.filter((s) => s.ok).length;
  $("sum").textContent = sites.length
    ? L(`${up}/${sites.length} 正常`, `${up}/${sites.length} 正常`, `${up}/${sites.length} up`)
    : "";

  if (!sites.length) {
    $("list").innerHTML = `<li class="empty">${esc(L("還沒加站點，上面打個網址", "还没加站点，上面打个网址", "Add a host above to start watching"))}</li>`;
    return;
  }

  $("list").innerHTML = sites.map((s, i) => {
    const state = s.at == null ? "wait" : s.ok ? "ok" : "down";
    const tail = s.at == null
      ? L("等待", "等待", "waiting")
      : s.ok
        ? `${Math.round(Number(s.ms) || 0)} ms`
        : L("不通", "不通", "no reply");
    return `<li class="row is-${state}" data-i="${i}" title="${esc(s.url)}">
      <span class="dot"></span>
      <span class="txt"><span class="h">${esc(pretty(s.url))}</span><span class="m">${esc(tail)}</span></span>
      <button class="del" data-i="${i}" aria-label="remove">×</button>
    </li>`;
  }).join("");
}

async function checkAll() {
  if (running || !sites.length) return;
  running = true;
  $("refresh").classList.add("is-busy");
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const host = hostOf(s.url);
    if (!host) continue;
    try {
      const r = await widget.system.ping(host, { timeout: timeout() });
      s.ok = !!(r && r.ok);
      s.ms = r && Number.isFinite(r.ms) ? r.ms : null;
      s.at = Date.now();
      s.err = s.ok ? "" : L("沒有回應", "没有回应", "no reply");
    } catch (e) {
      s.ok = false;
      s.ms = null;
      s.at = Date.now();
      s.err = String(e.message || e);
    }
    render();
    if (i < sites.length - 1) await new Promise((r) => setTimeout(r, 1050));   // one ping per second
  }
  save();
  running = false;
  $("refresh").classList.remove("is-busy");
  $("hint").textContent = L("剛剛檢查完一輪", "刚刚检查完一轮", "Round finished just now");
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.hidden) checkAll();
  }, interval());
}

function addSite(raw) {
  const url = String(raw || "").trim();
  if (!url) return false;
  if (!hostOf(url)) return false;
  if (sites.length >= cap()) return false;
  if (sites.some((s) => hostOf(s.url) === hostOf(url))) return false;
  sites.push({ url: url, name: pretty(url), ok: false, ms: null, at: null, err: "" });
  save();
  render();
  checkAll();
  return true;
}

$("title").textContent = L("站點監控", "站点监控", "Site monitor");
$("host").placeholder = L("網址或主機名", "网址或主机名", "host or URL");
$("hint").textContent = L("每輪依序 ping，遇到不通會標紅", "每轮依序 ping，遇到不通会标红", "Pinged in turn; a red row means it's not answering");

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const ok = addSite($("host").value);
  if (ok) {
    $("host").value = "";
  } else {
    $("hint").textContent = L("網址怪怪的，或已經在清單裡 / 滿了", "网址怪怪的，或已经在清单里 / 满了", "Bad host, already listed, or the list is full");
  }
});

$("refresh").onclick = () => checkAll();

$("list").onclick = (e) => {
  const del = e.target.closest(".del");
  if (del) {
    sites.splice(Number(del.dataset.i), 1);
    save();
    render();
    return;
  }
  const row = e.target.closest(".row");
  if (!row) return;
  const s = sites[Number(row.dataset.i)];
  if (s) widget.shell.open(s.url).catch(() => {});
};

widget.settings.onChange(() => { schedule(); render(); });

widget.storage.get("sites").then((v) => {
  if (Array.isArray(v)) {
    sites = v.filter((s) => s && hostOf(s.url)).slice(0, cap()).map((s) => ({
      url: String(s.url), name: String(s.name || pretty(s.url)), ok: !!s.ok,
      ms: Number.isFinite(s.ms) ? s.ms : null, at: Number.isFinite(s.at) ? s.at : null, err: String(s.err || ""),
    }));
  }
  render();
  schedule();
  if (sites.length) checkAll();
}).catch((e) => widget.log(`sitemonitor: load ${e.message}`));

widget.on("unload", () => clearInterval(timer));
widget.on("summon", () => { render(); checkAll(); });
