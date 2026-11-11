/* WinWidget 的 uTools 兼容层。
 *
 * uTools 的插件是 Electron 应用：plugin.json + preload.js（Node 里 require fs/path/child_process、
 * 装 Sharp/FFmpeg）+ 渲染进程页面，页面上拿到全局 utools。WinWidget 是 Rust + WebView2，没有
 * Electron 也没有 Node，所以这里只补「页面里能用到的那部分 utools.*」：每一个都接到 widget-sdk
 * 已经声明过的宿主能力上，权限照旧由 widget.json 的 permissions 管。
 *
 * 支持的写在 SUPPORTED 里，能跑但语义变了（同步变异步、没有 Node 路径等）的写在 DEGRADED 里，
 * 完全接不上的（AI、定时任务、uBrowser、Sharp、FFmpeg、支付……）不实现：访问到就用一个抛出
 * utools.unsupported 的函数兜住，不会静默返回 undefined 让人查半天。
 *
 * 页面里可以先用 utools.__compat 判断：
 *   if (utools.__compat.supports("showNotification")) ...
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof widget === "undefined") return;

  const HOST = "WinWidget";
  const VERSION = widget.hostVersion || "1.0.0";
  const SUPPORTED = [
    // 事件
    "onPluginReady", "onPluginEnter", "onPluginOut",
    // 窗口
    "hideMainWindow", "showMainWindow", "outPlugin", "setExpendHeight", "getWindowType",
    // 系统
    "showNotification", "shellOpenPath", "shellShowItemInFolder", "shellOpenExternal",
    "shellTrashItem", "shellBeep", "getPath", "getFileIconAsync", "getAppVersion", "getNativeId",
    "getUser", "isDev", "isWindows", "isMacOS", "isLinux", "isDarkColors",
    "showOpenDialog", "showSaveDialog",
    // 复制
    "copyText",
    // 数据库（本地同步库，落在本组件的 WebView2 local storage）
    "dbStorage",
    // 屏幕
    "captureScreen",
  ];
  const DEGRADED = {
    getFileIcon: "uTools 里是同步返回；这里只能异步，用 getFileIconAsync",
    showOpenDialog: "uTools 里是同步弹窗；这里是 Promise，等 await",
    showSaveDialog: "uTools 里是同步弹窗；这里是 Promise，等 await",
    copyImage: "剪贴板只支持文字",
    getCopyedFiles: "剪贴板里读不到文件路径列表，返回空数组",
    getPluginLocalDataPath: "没有 Node 文件系统；用 widget.storage 存数据",
    getPluginTempPath: "没有 Node 文件系统；用 widget.storage 存数据",
    setExpendHeight: "uTools 里同步改窗口高度；这里是异步的，宽度不变",
    readCurrentFolderPath: "读不到前台资源管理器路径",
    readCurrentBrowserUrl: "读不到前台浏览器地址",
  };
  const UNSUPPORTED = [
    "AI 能力（utools.ai 等）", "定时任务", "模拟操作（键盘/鼠标注入）", "动态功能", "快捷入口",
    "uBrowser 内嵌浏览器", "Sharp 图片处理", "FFmpeg 音视频处理", "支付",
  ];

  const listeners = { ready: [], enter: [], out: [] };

  function unsupportedError(api) {
    const err = new Error(
      "utools." + api + " 在 " + HOST + " 里没有对应能力：" +
      "WinWidget 是 Rust + WebView2 宿主，不是 Electron / Node 运行时。"
    );
    err.code = "utools.unsupported";
    err.api = api;
    return err;
  }

  function pick(list) {
    return list.slice();
  }

  // ── 系统路径：提前取一次，getPath() 才能像 uTools 那样同步返回 ─────────
  const knownPaths = Object.create(null);
  const PATH_NAMES = ["home", "desktop", "documents", "downloads", "music", "pictures", "videos", "temp", "appData"];
  Promise.all(
    PATH_NAMES.map((name) =>
      widget.paths
        .named(name)
        .then((p) => {
          if (p) knownPaths[name] = p;
        })
        .catch(() => {})
    )
  ).catch(() => {});

  // ── 本地同步小库（dbStorage）：key 前缀隔离，互不串味 ──────────────────
  const DB_PREFIX = "utools.db:";
  function dbKey(key) {
    return DB_PREFIX + widget.id + ":" + String(key);
  }
  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const dbStorage = Object.freeze({
    /** 同步读取；没有这条记录返回 null。 */
    getItem: (key) => readJson(dbKey(key)),
    /** 同步写入，返回 doc 本身（uTools 的行为）。 */
    setItem: (key, value) => {
      writeJson(dbKey(key), value);
      return value;
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(dbKey(key));
      } catch (e) {
        /* ignore */
      }
    },
    clear: () => {
      try {
        const prefix = DB_PREFIX + widget.id + ":";
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) localStorage.removeItem(k);
        }
      } catch (e) {
        /* ignore */
      }
    },
  });

  // ── 提示音：不需要权限，一声短促的哔 ─────────────────────────────────
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, 120);
    } catch (e) {
      /* 没有音频设备就算了 */
    }
  }

  const compat = Object.freeze({
    host: HOST,
    level: "web-subset",
    note: "页面上能用的 uTools API 子集；Electron / Node / 原生模块不在其中。",
    supported: Object.freeze(pick(SUPPORTED)),
    degraded: Object.freeze(Object.keys(DEGRADED)),
    unsupported: Object.freeze(pick(UNSUPPORTED)),
    supports: (name) => SUPPORTED.includes(name),
    error: (api) => unsupportedError(api),
    reason: (name) => DEGRADED[name] || null,
  });

  const utools = {
    __compat: compat,

    // ── 事件 ────────────────────────────────────────────────────────────
    /** 页面加载完就回调一次；uTools 的「进入插件应用」在这里合成。 */
    onPluginReady: (fn) => {
      if (typeof fn !== "function") return;
      listeners.ready.push(fn);
    },
    /** 卡片被打开（或页面被重载）时回调一次：{ code, type: "text", payload: "" }。 */
    onPluginEnter: (fn) => {
      if (typeof fn !== "function") return;
      listeners.enter.push(fn);
    },
    onPluginOut: (fn) => {
      if (typeof fn !== "function") return;
      listeners.out.push(fn);
    },

    // ── 窗口 ────────────────────────────────────────────────────────────
    hideMainWindow: () => widget.window.hide(),
    showMainWindow: () => widget.window.show(),
    outPlugin: () => widget.window.hide(),
    getWindowType: () => "main",
    /** 只改高度，宽度保持；uTools 同步、这里异步，所以返回 Promise。 */
    setExpendHeight: (height) =>
      widget.window.getSize().then((size) => {
        const w = Array.isArray(size) ? size[0] : (size && size.width) || 0;
        const h = Math.max(80, Math.round(Number(height) || 0));
        return widget.window.setSize(w, h);
      }),

    // ── 系统 ────────────────────────────────────────────────────────────
    showNotification: (body) => widget.notify({ title: HOST, body: String(body == null ? "" : body) }),
    shellOpenPath: (fullPath) =>
      Promise.resolve(widget.shell.open(String(fullPath || ""))).then(
        () => "",
        (e) => String((e && e.message) || e)
      ),
    shellShowItemInFolder: (fullPath) => widget.shell.reveal(String(fullPath || "")),
    shellOpenExternal: (url) => widget.shell.open(String(url || "")),
    shellTrashItem: (fullPath) => widget.shell.trash(String(fullPath || "")).then(() => undefined),
    shellBeep: beep,
    getPath: (name) => knownPaths[String(name || "")] || "",
    getFileIcon: (filePath) => widget.fileIcon(String(filePath || "")),
    getFileIconAsync: (filePath) => widget.fileIcon(String(filePath || "")),
    showOpenDialog: (options) =>
      widget.shell
        .pick({
          type: options && options.properties && options.properties.includes("openDirectory") ? "folder" : "file",
          filter: "all",
          title: (options && options.title) || "",
        })
        .then((path) => (path ? [path] : undefined)),
    showSaveDialog: (options) =>
      widget.shell
        .save({
          title: (options && options.title) || "",
          name: (options && options.defaultPath) || "",
          filter: "all",
        })
        .then((path) => path || undefined),
    getAppVersion: () => VERSION + " (WinWidget)",
    getNativeId: () => {
      let id = readJson(ID_KEY);
      if (typeof id !== "string" || !id) {
        id = "ww-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        writeJson(ID_KEY, id);
      }
      return id;
    },
    getUser: () => null,
    isDev: () => !!widget.developer,
    isWindows: () => true,
    isMacOS: () => false,
    isLinux: () => false,
    isDarkColors: () => {
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch (e) {
        return false;
      }
    },

    // ── 复制 ────────────────────────────────────────────────────────────
    copyText: (text) => widget.clipboard.writeText(String(text == null ? "" : text)),
    copyImage: function () {
      throw unsupportedError("copyImage");
    },
    getCopyedFiles: () => [],

    // ── 数据库（本地同步） ───────────────────────────────────────────────
    dbStorage,

    // ── 屏幕 ────────────────────────────────────────────────────────────
    /** 整块虚拟桌面截成 data URL；需要 widget.json 里声明 "screen"。 */
    captureScreen: () => widget.screen.capture(),

    // ── 没有 Node 路径，直说 ─────────────────────────────────────────────
    getPluginLocalDataPath: () => "",
    getPluginTempPath: () => "",
    readCurrentFolderPath: () => Promise.reject(unsupportedError("readCurrentFolderPath")),
    readCurrentBrowserUrl: () => Promise.reject(unsupportedError("readCurrentBrowserUrl")),
  };

  // 未知成员（AI、ubrowser、simulate、dynamicFeature、快捷入口……）不要返回 undefined：
  // 返回一个「怎么点都抛错」的对象，比「TypeError: utools.ai.chat is not a function」好查。
  // 所以这里给的不只是一个抛错函数，而是能继续链式取属性的 Proxy，
  // 这样 utools.ai.chat(...) 抛的是 utools.unsupported，而不是 TypeError。
  function unsupportedProxy(path) {
    const fn = function unsupportedApi() {
      throw unsupportedError(path);
    };
    return new Proxy(fn, {
      get(target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") return undefined; // 别被 await / Promise 链当成 thenable
        if (prop === "toString" || prop === "valueOf") {
          return () => "[utools unsupported] " + path;
        }
        return unsupportedProxy(path ? path + "." + String(prop) : String(prop));
      },
    });
  }

  const shim = new Proxy(utools, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      return unsupportedProxy(String(prop));
    },
    has(target, prop) {
      return prop in target;
    },
  });

  Object.defineProperty(window, "utools", {
    value: shim,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // ── 合成进入事件：页面 ready 之后再回调，免得插件还没注册就错过 ─────────
  function enterPayload() {
    return { code: widget.id, type: "text", payload: "" };
  }
  function fireEnter() {
    const payload = enterPayload();
    for (const fn of listeners.ready.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error("utools.onPluginReady:", e);
      }
    }
    for (const fn of listeners.enter.slice()) {
      try {
        fn(payload);
      } catch (e) {
        console.error("utools.onPluginEnter:", e);
      }
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fireEnter, { once: true });
  } else {
    fireEnter();
  }
  window.addEventListener("beforeunload", () => {
    for (const fn of listeners.out.slice()) {
      try {
        fn();
      } catch (e) {
        /* ignore */
      }
    }
  });
})();
