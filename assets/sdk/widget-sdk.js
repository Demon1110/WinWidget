/*! WinWidget SDK v1. Loaded automatically into every widget page as `window.widget`. */
(function () {
  "use strict";

  const boot = window.__FW_BOOT__ || {};
  const host = window.chrome && window.chrome.webview;
  const root = document.documentElement;

  const state = {
    settings: boot.settings || {},
    appearance: boot.appearance || {},
    locked: !!boot.locked,
    layer: boot.layer || "desktop",
    clickThrough: !!boot.clickThrough,
    edit: !!(boot.state && boot.state.edit),
    label: (boot.state && boot.state.label) || "",
    visible: boot.visible !== false,
  };

  // ── messaging ──────────────────────────────────────────────
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();

  function send(m, p) {
    if (host) host.postMessage(JSON.stringify(p === undefined ? { m } : { m, p }));
  }

  function call(m, p) {
    return new Promise((resolve, reject) => {
      if (!host) return reject(new Error("WinWidget host not available"));
      const id = ++seq;
      pending.set(id, { resolve, reject });
      host.postMessage(JSON.stringify({ id, m, p }));
    });
  }

  /** call() with File objects attached: the host cannot read their paths, so it answers []. */
  function callWithFiles(m, p, files) {
    return new Promise((resolve, reject) => {
      if (!host) return reject(new Error("WinWidget host not available"));
      const id = ++seq;
      pending.set(id, { resolve, reject });
      host.postMessage(JSON.stringify({ id, m, p: { ...p, files: (files || []).map((f) => f.name) } }));
    });
  }

  function on(event, fn) {
    let set = handlers.get(event);
    if (!set) handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** A rectangle in the { left, top, width, height } shape the host reads. */
  function rectOf(rect) {
    const r = rect || {};
    return {
      left: Number(r.left ?? r.x) || 0,
      top: Number(r.top ?? r.y) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
    };
  }

  /** Whatever the caller has — data URL, bare base64, path, or a picture object — as one string. */
  function imageSource(image) {
    if (image == null) return "";
    if (typeof image === "string") return image;
    if (image.__dataUrl) return String(image.__dataUrl);
    if (image.url) return String(image.url);
    return String(image);
  }

  function emit(event, data) {
    const set = handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  // A drag or a resize grip produces a burst of sizes; the page only wants the one it settles on.
  let resizePending = null;
  let resizeTimer = 0;
  function queueResize(size) {
    resizePending = size;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const s = resizePending;
      resizePending = null;
      if (s) emit("resize", { width: Number(s.width) || 0, height: Number(s.height) || 0 });
    }, 80);
  }

  if (host) {
    host.addEventListener("message", (e) => {
      const msg = e.data || {};
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.e !== undefined) p.reject(new Error(msg.e));
        else p.resolve(msg.r);
        return;
      }
      const d = msg.d;
      switch (msg.ev) {
        case "settings":
          state.settings = foldSettings(d || {});
          emit("settings", { ...state.settings });
          break;
        case "appearance":
          state.appearance = d || {};
          setThemeLink(state.appearance.themeHref);
          setStyleText("__fw_theme", state.appearance.themeCss);
          setStyleText("__fw_user", state.appearance.userCss);
          applyState();
          emit("appearance", { ...state.appearance });
          break;
        case "state":
          Object.assign(state, d);
          applyState();
          emit("state", { locked: state.locked, layer: state.layer, clickThrough: state.clickThrough });
          break;
        case "system":
          dispatchSystem(d || {});
          break;
        case "identify":
          identify();
          break;
        // ── lifecycle ───────────────────────────────────────────
        case "show":
          state.visible = true;
          emit("show", { from: (d && d.from) || "api", visible: true, initial: false });
          break;
        case "hide":
          state.visible = false;
          emit("hide", { from: (d && d.from) || "api", visible: false, initial: false });
          break;
        case "resize":
          queueResize(d || {});
          break;
        case "unload":
          emit("unload", { kill: !!(d && d.kill) });
          break;
        default:
          if (msg.ev) emit(msg.ev, d);
      }
    });
  }

  // ── page state ─────────────────────────────────────────────
  function applyState() {
    root.dataset.theme = state.appearance.theme || "";
    root.dataset.style = state.appearance.style || "transparent";
    root.dataset.shadow = state.appearance.shadow ? "on" : "off";
    root.dataset.locked = String(state.locked);
    root.dataset.layer = state.layer;
    root.dataset.edit = String(state.edit);
    const label = document.querySelector(".fw-edit-label");
    if (label) label.textContent = state.label;
  }

  // "Locate" from the control center: a ring pulses around the card.
  function identify() {
    const ring = document.createElement("div");
    ring.className = "fw-identify";
    document.body.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove());
  }

  function setStyleText(id, css) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      (document.head || root).appendChild(el);
    }
    el.textContent = css || "";
  }

  function setThemeLink(href) {
    const link = document.getElementById("__fw_theme_link");
    if (link && href && link.getAttribute("href") !== href) link.setAttribute("href", href);
  }

  root.lang = boot.locale || navigator.language;
  applyState();

  // ── language ───────────────────────────────────────────────
  // t({ "zh-TW": "時鐘", "zh-CN": "时钟", en: "Clock" }) → the best match for the user's language.
  const locale = (boot.locale || navigator.language || "en").toLowerCase();
  function candidates() {
    const list = [locale];
    if (locale.startsWith("zh")) {
      const hans = /^zh-(cn|sg|hans)/.test(locale);
      list.push(...(hans ? ["zh-cn", "zh-hans", "zh", "zh-tw"] : ["zh-tw", "zh-hant", "zh-hk", "zh", "zh-cn"]));
    } else if (locale.includes("-")) list.push(locale.split("-")[0]);
    list.push("en");
    return list;
  }
  const order = candidates();
  function t(dict) {
    if (dict == null || typeof dict !== "object") return dict;
    const keys = Object.keys(dict);
    for (const c of order) {
      const k = keys.find((x) => x.toLowerCase() === c);
      if (k) return dict[k];
    }
    return dict[keys[0]];
  }

  /** A setting that arrived as { "zh-TW": …, "zh-CN": …, en: … } → the user's own string. */
  function foldValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const keys = Object.keys(value);
    if (!keys.length || !keys.every((k) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(k))) return value;
    const picked = t(value);
    return picked == null ? "" : picked;
  }
  function foldSettings(values) {
    const out = {};
    for (const k of Object.keys(values || {})) out[k] = foldValue(values[k]);
    return out;
  }
  state.settings = foldSettings(state.settings);

  // ── system stats ───────────────────────────────────────────
  const sysSubs = new Set();

  function syncSystem() {
    const subs = [...sysSubs];
    const topics = [...new Set(subs.flatMap((s) => s.topics))];
    if (!topics.length) return call("system.unsubscribe");
    const interval = Math.min(...subs.map((s) => s.interval));
    return call("system.subscribe", { topics, interval });
  }

  function dispatchSystem(data) {
    for (const s of [...sysSubs]) {
      const part = {};
      for (const t of s.topics) if (data[t] !== undefined) part[t] = data[t];
      if (Object.keys(part).length) {
        try { s.cb(part); } catch (e) { console.error(e); }
      }
    }
  }

  function subscribe(topics, cb, options) {
    if (typeof topics === "string") topics = [topics];
    const sub = { topics, cb, interval: (options && options.interval) || 1000 };
    sysSubs.add(sub);
    syncSystem()
      .then((snapshot) => snapshot && dispatchSystem(snapshot))
      .catch((e) => console.error("widget.system.subscribe:", e.message));
    return () => {
      sysSubs.delete(sub);
      syncSystem().catch(() => {});
    };
  }

  // ── volume ─────────────────────────────────────────────────
  // onChange subscribes on the first listener; WinWidget pushes every change (volume keys too).
  const audioListeners = new Set();
  function onAudio(fn) {
    audioListeners.add(fn);
    if (audioListeners.size === 1) {
      call("audio.subscribe").then((s) => s && fn(s)).catch((e) => console.error("widget.audio.onChange:", e.message));
    } else call("audio.get").then((s) => fn(s)).catch(() => {});
    return () => {
      audioListeners.delete(fn);
      if (!audioListeners.size) call("audio.unsubscribe").catch(() => {});
    };
  }
  on("audio", (s) => { for (const fn of [...audioListeners]) { try { fn(s); } catch (e) { console.error(e); } } });

  // ── what's playing ─────────────────────────────────────────
  // Same pattern: the first listener subscribes, Windows reports every change.
  const mediaListeners = new Set();
  function onMedia(fn) {
    mediaListeners.add(fn);
    if (mediaListeners.size === 1) {
      call("media.subscribe").then((s) => s && fn(s)).catch((e) => console.error("widget.media.onChange:", e.message));
    } else call("media.get").then((s) => fn(s)).catch(() => {});
    return () => {
      mediaListeners.delete(fn);
      if (!mediaListeners.size) call("media.unsubscribe").catch(() => {});
    };
  }
  on("media", (s) => { for (const fn of [...mediaListeners]) { try { fn(s); } catch (e) { console.error(e); } } });
  /** Where playback is now, in ms: the reported position moves on by itself while playing. */
  function mediaPosition(s) {
    if (!s || !s.available) return 0;
    const p = s.playing ? s.position + Math.max(0, Date.now() - s.updated) : s.position;
    return s.duration > 0 ? Math.min(p, s.duration) : p;
  }

  // ── network ────────────────────────────────────────────────
  async function hostFetch(url, options) {
    const o = options || {};
    let body = o.body;
    if (body != null && typeof body !== "string") body = JSON.stringify(body);
    const target = String(new URL(url, location.href));
    let r;
    try {
      r = await call("net.fetch", {
        url: target,
        method: o.method || "GET",
        headers: o.headers || {},
        body: body == null ? undefined : body,
        as: o.as === "base64" ? "base64" : "text",
      });
    } catch (e) {
      // Say which address failed: "HTTP 404" alone leaves the card unhelpful to debug.
      throw new Error(`${e.message} (${target})`);
    }
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      url: r.url,
      headers: r.headers,
      body: r.body,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    };
  }

  // ── notifications ──────────────────────────────────────────
  // notify("text") or notify({ title, body, at, tag }); `at` (Date or ms) books it for later.
  function notify(o) {
    const n = typeof o === "string" ? { body: o } : o || {};
    const at = n.at instanceof Date ? n.at.getTime() : n.at;
    return call("notify.show", {
      title: n.title == null ? undefined : String(n.title),
      body: n.body == null ? "" : String(n.body),
      at: typeof at === "number" && isFinite(at) ? at : undefined,
      tag: n.tag == null ? undefined : String(n.tag),
    });
  }
  /** Cancels the booked notification with this tag, or all of this widget's bookings. */
  notify.cancel = (tag) => call("notify.cancel", tag == null ? {} : { tag: String(tag) });
  Object.freeze(notify);

  // ── dragging, resizing, context menu ───────────────────────
  // Dragging starts once the mouse moves a few pixels, so plain clicks still reach the page.
  const NO_DRAG = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false']), [data-no-drag], [data-ww-nodrag], [data-ww-close], [role='slider']";
  // 约定：任何元素标上 data-ww-drag，它连同整棵子树就是一块"拖拽把位"（标题条、整块面板都行）。
  // 按下即拖，页面不用写一行 mousedown；子树里标 data-ww-nodrag 的、或本身是按钮/输入框/链接的，
  // 这次按键仍归页面（点 × 不会变拖拽）。只对组件自己开的窗口（draggable: true）生效：卡片本来就
  // 整张能拖，不必也不该由页面再指一个把位；那道闸在宿主侧。
  const DRAG_GRIP = "[data-ww-drag]";
  const IS_CUSTOM = (boot.windowType || "main") === "custom";
  let down = null;

  /** 按下把位：自定义窗口交给系统的 SC_MOVE，卡片走它自己的自绘拖动。 */
  function beginDrag() {
    return IS_CUSTOM ? call("win.startDrag") : send("window.drag");
  }

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(".fw-resize")) {
      if (!state.locked) { e.preventDefault(); send("window.resize"); }
      return;
    }
    if (state.locked) return;
    if (e.target.closest && e.target.closest(NO_DRAG)) {
      // A fader, a field or a slider: the page keeps this press. Saying so stops the host's own
      // "the page must be dead" fallback from dragging the whole card when the pointer slides.
      send("window.press");
      return;
    }
    if (IS_CUSTOM && e.target.closest && e.target.closest(DRAG_GRIP)) {
      e.preventDefault();       // 也别让 WebView 起一次自带的文字选区拖拽
      beginDrag();
      return;
    }
    down = { x: e.screenX, y: e.screenY };
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (!down) return;
    if ((e.buttons & 1) === 0) { down = null; return; }
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) {
      // how far the pointer already went, in screen pixels: the card catches up, so the point
      // that was grabbed stays under the pointer
      const r = window.devicePixelRatio || 1;
      send("window.drag", { dx: (e.screenX - down.x) * r, dy: (e.screenY - down.y) * r });
      down = null;
    }
  }, true);

  document.addEventListener("mouseup", () => { down = null; }, true);

  // 约定：任何元素标上 data-ww-close，点一下就把自己这个窗口关掉——卡片上等于收起
  // （托盘还能叫回来），自定义窗口里等于关掉它自己。属性值可选，当关闭原因写进
  // `windows.on("closed")` 的 reason（默认 "api"）。它也自动豁免拖拽，所以放在把位里
  // 也不会先被拖一下再关。
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("[data-ww-close]");
    if (el) {
      e.preventDefault();
      closeSelf(el.getAttribute("data-ww-close") || "api");
    }
  }, true);

  /** 关掉当前窗口：自定义窗口走 `win.close`（能带原因），卡片走 `window.close`（收起）。 */
  function closeSelf(reason) {
    if (!IS_CUSTOM) return call("window.close");
    const params = { win: boot.windowId || 0 };
    if (reason && reason !== "api") params.reason = String(reason);
    return call("win.close", params);
  }
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target.closest && e.target.closest("[data-no-menu]")) return;
    send("window.menu");
  }, true);

  // ── errors: always to the WinWidget log; in developer mode also on the card ──
  let errorBudget = 20;
  let errorCount = 0;
  function report(msg, where) {
    if (errorBudget-- > 0) send("log", { level: "error", msg: where ? `${msg}  ${where}` : msg });
    if (boot.developer) showError(msg, where);
  }
  window.addEventListener("error", (e) => {
    const file = (e.filename || "").replace(location.origin + "/", "");
    report(String(e.message).replace(/^Uncaught /, ""), file ? `${file}:${e.lineno}` : "");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const where = r && r.stack ? ((r.stack.match(/\/([^/\s)]+:\d+):\d+\)?\s*$/m) || [])[1] || "") : "";
    report("(in promise) " + ((r && r.message) || r), where);
  });

  // A bar at the bottom of the card; click it to open DevTools, × to dismiss.
  function showError(msg, where) {
    errorCount++;
    let bar = document.querySelector(".fw-error");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "fw-error";
      bar.setAttribute("role", "alert");
      bar.setAttribute("data-no-drag", "");
      bar.title = "Click to open DevTools (F12)";
      bar.innerHTML = '<div class="fw-error-text"><span class="fw-error-msg"></span><span class="fw-error-at"></span></div>' +
        '<span class="fw-error-n"></span><button class="fw-error-x" aria-label="Dismiss">×</button>';
      bar.addEventListener("click", (e) => {
        if (e.target.closest(".fw-error-x")) { bar.remove(); errorCount = 0; return; }
        send("window.devtools");
      });
      (document.body || root).appendChild(bar);
    }
    bar.querySelector(".fw-error-msg").textContent = msg;
    bar.querySelector(".fw-error-at").textContent = where || "";
    bar.querySelector(".fw-error-n").textContent = errorCount > 1 ? `×${errorCount}` : "";
  }

  // ── content that grows with the card ───────────────────────
  // widget.json "size": { "grow": 0–1 }. Made bigger than its default size in both directions,
  // the whole card is magnified (CSS zoom on <body>): in step with the card at 1, less at 0.5,
  // and the layout gets the rest of the room. Smaller than the default, nothing changes:
  // that's the layout's job.
  const grow = (boot.size && boot.size.grow) || 0;
  let sizeScale = 1;
  function updateSizeScale() {
    const r = document.body.getBoundingClientRect();
    const s = Math.max(1, Math.min(r.width / boot.size.width, r.height / boot.size.height));
    const next = Math.round(Math.min(3, s ** grow) * 50) / 50;
    if (next === sizeScale) return;
    sizeScale = next;
    root.style.setProperty("--w-size-scale", String(next));
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (grow > 0) {
      updateSizeScale();
      // the zoom changes the card's own layout size, so it's applied a frame later, outside the
      // observer's callback (otherwise the browser reports a "ResizeObserver loop")
      let pending = 0;
      new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(updateSizeScale); }).observe(document.body);
    }
    // 只有卡片真的能被拖着改大小：自定义窗口（含弹框）的 `window.resize` 没有意义，宿主会
    // 直接丢掉，挂上去就是一个点了没反应的右下角把位——光标变了、却什么都不发生。
    if (boot.resizable && !IS_CUSTOM) {
      const grip = document.createElement("div");
      grip.className = "fw-resize";
      document.body.appendChild(grip);
    }
    const label = document.createElement("div");
    label.className = "fw-edit-label";
    label.textContent = state.label;
    document.body.appendChild(label);
    send("ready");
    // "ready" fires one task after the page's own DOMContentLoaded handlers, so a widget that
    // subscribes there still hears it. A card that is already on screen reports the show it woke
    // up in, which is what makes the first show indistinguishable from any later one.
    setTimeout(() => {
      emit("ready", { visible: state.visible });
      if (state.visible) {
        emit("show", { from: boot.showFrom || "startup", visible: true, initial: true });
      }
    }, 0);
  });

  // ── small helpers every widget keeps redefining ───────────────────────────
  // These live in the SDK so widgets do not ship their own `$`, `esc`, `pad` and
  // date/byte helpers over and over. They are pure and side-effect free.
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const clampInt = (value, lo, hi, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const startOfDay = (d) => {
    const x = d instanceof Date ? new Date(d) : new Date(d);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate());
  };
  const addDays = (d, n) => {
    const x = d instanceof Date ? new Date(d) : new Date(d);
    x.setDate(x.getDate() + Number(n || 0));
    return x;
  };
  const dayKey = (d) => {
    const x = d instanceof Date ? d : new Date(d || Date.now());
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const hhmm = (ms, tz) => {
    const d = new Date(ms || Date.now());
    const opts = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    if (tz) opts.timeZone = String(tz);
    try {
      return new Intl.DateTimeFormat(locale, opts).format(d);
    } catch (_) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  };
  const mmss = (ms) => {
    const s = Math.max(0, Math.round(Number(ms) || 0) / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
  };
  const fmtBytes = (bytes) => {
    let n = Number(bytes) || 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let u = 0;
    while (n >= 1024 && u < units.length - 1) {
      n /= 1024;
      u += 1;
    }
    return `${n >= 100 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
  };
  const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : rid());
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
  function debounce(fn, wait = 150) {
    let timer = 0;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }
  function throttle(fn, wait = 150) {
    let last = 0;
    let timer = 0;
    let lastArgs = null;
    const fire = () => {
      timer = 0;
      last = Date.now();
      fn(...lastArgs);
    };
    return (...args) => {
      lastArgs = args;
      const since = Date.now() - last;
      if (since >= wait) {
        fire();
      } else if (!timer) {
        timer = setTimeout(fire, wait - since);
      }
    };
  }
  const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });
  const zh = locale.toLowerCase().startsWith("zh");
  const hans = /^zh-(cn|sg|hans|mo)/i.test(locale);
  const toastTimers = new Map();
  function toast(el, message, ms) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimers.get(el));
    toastTimers.set(
      el,
      setTimeout(() => {
        el.hidden = true;
        toastTimers.delete(el);
      }, Number(ms) || 1600),
    );
  }

  // ── sharp: the chain stays in the page, the pixels are processed by the host ─────────
  const SHARP_REFUSED = ["tint", "median", "composite", "trim", "normalize"];

  /** Base64 bytes (the host's answer to `sharp.run … buffer`) as a Uint8Array. */
  function base64Bytes(text) {
    const bin = atob(String(text || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function sharpChain(input, options) {
    const ops = [];
    let format = (options && options.format) || "png";
    let quality = (options && options.quality) || 0;
    const source = (() => {
      if (input == null) return { create: { width: 1, height: 1 } };
      if (typeof input === "string") {
        return /^data:/i.test(input) ? { data: input } : { path: input };
      }
      if (input && typeof input === "object" && (input.width || input.height || input.create)) {
        return input.create ? { create: input.create } : { create: input };
      }
      if (input && input.__dataUrl) return { data: input.__dataUrl };
      return { data: imageSource(input) };
    })();

    const run = (output) => call("sharp.run", { input: source, ops, output });

    const api = {
      resize: (width, height) => {
        ops.push({
          op: "resize",
          width: width == null ? undefined : Number(width),
          height: height == null ? undefined : Number(height),
        });
        return api;
      },
      rotate: (angle) => { ops.push({ op: "rotate", angle: Number(angle) || 0 }); return api; },
      flip: () => { ops.push({ op: "flip" }); return api; },
      flop: () => { ops.push({ op: "flop" }); return api; },
      extract: (rect) => { ops.push({ op: "extract", ...rectOf(rect) }); return api; },
      extend: (edges) => { ops.push({ op: "extend", ...(edges || {}) }); return api; },
      grayscale: () => { ops.push({ op: "grayscale" }); return api; },
      negate: () => { ops.push({ op: "negate" }); return api; },
      blur: (sigma) => { ops.push({ op: "blur", sigma: Number(sigma) || 1 }); return api; },
      sharpen: (sigma, flat, jagged) => {
        ops.push({
          op: "sharpen",
          sigma: Number(sigma) || 1,
          threshold: Number(flat) || 0,
          jagged: Number(jagged) || 0,
        });
        return api;
      },
      threshold: (level) => { ops.push({ op: "threshold", threshold: Number(level) || 128 }); return api; },
      gamma: (value) => { ops.push({ op: "gamma", gamma: Number(value) || 1 }); return api; },
      flatten: (background) => { ops.push({ op: "flatten", background: background && String(background) }); return api; },
      jpeg: (opts) => {
        format = "jpeg";
        if (opts && opts.quality) quality = Number(opts.quality);
        return api;
      },
      png: () => { format = "png"; return api; },
      webp: () => { format = "webp"; return api; },
      tiff: () => { format = "tiff"; return api; },
      clone: () => sharpChain(input, options),
      /** The processed picture as a Uint8Array in the chosen format. */
      toBuffer: () =>
        run({ format, target: "buffer", quality: quality || undefined }).then((r) => base64Bytes(r.data)),
      toUint8Array: () => api.toBuffer(),
      /** Writes it to `path`; answers { format, width, height, path }. */
      toFile: (path) =>
        run({ format, target: "file", path: String(path), quality: quality || undefined }),
      /** { format, width, height } of the source, after the ops that were queued. */
      metadata: () => run({ format, target: "metadata" }),
    };
    for (const name of SHARP_REFUSED) {
      api[name] = () =>
        Promise.reject(new Error("sharp." + name + " is not available in WinWidget"));
    }
    return api;
  }

  // ── windows：窗口身份、集合、通信 ─────────────────────────────
  // 一个组件可以开好几个窗口。这里登记 id ↔ key，让「设置窗还开着吗」「把消息发给兄弟窗口」
  // 这类问题不用页面自己拿变量记；handle 的方法集和 utools 的 BrowserWindow 一致，
  // 老代码 `win.setSize(...)` 照旧能用。
  const winHandles = new Map(); // id → handle
  const winKeys = new Map(); // key → handle

  function makeWinHandle(seed) {
    const s = seed || {};
    const opt = s.options || s;
    const state = {
      id: Number(s.id) || 0,
      key: s.key == null ? "" : String(s.key),
      kind: s.kind || "window",
      title: s.title == null ? "" : String(s.title),
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      visible: s.show !== false,
      destroyed: false,
      loaded: false,
    };
    const hooks = { loaded: [], closed: [], message: [] };
    let ready = null;
    let settle = null;
    const closed = new Promise((resolve) => { settle = resolve; });
    const fired = { closed: false };

    function mirror(v) {
      if (!v || typeof v !== "object") return;
      for (const k of ["id", "key", "kind", "title", "width", "height", "x", "y", "visible", "destroyed", "loaded"]) {
        if (v[k] !== undefined) state[k] = v[k];
      }
    }

    /** 第一次用到才建窗；之后每次调用都等同一次「等它建好」。 */
    function ensure() {
      if (ready) return ready;
      ready = call("win.create", { file: opt.html || opt.file || "", options: opt })
        .then((reply) => {
          if (reply && reply.id) {
            state.id = reply.id;
            mirror(reply.state);
            winHandles.set(state.id, api);
            if (state.key) winKeys.set(state.key, api);
          }
          return state.id;
        });
      return ready;
    }

    function invoke(method, params) {
      return ensure().then(() =>
        call("win." + method, Object.assign({ win: state.id }, params || {})).then((reply) => {
          if (reply && reply.unsupported) {
            if (!opt.quiet) console.warn("window." + method + "：", reply.unsupported);
            return undefined;
          }
          mirror(reply);
          return reply;
        })
      );
    }

    const api = {
      get id() { return state.id; },
      get key() { return state.key; },
      get kind() { return state.kind; },
      get title() { return state.title; },
      /** 窗口关掉时 resolve：{ reason, button, value, result }。 */
      get closed() { return closed; },
      /** 页面 ready 的 Promise（`createBrowserWindow` 的 callback 等的是同一件事）。 */
      get loaded() { return ensure(); },
      show() { state.visible = true; return invoke("show"); },
      showInactive() { state.visible = true; return invoke("showInactive"); },
      hide() { state.visible = false; return invoke("hide"); },
      focus() { return invoke("focus"); },
      close(reason) {
        state.destroyed = true;
        return invoke("close", reason ? { reason: String(reason) } : {});
      },
      destroy() { state.destroyed = true; return invoke("destroy"); },
      getSize() { return [state.width, state.height]; },
      setSize(w, h) { return invoke("setSize", { width: Number(w), height: Number(h) }); },
      getBounds() { return { x: state.x, y: state.y, width: state.width, height: state.height }; },
      setBounds(b) { return invoke("setBounds", b || {}); },
      getPosition() { return [state.x, state.y]; },
      setPosition(x, y) { return invoke("setPosition", { x: Number(x), y: Number(y) }); },
      setAlwaysOnTop(on) { return invoke("setAlwaysOnTop", { on: on !== false }); },
      setOpacity(o) { return invoke("setOpacity", { opacity: Number(o) }); },
      setTitle(t) { return invoke("setTitle", { title: t == null ? "" : String(t) }); },
      isVisible() { return state.visible; },
      isDestroyed() { return state.destroyed; },
      on(hook, fn) {
        if (hooks[hook] && typeof fn === "function") hooks[hook].push(fn);
        return api;
      },
      off(hook, fn) {
        const list = hooks[hook];
        if (list) {
          const at = list.indexOf(fn);
          if (at >= 0) list.splice(at, 1);
        }
        return api;
      },
      webContents: Object.freeze({
        get id() { return state.id; },
        send(channel, ...args) { return invoke("send", { channel: String(channel), args }); },
        executeJavaScript(code) { return invoke("executeJavaScript", { code: String(code == null ? "" : code) }); },
        reload() { return invoke("reload"); },
      }),
    };

    function fire(hook, arg) {
      for (const fn of hooks[hook].slice()) {
        try {
          fn(arg);
        } catch (e) {
          console.error("window.on(" + hook + "):", e);
        }
      }
    }

    api.__ensure = ensure;
    api.__loaded = function (snapshot) {
      state.loaded = true;
      mirror(snapshot);
      fire("loaded", api);
    };
    api.__closed = function (detail) {
      if (fired.closed) return;
      fired.closed = true;
      state.destroyed = true;
      state.visible = false;
      if (state.id) winHandles.delete(state.id);
      if (state.key) winKeys.delete(state.key);
      const result = (detail && detail.result) || {};
      settle({
        reason: (detail && detail.reason) || "api",
        button: result.button,
        value: result.value,
        result,
      });
      fire("closed", { reason: (detail && detail.reason) || "api", result });
    };
    api.__message = function (payload) {
      fire("message", payload);
    };
    return api;
  }

  /** 给宿主那条 `win.closed` / `win.loaded` / `ipc` 消息找到对应的 handle。 */
  on("win.loaded", (d) => {
    const h = d && winHandles.get(d.id);
    if (h) h.__loaded(d.state);
  });
  on("win.closed", (d) => {
    const h = d && winHandles.get(d.id);
    if (h) h.__closed(d);
  });
  // 谁发来的消息都走同一个出口：`widget.on("message", ({ from, channel, args }) => …)`。
  on("ipc", (d) => {
    if (d && d.channel) emit("message", d);
  });

  const windowsApi = Object.freeze({
    /**
     * 开一个窗口，立刻拿到 handle（id 在保证建好后才有值，方法会自己等）。
     * `{ key, reuse, html, width, height, title, showTitle, frame, draggable, closeOnEsc,
     *   closeOnBlur, closeOnOutsideClick, autoClose, modal, opacity, transparent,
     *   backgroundColor, alwaysOnTop, anchor, offset, fitContent, animation, theme }`
     * 同 key 且 reuse（默认 true）时返回**已有的那个窗口**，把它叫到前面。
     */
    open(options) {
      const opt = Object.assign({}, options || {});
      const handle = makeWinHandle(opt);
      if (handle.key) winKeys.set(handle.key, handle);
      // 调 open 就是「现在开」：不等第一次方法调用才建窗。
      handle.__ensure();
      return handle;
    },
    /** 已经开着的窗口，按 id 或 key 找；没开过返回 null（同步）。 */
    get(ref) {
      if (typeof ref === "number") return winHandles.get(ref) || null;
      if (ref == null) return null;
      const text = String(ref);
      const byKey = winKeys.get(text);
      if (byKey) return byKey;
      const num = Number(text);
      return Number.isFinite(num) ? winHandles.get(num) || null : null;
    },
    /** 和 get 一样，但会问宿主一次（页面刷新后也能找回之前开的窗口）。 */
    find(ref) {
      return call("win.get", ref == null ? {} : typeof ref === "number" ? { win: ref } : { key: String(ref) })
        .then((state) => {
          if (!state || !state.id) return null;
          const known = winHandles.get(state.id);
          if (known) {
            known.__loaded(state);
            return known;
          }
          const handle = makeWinHandle(state);
          handle.__loaded(state);
          winHandles.set(state.id, handle);
          if (state.key) winKeys.set(state.key, handle);
          return handle;
        });
    },
    has(ref) {
      if (typeof ref === "string" && this.get(ref)) return Promise.resolve(true);
      return call("win.has", typeof ref === "number" ? { win: ref } : { key: String(ref) });
    },
    /** 本组件还活着的窗口：[{id, key, kind, title, visible, focused, parent, created}]。 */
    list() {
      return call("win.list").then((rows) => (Array.isArray(rows) ? rows : []));
    },
    /** 定向发消息：目标可以是 id，也可以是 key（兄弟窗口，不限于父子）。 */
    post(to, channel, ...args) {
      return call("win.post", {
        to: typeof to === "number" ? to : String(to),
        channel: String(channel),
        args,
      });
    },
    /** 广播给本组件所有窗口（含卡片），但跳过自己。 */
    broadcast(channel, ...args) {
      return call("win.broadcast", { channel: String(channel), args });
    },
    /** 关一个窗口；reason 会出现在它的 closed 事件里。 */
    close(ref, reason) {
      const known = this.get(ref);
      const target = known && known.id ? known.id : ref;
      const params = typeof target === "number" ? { win: target } : { win: String(target) };
      if (reason) params.reason = String(reason);
      return call("win.close", params);
    },
    /** 按 kind / key 批量关；不带参数就把这个组件的窗口全关掉。 */
    closeAll(filter) {
      return call("win.closeAll", filter || {});
    },
    /** `windows.on("closed", ({id, key, reason, result}) => …)`，以及 "message"。 */
    on(event, fn) {
      if (typeof fn === "function" && (event === "message" || event === "closed" || event === "opened")) {
        return on(event === "closed" ? "win.closed" : event === "message" ? "ipc" : "win.loaded", fn);
      }
      return () => {};
    },
  });

  // ── dialog：宿主内置弹框 ─────────────────────────────────────
  // 弹框就是 kind 为 alert / confirm / prompt / toast 的窗口，所以它天生能被
  // `windows.list` 看到、被 `windows.close` 关掉，也不会多出一套生命周期。
  // 这里只负责把「用户点的是哪个按钮」翻译成一句好用的返回值。
  function openDialog(kind, options) {
    const opt = Object.assign({}, options || {});
    opt.kind = kind;
    return windowsApi.open(opt);
  }

  function awaiting(handle, okId) {
    return handle.closed.then((r) => {
      const button = r.button == null ? "" : String(r.button);
      return {
        button: button,
        value: r.value,
        reason: r.reason || "",
        confirmed: button === okId,
      };
    });
  }

  const dialogApi = Object.freeze({
    /**
     * alert({ title, content, icon, okText, autoClose, theme, accentColor, width, … })
     * → Promise<{ button, reason }>；关掉窗口（× / Esc / 超时）也算看过。
     *
     * `icon` 是左上角那个徽标：内置名（info / success / warn / error / bell / question /
     * clock / sparkle / lock / trash / heart / star）、`{ svg }` 内联 SVG、`{ url }` 图片、
     * `{ text }` 一个字符；`""` 不要徽标。底色用 `iconColor` 换。
     *
     * 有原生边框（`frame: true`）时，标题栏左上角那个小图标用 `windowIcon`：组件包内的
     * 相对路径或 `data:` 位图（SVG 不行，Windows 要像素）。
     *
     * 底板和整窗分开调：`backgroundColor` 换底板底色、`backgroundOpacity` 只淡底板（文字
     * 保持清晰），`opacity` 淡的是整扇面（底板 + 内容），三者互不影响，底板最终透明度是
     * `opacity × backgroundOpacity`。全透明的 `backgroundColor` 当没给，底板跟主题。
     */
    alert(options) {
      const opt = typeof options === "string" ? { content: options } : options || {};
      return awaiting(openDialog("alert", opt), opt.okButton || "ok").then((r) => ({
        button: r.button || "ok",
        reason: r.reason,
      }));
    },
    /**
     * confirm({ title, content, okText, cancelText, danger, … })
     * → Promise<{ confirmed, button, reason }>
     */
    confirm(options) {
      const opt = typeof options === "string" ? { content: options } : options || {};
      return awaiting(openDialog("confirm", opt), opt.okButton || "ok");
    },
    /**
     * prompt({ title, content, input: { value, placeholder, password, maxLength }, … })
     * → Promise<{ confirmed, value, button, reason }>
     */
    prompt(options) {
      const opt = typeof options === "string" ? { content: options } : options || {};
      if (opt.value !== undefined && !opt.input) opt.input = { value: opt.value };
      return awaiting(openDialog("prompt", opt), opt.okButton || "ok").then((r) => ({
        value: r.value,
        confirmed: r.confirmed,
        button: r.button,
        reason: r.reason,
      }));
    },
    /**
     * toast({ content, autoClose, icon, … }) → { id, close() }，立刻返回，不等用户。
     * toast 不抢焦点、不进任务栏，默认 3 秒自己消失。
     */
    toast(options) {
      const opt = typeof options === "string" ? { content: options } : options || {};
      const handle = openDialog("toast", opt);
      return {
        get id() { return handle.id; },
        close(reason) { return handle.close(reason || "api"); },
      };
    },
    /**
     * 页面自己画、但外观与行为按弹框来：dialog.window({ html: "settings.html", … })。
     * 返回普通窗口 handle；页面里用 `win.result` 交卷。
     */
    window(options) {
      return openDialog("window", options || {});
    },
    /** 关掉某个弹框（id 或 key）。 */
    close(ref, reason) {
      return windowsApi.close(ref, reason);
    },
  });

  // ── public API ─────────────────────────────────────────────
  const widget = Object.freeze({
    apiVersion: 1,
    hostVersion: boot.hostVersion,
    id: boot.widgetId,
    instanceId: boot.instanceId,
    locale: boot.locale || navigator.language,
    developer: !!boot.developer,
    /** Permissions this widget may use now: declared in widget.json and allowed by the user. */
    permissions: Object.freeze([...(boot.permissions || [])]),
    get locked() { return state.locked; },
    get layer() { return state.layer; },
    /** Current theme id, e.g. "instrument", "type", "paper". */
    get theme() { return state.appearance.theme || ""; },
    /** Is the card on screen right now? Kept in step by the host's show/hide events. */
    get visible() { return state.visible; },

    /** Raw bridge call: `widget.call(method, params)` → Promise. Used by the uTools layer. */
    call,
    /** "main" on a card, "custom" inside a window a widget opened. */
    windowType: boot.windowType || "main",
    /** The custom window's own id (0 on a card). */
    windowId: boot.windowId || 0,

    /** Picks the string for the user's language from { "zh-TW": ..., "zh-CN": ..., en: ... }. */
    t,

    /** Small DOM / formatting / timing helpers the widgets keep redefining. */
    util: Object.freeze({
      $,
      $$,
      esc,
      pad,
      clampInt,
      startOfDay,
      addDays,
      dayKey,
      hhmm,
      mmss,
      fmtBytes,
      rid,
      uid,
      sleep,
      debounce,
      throttle,
      L,
      zh,
      hans,
      toast,
    }),

    /**
     * Listen to host events. Lifecycle: "ready" ({visible}: page is up), "show"/"hide"
     * ({from, visible}), "resize" ({width, height} in CSS pixels, debounced), "unload" ({kill}).
     * Plus data events "settings", "appearance", "state", "system", and custom ones.
     * Returns an unsubscribe function.
     */
    on,

    settings: Object.freeze({
      /** get() → all settings; get(key) → one value. Synchronous. */
      get: (key) => (key === undefined ? { ...state.settings } : state.settings[key]),
      set: (key, value) => call("settings.set", { key, value }),
      onChange: (fn) => on("settings", fn),
    }),

    storage: Object.freeze({
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }),
      remove: (key) => call("storage.remove", { key }),
      keys: () => call("storage.keys"),
    }),

    system: Object.freeze({
      /** subscribe(["cpu","memory","network","disk","battery"], data => {}, { interval: 1000 }) → unsubscribe */
      subscribe,
      /** Up to 15 minutes of past readings: { now, points: [[time, cpu %, memory %, down B/s, up B/s], …] }. */
      history: () => call("system.history"),
      /** Windows version, processor, memory, graphics, computer name, screens, uptime. */
      info: () => call("system.info"),
      /** Connected network adapters, the internet one first: name, type, IP addresses, gateways. */
      adapters: () => call("system.adapters"),
      /** One ping: { ok, ms, status, address }. At most once a second per widget. */
      ping: (host, options) => call("system.ping", { host, timeout: (options && options.timeout) || 1500 }),
    }),

    /** The speakers' volume (0–100) and mute; needs the "audio" permission. */
    audio: Object.freeze({
      get: () => call("audio.get"),
      set: (changes) => call("audio.set", changes || {}),
      onChange: onAudio,
    }),

    /** What's playing in Windows' media controls, and its buttons; needs the "media" permission. */
    media: Object.freeze({
      get: () => call("media.get"),
      onChange: onMedia,
      play: () => call("media.control", { action: "play" }),
      pause: () => call("media.control", { action: "pause" }),
      toggle: () => call("media.control", { action: "toggle" }),
      next: () => call("media.control", { action: "next" }),
      previous: () => call("media.control", { action: "previous" }),
      seek: (ms) => call("media.control", { action: "seek", position: Math.max(0, Number(ms) || 0) }),
      position: mediaPosition,
      /** Timed lyrics of the current track, looked up online: { title, artist, lyrics: { found, source, lines: [{ t, text, tr }] } }. */
      lyrics: () => call("media.lyrics"),
    }),

    /** Pictures in the folder the user chose in a setting of type "folder". */
    files: Object.freeze({
      list: (key, options) => call("files.list", { key, recursive: !!(options && options.recursive) }),
      /** The address of a picture from list(); with { width } a smaller copy made by Windows. */
      url: (file, options) => {
        const w = options && options.width ? Math.round(options.width) : 0;
        return file.url + "?v=" + file.modified + (w ? "&w=" + w : "");
      },
      /** { taken: ms or null (from the camera), width, height } */
      info: (key, path) => call("files.info", { key, path: typeof path === "string" ? path : path.path }),
      /** Opens a folder dialog and saves the choice in setting `key` → path or null. */
      pick: (key) => call("files.pick", { key }),
    }),

    /**
     * Paired Bluetooth devices; needs the "bluetooth" permission.
     * list({ battery, refresh }) → { supported, adapter, devices, updated, error }.
     * Each device: { id, name, address, kind, connected, paired, le, battery, major, minor }.
     * `kind` is one of audio, phone, computer, keyboard, mouse, peripheral, wearable, network,
     * imaging, toy, health, other; `battery` is 0–100 or null when the device does not expose
     * the standard GATT battery service.
     */
    bluetooth: Object.freeze({
      list: (options) =>
        call("bluetooth.list", {
          battery: !options || options.battery !== false,
          refresh: !!(options && options.refresh),
        }),
    }),

    /** Built-in widgets only. */
    recycleBin: Object.freeze({
      query: () => call("recycle.query"),
      empty: () => call("recycle.empty"),
      open: () => call("recycle.open"),
    }),

    /** Built-in widgets only: "lock", "sleep", "restart", "shutdown" or "signout". */
    power: (action) => call("power.do", { action }),

    /** Like fetch(), via the host: no CORS limits, but only for hosts declared as "network:<host>". */
    fetch: hostFetch,

    shell: Object.freeze({
      open: (target) => call("shell.open", { target }),
      /** Opens a program, shortcut, folder or file by its full path. Needs "shell.launch". */
      launch: (path) => call("shell.launch", { path }),
      /** Opens a link with a specific program, e.g. a chosen browser. Needs "shell.launch". */
      openWith: (target, app) => call("shell.openWith", { target, app }),
      /** Renames files in place: [{ from, to }]; "to" must stay in the same folder. Needs "shell.launch". */
      rename: (items) => call("shell.rename", { items: [...(items || [])] }),
      /** { path, exists, name, kind: "app"|"folder"|"file"|"missing", icon: data URL }. Needs "shell.launch". */
      info: (path, options) => call("shell.info", { path, size: (options && options.size) || 64 }),
      /** A file or folder dialog: pick({ type: "file"|"folder", filter: "programs"|"images"|"all", title }) → path or null. */
      pick: (options) => call("shell.pick", options || {}),
      /** A save dialog: save({ title, name, filter: "images"|"text"|"json"|"all" }) → path or null. */
      save: (options) => call("shell.save", options || {}),
      /** Shows the file in its folder in Explorer. */
      reveal: (path) => call("shell.reveal", { path }),
      /** Full paths of dropped files: in a "drop" handler, paths(e.dataTransfer.files). Needs "shell.launch". */
      paths: (files) => callWithFiles("shell.paths", {}, [...(files || [])]),
      /** Moves a file or folder to the recycle bin. Needs "shell.launch". */
      trash: (path) => call("shell.trash", { path }),
      /** Explorer desktop icons: "query" | "show" | "hide" | "toggle" → { supported, visible }. Needs "shell.launch". */
      desktopIcons: (action) => call("shell.desktopIcons", { action: String(action || "query") }),
    }),

    /**
     * Third-party CLI tools declared in widget.json "tools". The host downloads the https URL
     * into the widget's bin folder, checks the SHA-256 when the declaration includes one, and
     * runs it without a shell.
     * Needs "tool.exec" and the matching "network:<host>" permission.
     */
    tool: Object.freeze({
      /** Every declared tool with its cache state: { name, path, cached, downloaded, bytes, … }. */
      list: () => call("tool.list"),
      /** One tool's cache state; rejects when the name is not declared. */
      status: (name) => call("tool.status", { name }),
      /** Downloads and verifies the tool now. run() does this automatically. */
      ensure: (name, options) => call("tool.ensure", { name, force: !!(options && options.force) }),
      /** Runs it: run(name, { args, stdin, timeout, cwd }) → { code, ok, timedOut, stdout, stderr, … }. */
      run: (name, options) =>
        call("tool.run", {
          name,
          args: options && Array.isArray(options.args) ? [...options.args] : [],
          stdin: options && options.stdin,
          timeout: options && options.timeout,
          cwd: options && options.cwd,
        }),
      /** Deletes the cached program; the next run downloads it again. */
      remove: (name) => call("tool.remove", { name }),
    }),

    /** The Windows clipboard; needs the "clipboard" permission. */
    clipboard: Object.freeze({
      /** The copied text, or null when the clipboard holds no text. */
      readText: () => call("clipboard.readText"),
      /** Puts text on the clipboard; false when Windows refused it. */
      writeText: (text) => call("clipboard.writeText", { text: String(text ?? "") }),
      /** The copied picture as a PNG data URL, or null when there is none. */
      readImage: () => call("clipboard.readImage"),
      /** A data URL, a bare base64 string, a path or a `NativeImage`; false when Windows refused it. */
      writeImage: (image) => call("clipboard.writeImage", { image: imageSource(image) }),
      /** The copied files: [{ path, isDirectory, isFile, name }]. */
      readFiles: () => call("clipboard.readFiles"),
      /** Puts files on the clipboard so the next Ctrl+V drops them ("copy", not "cut"). */
      writeFiles: (paths) => call("clipboard.writeFiles", { paths: [].concat(paths || []).map(String) }),

      // ── 历史（宿主自己记，最近 300 条） ────────────────────────────────
      /**
       * The records, newest first: `{_id, hash, type, value, size, timestamp, pinned}`.
       * `type` is `text` / `files` / `image`; `opts` filters with `{ type, pinned, limit }`.
       * The first call starts the watcher, so later copies show up by themselves.
       */
      history: (opts) => call("clipboard.history", opts || {}),
      /** How many records of each kind: `{ all, text, image, files, pinned }`. */
      stats: () => call("clipboard.history.stats"),
      /** Marks records as favourites (the 收藏 tab); `pinned` defaults to true. */
      pin: (ids, pinned) =>
        call("clipboard.history.pin", {
          ids: [].concat(ids || []).map(String),
          pinned: pinned === undefined ? true : !!pinned,
        }),
      /** Deletes records by id (or hash). */
      remove: (ids) => call("clipboard.history.remove", { ids: [].concat(ids || []).map(String) }),
      /** Empties the list; `keepPinned` keeps the favourites. */
      clear: (opts) => call("clipboard.history.clear", opts || {}),
      /** Puts one record back on the clipboard — the "copy" button. */
      copy: (id) => call("clipboard.recopy", { id: String(id) }),
      /** The picture of an image record, as a PNG data URL. */
      image: (id) => call("clipboard.image", { id: String(id) }),
      /** The files of a record still exist on disk: `[bool]`, one per path. */
      filesExist: (paths) => call("clipboard.filesExist", { paths: [].concat(paths || []).map(String) }),
    }),

    /** Windows' own known folders, OneDrive redirection included. */
    paths: Object.freeze({
      /** named("home" | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "temp" | "appData") → path or null. */
      named: (name) => call("paths.named", { name: String(name || "") }),
    }),

    /** The screen; everything here needs the "screen" permission and speaks DIP where it can. */
    screen: Object.freeze({
      /** The whole virtual desktop as a PNG data URL, or null when it failed. */
      capture: () => call("screen.capture"),
      /** Windows' snipping overlay; the selection as a PNG data URL, or null when cancelled. */
      captureInteractive: (options) =>
        call("screen.captureInteractive", { timeout: (options && options.timeout) || 45000 }),
      /** One display by its index (0-based), as a PNG data URL. */
      captureDisplay: (display) => call("screen.captureDisplay", { display: Number(display) || 0 }),
      /** [{ id, label, primary, bounds, workArea, workAreaSize, scaleFactor, rotation, size }], in DIP. */
      displays: () => call("screen.displays"),
      /** The display Windows calls primary. */
      primary: () => call("screen.primary"),
      /** The display a point falls on: nearest({ x, y }). */
      nearest: (point) => call("screen.nearest", { x: Number(point && point.x) || 0, y: Number(point && point.y) || 0 }),
      /** The display a rectangle overlaps most: matching({ left, top, width, height }). */
      matching: (rect) => call("screen.matching", rectOf(rect)),
      /** { x, y } of the mouse, in physical screen pixels like uTools' version. */
      cursor: () => call("screen.cursor"),
      /** Point or rectangle from physical pixels to DIP. */
      toDip: (value) => call("screen.toDip", value),
      /** Point or rectangle from DIP to physical pixels. */
      toScreen: (value) => call("screen.toScreen", value),
      /** The colour under the cursor: { hex: "#RRGGBB", rgb: "rgb(r, g, b)" }. */
      colorPick: () => call("screen.colorPick"),
    }),

    /** A file type's icon as a data URL. Accepts a path, an extension (".pdf") or "folder". */
    fileIcon: (spec, options) => call("file.icon", { path: String(spec || ""), size: (options && options.size) || 32 }),


    /** Simplified ↔ Traditional Chinese, character by character (Windows' own tables). */
    convertChinese: (text, to) => call("text.chinese", { text: String(text ?? ""), to: to === "simplified" ? "simplified" : "traditional" }),

    /** The document store: `data\db\<widget>.json` and an attachments folder beside it. */
    db: Object.freeze({
      /** Stores a document; `_id` is required. Answers { id, rev, ok }. */
      put: (doc) => call("db.put", { doc }),
      /** One document with its `_rev`, or null. */
      get: (id) => call("db.get", { id: String(id) }),
      /** Drops a document; a bare id or the document itself are both accepted. */
      remove: (docOrId) => call("db.remove", typeof docOrId === "string" ? { id: docOrId } : { doc: docOrId }),
      /** Several at once: [{ _id, … }] → [{ id, ok }]. */
      bulkDocs: (docs) => call("db.bulkDocs", { docs: docs || [] }),
      /** allDocs({ idStartsWith?, ids? }) → [{ _id, _rev, … }]. */
      allDocs: (options) => call("db.allDocs", options || {}),
      /** Base64 bytes attached to a document, 10 MB at most. */
      postAttachment: (id, data, type) =>
        call("db.postAttachment", { id: String(id), data: String(data ?? ""), type: String(type || "image/png") }),
      /** The attachment as a PNG data URL. */
      getAttachment: (id) => call("db.getAttachment", { id: String(id) }),
      /** Its MIME type, or "" when there is none. */
      getAttachmentType: (id) => call("db.getAttachmentType", { id: String(id) }),
    }),

    /** Timed tasks, kept in `data\schedules.json`; needs the "schedule" permission. */
    schedule: Object.freeze({
      /** request({ code, label, trigger }) — cron is the standard five fields, or a timestamp. */
      request: (task) => call("schedule.request", { schedule: task }),
      /** [{ code, label, trigger, successCount, failureCount, lastStatus, lastExecuteAt }]. */
      list: () => call("schedule.list"),
      /** remove(code); throws when there is no such task. */
      remove: (code) => call("schedule.remove", { code: String(code) }),
      /**
       * fn({ code, label, at }) runs when a task is due. Return a promise and the host waits: a
       * throw or a rejection is recorded as a failure, anything else as a success.
       */
      onTrigger: (fn) => {
        if (typeof fn !== "function") return () => {};
        return on("schedule", (d) => {
          const payload = d || {};
          const report = (ok, message) =>
            call("schedule.result", { code: payload.code, ok, message }).catch(() => {});
          let settled;
          try {
            settled = Promise.resolve(fn(payload));
          } catch (e) {
            report(false, String((e && e.message) || e));
            return;
          }
          settled.then(() => report(true), (e) => report(false, String((e && e.message) || e)));
        });
      },
    }),

    /** Keyboard and mouse injection; needs the "input" permission. Coordinates are physical pixels. */
    simulate: Object.freeze({
      keyboardTap: (key, ...modifiers) =>
        call("simulate.keyboardTap", { key: String(key), modifiers: modifiers.map(String) }),
      mouseMove: (x, y) => call("simulate.mouseMove", { x: Number(x), y: Number(y) }),
      mouseClick: (x, y) => call("simulate.mouseClick", { x: Number(x), y: Number(y) }),
      mouseDoubleClick: (x, y) => call("simulate.mouseDoubleClick", { x: Number(x), y: Number(y) }),
      mouseRightClick: (x, y) => call("simulate.mouseRightClick", { x: Number(x), y: Number(y) }),
    }),

    /** The commands this widget adds while it runs, kept in `data\features.json`. */
    features: Object.freeze({
      /** get() → everything; get(["a","b"]) → only those codes. */
      get: (codes) => call("features.get", { codes: codes || null }),
      /** set({ code, cmds: [ "label" | { type, label, match, … } ], description?, icon? }). */
      set: (feature) => call("features.set", { feature }),
      /** remove(code) → true when something was there. */
      remove: (code) => call("features.remove", { code: String(code) }),
    }),

    /** Opening another widget by one of its commands. */
    redirect: Object.freeze({
      /** to(label) or to([widgetName, label]); false when nothing matched. */
      to: (label, payload) => call("redirect.to", { label, payload }),
      /** Opens the control center's shortcut page for that command; false when it has none. */
      hotkey: (cmdLabel, autocopy) =>
        call("redirect.hotkey", { cmdLabel: String(cmdLabel || ""), autocopy: !!autocopy }),
      /** The keys bound to that command ("Ctrl+Shift+A"), or null. */
      hotkeyGet: (cmdLabel) => call("redirect.hotkeyGet", { cmdLabel: String(cmdLabel || "") }),
    }),

    /** Fetching a page without a browser window; needs the "ubrowser" permission. */
    ubrowser: Object.freeze({
      /** fetch(url, { timeout }) → { url, title, text, html, skipped }. */
      fetch: (url, options) =>
        call("ubrowser.fetch", { url: String(url), timeout: Number(options && options.timeout) || 20000 }),
    }),

    /** Image processing in the host; needs the "sharp" permission. Chain calls, then read the result. */
    sharp: (input, options) => sharpChain(input, options),

    /** A Windows notification; needs the "notify" permission. */
    notify,

    window: Object.freeze({
      /** "main"（卡片）或 "custom"（组件自己开的窗口）。 */
      get type() { return boot.windowType || "main"; },
      /** 自定义窗口的 id；卡片为 0。 */
      get id() { return boot.windowId || 0; },
      getSize: () => call("window.getSize"),
      setSize: (width, height) => call("window.setSize", { width, height }),
      getBounds: () => call("window.getBounds"),
      setBounds: (b) => call("window.setBounds", b || {}),
      getPosition: () => call("window.getPosition"),
      setPosition: (x, y) => call("window.setPosition", { x, y }),
      /** 把窗口抬到最前（卡片不会被抢键盘焦点）。 */
      focus: () => call("window.focus"),
      setAlwaysOnTop: (on) => call("window.setAlwaysOnTop", { on: on !== false }),
      isAlwaysOnTop: () => call("window.isAlwaysOnTop"),
      /** 0–1。卡片是把页面整体调淡（窗口层是逐像素透明的，不能再叠一层 alpha）。 */
      setOpacity: (o) => call("window.setOpacity", { opacity: Number(o) }),
      setTitle: (t) => call("window.setTitle", { title: t == null ? "" : String(t) }),
      /**
       * 无边框窗口的自绘标题条/拖拽区按下时调用；卡片走它自己的拖动。
       * 只在真要自己管手势时才写——标了 `data-ww-drag` 的元素由 SDK 代劳。
       */
      startDrag: beginDrag,
      /** 关掉自己：卡片等于收起（托盘还能叫回来）。 */
      close: () => call("window.close"),
      hide: () => call("window.hide"),
      show: () => call("window.show"),
      isVisible: () => state.visible,
    }),

    /** 多窗口：开窗、查找、通信、批量关闭。旧写法 `utools.createBrowserWindow` 照旧可用。 */
    windows: windowsApi,

    /** 宿主内置弹框：alert / confirm / prompt / toast，配置见 docs/組件開發指南。 */
    dialog: dialogApi,

    appearance: Object.freeze({
      get: () => ({ ...state.appearance }),
      onChange: (fn) => on("appearance", fn),
    }),

    log: (...args) => send("log", { level: "info", msg: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") }),
  });

  Object.defineProperty(window, "widget", { value: widget, writable: false, configurable: false, enumerable: true });
})();
