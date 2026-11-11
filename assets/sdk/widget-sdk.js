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
  const NO_DRAG = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false']), [data-no-drag], [role='slider']";
  let down = null;

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
    if (boot.resizable) {
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
      getSize: () => call("window.getSize"),
      setSize: (width, height) => call("window.setSize", { width, height }),
      startDrag: () => send("window.drag"),
      /** Puts the card away; the tray menu and the control center can bring it back. */
      hide: () => call("window.hide"),
      /** Brings a hidden card back. */
      show: () => call("window.show"),
    }),

    appearance: Object.freeze({
      get: () => ({ ...state.appearance }),
      onChange: (fn) => on("appearance", fn),
    }),

    log: (...args) => send("log", { level: "info", msg: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") }),
  });

  Object.defineProperty(window, "widget", { value: widget, writable: false, configurable: false, enumerable: true });
})();
