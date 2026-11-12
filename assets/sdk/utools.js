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
  /**
   * `utools.getAppVersion()` 报的是「uTools API 兼容级别」，不是 WinWidget 自己的版本号：
   * 插件普遍用 `parseFloat(utools.getAppVersion()) < 7` 判断底座够不够新，报 1.0.0 会让它们
   * 直接画出「uTools 版本太低」的页面。这里跟本宿主实现对得上的那一档对齐（7.x 的接口面）。
   */
  const UTOOLS_COMPAT_VERSION = "7.6.0";
  /** "main" on a card, "custom" inside a window a widget opened with createBrowserWindow. */
  const WINDOW_TYPE = widget.windowType || "main";
  const SUPPORTED = [
    // 事件
    "onPluginReady", "onPluginEnter", "onPluginOut",
    // 窗口
    "createBrowserWindow", "hideMainWindow", "showMainWindow", "outPlugin", "setExpendHeight",
    "getWindowType", "sendToParent", "findInPage", "stopFindInPage",
    // 系统
    "showNotification", "shellOpenPath", "shellShowItemInFolder", "shellOpenExternal",
    "shellTrashItem", "shellBeep", "getPath", "getFileIconAsync", "getAppVersion", "getNativeId",
    "getUser", "isDev", "isWindows", "isMacOS", "isLinux", "isDarkColors",
    "showOpenDialog", "showSaveDialog",
    // 复制
    "copyText", "copyImage", "copyFile", "getCopyedFiles",
    // 数据库（本组件自己的文档库 + 同步小库）
    "db", "db.promises", "dbStorage",
    // 屏幕
    "captureScreen", "screen", "screen.capture", "screen.captureDisplay", "screen.getCursorScreenPoint",
    "screen.getPrimaryDisplay", "screen.getAllDisplays", "screen.getDisplayNearestPoint",
    "screen.getDisplayMatching", "screen.screenToDipPoint", "screen.dipToScreenPoint",
    "screen.screenToDipRect", "screen.dipToScreenRect", "screenColorPick", "screen.captureInteractive",
    // 输入
    "hideMainWindowPasteText", "hideMainWindowPasteFile", "hideMainWindowPasteImage",
    "hideMainWindowTypeString",
    // 定时任务
    "onScheduleTrigger", "requestSchedule", "getSchedules", "removeSchedule",
    // 模拟操作
    "simulateKeyboardTap", "simulateMouseMove", "simulateMouseClick",
    "simulateMouseDoubleClick", "simulateMouseRightClick",
    // 动态功能
    "getFeatures", "setFeature", "removeFeature",
    // 快捷入口
    "redirect", "redirectHotKeySetting", "getCmdHotKey",
    // Sharp / uBrowser
    "sharp", "ubrowser",
  ];
  const DEGRADED = {
    getFileIcon: "uTools 里是同步返回；这里只能异步，用 getFileIconAsync",
    showOpenDialog: "uTools 里是同步弹窗；这里是 Promise，等 await",
    showSaveDialog: "uTools 里是同步弹窗；这里是 Promise，等 await",
    copyImage: "图片改从 data URL / 路径读，写入走宿主的 DIB 通道",
    getCopyedFiles: "uTools 同步返回；这里返回 Promise，等 await",
    screen: "NativeImage 的 getSize/toPNG/toJPEG/crop/resize 返回 Promise（宿主抓完图才能解码）",
    "screen.capture": "uTools 同步返回 NativeImage；这里返回 Promise<NativeImage>",
    screenColorPick: "uTools 弹放大镜等点击；这里直接取光标下的像素",
    "db": "文档库落在宿主 data/db 下，不是 CouchDB HTTP 服务；dbStorage 仍是 localStorage",
    onScheduleTrigger: "回调里必须自己调 schedule.result？不必：抛错/reject 会被记成失败",
    onMainPush: "WinWidget 没有 uTools 那种主输入框：从控制中心 / 其他组件带着 payload 唤起本组件时触发，action.from 为 redirect",
    onDbPull: "没有云端可拉：同一组件的其他卡片写入或删除文档时，本地广播 { direction: \"pull\", docs }",
    sharp: "只实现 image 能覆盖的算子，tint/median/composite/trim/normalize 会按名抛错",
    ubrowser: "只有页面抓取，没有内嵌浏览器：click/input 之类会抛 utools.unsupported",
    requestSchedule: "Promise 完成只代表登记成功那一刻，任务真正跑起来要看 onScheduleTrigger",
    getPluginLocalDataPath: "没有 Node 文件系统；用 widget.storage 存数据",
    getPluginTempPath: "没有 Node 文件系统；用 widget.storage 存数据",
    setExpendHeight: "uTools 里同步改窗口高度；这里是异步的，宽度不变",
    preload: "webPreferences.preload 不会执行：WinWidget 没有 Node / Electron，页面侧用 ipcRenderer 兼容层代替",
    sendToParent: "只在本组件自己的窗口之间传递；没有 Electron 主进程",
    createBrowserWindow: "窗口异步建出来，id 要等返回的 Promise；尺寸/位置先用本地镜像值应答",
    readCurrentFolderPath: "读不到前台资源管理器路径",
    readCurrentBrowserUrl: "读不到前台浏览器地址",
    onPluginDetach: "每张卡片本身就是独立窗口，没有「从主窗口分离」这一步；回调会登记但永不触发",
  };
  const UNSUPPORTED = [
    "AI 能力（utools.ai 等）", "FFmpeg 音视频处理", "支付",
    "内嵌浏览器交互（ubrowser 的 click/input 等）",
  ];

  const listeners = { ready: [], enter: [], out: [], detach: [] };

  // uTools 用 main / panel / hotkey / redirect 描述「从哪儿进来」；WinWidget 自己的 show 事件带的是
  // startup / tray / control / hotkey / fullscreen / api。这里只做词表映射，不改语义。
  const ENTRY_FROM = {
    startup: "main",
    tray: "panel",
    control: "redirect",
    hotkey: "hotkey",
    fullscreen: "main",
    api: "redirect",
  };

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

  // ── 自定义窗口（utools.createBrowserWindow） ─────────────────────────────
  // uTools 那边是 Electron 的 BrowserWindow：方法同步、webContents.send 单向、页面里 ipcRenderer.on。
  // 这里是宿主开窗口 + WebView2：建窗、改尺寸都要过一次异步桥，所以窗口对象自带一份本地镜像
  // （id/尺寸/位置/可见/标题），getter 直接读镜像，setter 先改镜像再通知宿主，语义尽量一致。
  const windowsById = new Map();

  function windowFile(url) {
    return String(url == null ? "" : url)
      .replace(/^\.?\//, "")
      .replace(/^\.\//, "");
  }

  /** uTools 的 ipcRenderer 兼容层：页面里 on(channel) 收窗口消息，send 走 sendToParent。 */
  const ipcHandlers = new Map();
  function ipcDispatch(channel, args) {
    const list = ipcHandlers.get(channel);
    if (!list) return;
    for (const fn of [...list]) {
      try {
        fn({}, ...[].concat(args || []));
      } catch (e) {
        console.error("ipcRenderer.on(" + channel + "):", e);
      }
    }
  }
  const ipcRenderer = {
    on(channel, fn) {
      if (typeof fn !== "function") return ipcRenderer;
      let list = ipcHandlers.get(channel);
      if (!list) ipcHandlers.set(channel, (list = []));
      list.push(fn);
      return ipcRenderer;
    },
    once(channel, fn) {
      const wrapped = function () {
        ipcRenderer.removeListener(channel, wrapped);
        return fn.apply(null, arguments);
      };
      return ipcRenderer.on(channel, wrapped);
    },
    removeListener(channel, fn) {
      const list = ipcHandlers.get(channel);
      if (!list) return ipcRenderer;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
      return ipcRenderer;
    },
    removeAllListeners(channel) {
      if (channel === undefined) ipcHandlers.clear();
      else ipcHandlers.delete(channel);
      return ipcRenderer;
    },
    /** Electron 的 send 是发给主进程；这里没有主进程，按 uTools 的约定转给父窗口。 */
    send(channel, ...args) {
      return widget.call("win.parent", { channel: String(channel), args: args });
    },
    sendSync() {
      throw unsupportedError("ipcRenderer.sendSync");
    },
  };

  function makeBrowserWindow(url, options, callback) {
    const opts = options || {};
    const mirror = {
      id: 0,
      title: opts.title || "",
      x: Number(opts.x) || 0,
      y: Number(opts.y) || 0,
      width: Number(opts.width) || 800,
      height: Number(opts.height) || 600,
      visible: opts.show !== false,
      destroyed: false,
      resizable: opts.resizable !== false,
      closable: opts.closable !== false,
      alwaysOnTop: !!opts.alwaysOnTop,
      minimized: false,
      maximized: false,
      fullScreen: false,
      background: opts.backgroundColor || "rgba(0,0,0,0)",
    };
    const hooks = { closed: [], loaded: [] };
    let created = null;

    function apply(state) {
      if (!state || typeof state !== "object") return;
      if (state.id) mirror.id = state.id;
      for (const key of ["title", "x", "y", "width", "height", "visible", "destroyed", "resizable", "closable", "alwaysOnTop"]) {
        if (state[key] !== undefined) mirror[key] = state[key];
      }
      if (state.background !== undefined) mirror.background = state.background;
    }

    /** Builds the window on first use; every later call waits on the same promise. */
    function ensure() {
      if (created) return created;
      created = widget
        .call("win.create", {
          file: windowFile(url),
          options: opts,
          callback: typeof callback === "function",
        })
        .then((reply) => {
          mirror.id = (reply && reply.id) || 0;
          apply(reply && reply.state);
          if (mirror.id) windowsById.set(mirror.id, api);
          return mirror.id;
        });
      return created;
    }

    const warned = Object.create(null);
    function invoke(method, params) {
      return ensure().then((id) =>
        widget.call("win." + method, Object.assign({ win: id }, params || {})).then((reply) => {
          if (reply && reply.unsupported) {
            if (!warned[method]) {
              warned[method] = true;
              console.warn("BrowserWindow." + method + "：", reply.unsupported);
            }
            return undefined;
          }
          apply(reply);
          return reply;
        })
      );
    }

    function emit(hook, arg) {
      for (const fn of hooks[hook].slice()) {
        try {
          fn(arg);
        } catch (e) {
          console.error("BrowserWindow.on(" + hook + "):", e);
        }
      }
    }

    const devtools = { open: false };
    const wc = {
      get id() {
        return mirror.id;
      },
      send(channel, ...args) {
        return ensure().then((id) =>
          widget.call("win.send", { win: id, channel: String(channel), args: args })
        );
      },
      openDevTools() {
        devtools.open = true;
        return invoke("openDevTools");
      },
      closeDevTools() {
        devtools.open = false;
        return invoke("closeDevTools");
      },
      /** DevTools open state as this object last set it (the host cannot push it back). */
      isDevToolsOpened() {
        return devtools.open;
      },
      executeJavaScript(code) {
        return invoke("executeJavaScript", { code: String(code == null ? "" : code) });
      },
      reload() {
        return invoke("reload");
      },
    };

    const api = {
      get id() {
        return mirror.id;
      },
      get webContents() {
        return wc;
      },
      // ── 显示与销毁 ───────────────────────────────────────────────
      show() {
        mirror.visible = true;
        return invoke("show");
      },
      showInactive() {
        mirror.visible = true;
        return invoke("showInactive");
      },
      hide() {
        mirror.visible = false;
        return invoke("hide");
      },
      close() {
        mirror.destroyed = true;
        mirror.visible = false;
        return invoke("close");
      },
      destroy() {
        mirror.destroyed = true;
        mirror.visible = false;
        return invoke("destroy");
      },
      isVisible: () => mirror.visible,
      isDestroyed: () => mirror.destroyed,
      isFocused: () => false,
      focus() {
        return invoke("focus");
      },
      blur() {
        return invoke("blur");
      },
      // ── 几何 ─────────────────────────────────────────────────────
      setSize(width, height) {
        mirror.width = Math.round(Number(width) || 0);
        mirror.height = Math.round(Number(height) || 0);
        return invoke("setSize", { width: mirror.width, height: mirror.height });
      },
      getSize: () => [mirror.width, mirror.height],
      setContentSize(width, height) {
        return api.setSize(width, height);
      },
      getContentSize: () => [mirror.width, mirror.height],
      setPosition(x, y) {
        mirror.x = Math.round(Number(x) || 0);
        mirror.y = Math.round(Number(y) || 0);
        return invoke("setPosition", { x: mirror.x, y: mirror.y });
      },
      getPosition: () => [mirror.x, mirror.y],
      setBounds(bounds) {
        const b = bounds || {};
        if (b.x !== undefined) mirror.x = Math.round(Number(b.x) || 0);
        if (b.y !== undefined) mirror.y = Math.round(Number(b.y) || 0);
        if (b.width !== undefined) mirror.width = Math.round(Number(b.width) || 0);
        if (b.height !== undefined) mirror.height = Math.round(Number(b.height) || 0);
        return invoke("setBounds", { x: mirror.x, y: mirror.y, width: mirror.width, height: mirror.height });
      },
      getBounds: () => ({ x: mirror.x, y: mirror.y, width: mirror.width, height: mirror.height }),
      getNormalBounds: () => api.getBounds(),
      setContentBounds: (bounds) => api.setBounds(bounds),
      getContentBounds: () => api.getBounds(),
      setMinimumSize(width, height) {
        return invoke("setMinimumSize", { width: Number(width) || 0, height: Number(height) || 0 });
      },
      getMinimumSize: () => [Number(opts.minWidth) || 0, Number(opts.minHeight) || 0],
      setMaximumSize(width, height) {
        return invoke("setMaximumSize", { width: Number(width) || 0, height: Number(height) || 0 });
      },
      getMaximumSize: () => [Number(opts.maxWidth) || 0, Number(opts.maxHeight) || 0],
      center() {
        return invoke("center");
      },
      setResizable(on) {
        mirror.resizable = on !== false;
        return invoke("setResizable", { resizable: mirror.resizable });
      },
      isResizable: () => mirror.resizable,
      // ── 状态 ─────────────────────────────────────────────────────
      maximize() {
        mirror.maximized = true;
        return invoke("maximize");
      },
      unmaximize() {
        mirror.maximized = false;
        return invoke("unmaximize");
      },
      isMaximized: () => mirror.maximized,
      minimize() {
        mirror.minimized = true;
        return invoke("minimize");
      },
      restore() {
        mirror.minimized = false;
        return invoke("restore");
      },
      isMinimized: () => mirror.minimized,
      isNormal: () => !mirror.minimized && !mirror.maximized && !mirror.fullScreen,
      setFullScreen(on) {
        mirror.fullScreen = !!on;
        return invoke("setFullScreen", { flag: !!on });
      },
      isFullScreen: () => mirror.fullScreen,
      setClosable(on) {
        mirror.closable = on !== false;
        return invoke("setClosable", { closable: mirror.closable });
      },
      isClosable: () => mirror.closable,
      setAlwaysOnTop(flag) {
        mirror.alwaysOnTop = !!flag;
        return invoke("setAlwaysOnTop", { flag: mirror.alwaysOnTop });
      },
      isAlwaysOnTop: () => mirror.alwaysOnTop,
      moveTop() {
        return invoke("moveTop");
      },
      setTitle(title) {
        mirror.title = String(title == null ? "" : title);
        return invoke("setTitle", { title: mirror.title });
      },
      getTitle: () => mirror.title,
      setBackgroundColor(color) {
        mirror.background = String(color == null ? "" : color);
        return invoke("setBackgroundColor", { backgroundColor: mirror.background });
      },
      getBackgroundColor: () => mirror.background,
      setOpacity(opacity) {
        return invoke("setOpacity", { opacity: Number(opacity) });
      },
      setSkipTaskbar(skip) {
        return invoke("setSkipTaskbar", { skip: !!skip });
      },
      setIgnoreMouseEvents(ignore) {
        return invoke("setIgnoreMouseEvents", { ignore: !!ignore });
      },
      setHasShadow() {
        console.warn("BrowserWindow.setHasShadow：阴影跟随系统设置，不能单独控制");
      },
      hasShadow: () => false,
      setProgressBar() {
        console.warn("BrowserWindow.setProgressBar：任务栏进度条没有接入");
      },
      setKiosk() {
        console.warn("BrowserWindow.setKiosk：kiosk 模式没有接入");
      },
      flashFrame() {
        console.warn("BrowserWindow.flashFrame：闪烁窗口没有接入");
      },
      loadURL() {
        console.warn("BrowserWindow.loadURL：窗口建好后不能换地址，请新开一个窗口");
      },
      loadFile() {
        console.warn("BrowserWindow.loadFile：窗口建好后不能换地址，请新开一个窗口");
      },
      reload() {
        return invoke("reload");
      },
      /** Electron 的 BrowserWindow.on：这里只有 "closed" 和 "loaded"（页面 ready）两件真事。 */
      on(event, fn) {
        if (typeof fn !== "function") return api;
        if (event === "closed") hooks.closed.push(fn);
        else if (event === "ready-to-show" || event === "loaded") hooks.loaded.push(fn);
        return api;
      },
      /** 内部：宿主说这个窗口的页面就绪/关掉了。 */
      __loaded(state) {
        apply(state);
        emit("loaded");
        if (typeof callback === "function") {
          try {
            callback(api);
          } catch (e) {
            console.error("createBrowserWindow callback:", e);
          }
        }
      },
      __closed() {
        mirror.destroyed = true;
        mirror.visible = false;
        if (mirror.id) windowsById.delete(mirror.id);
        emit("closed");
      },
    };

    // uTools 的调用方式就是先拿对象后建窗：这里立刻返回，建窗在第一次用的时候完成。
    ensure().catch((e) => console.error("createBrowserWindow:", e));
    return api;
  }

  const utools = {
    __compat: compat,

    // ── 事件 ────────────────────────────────────────────────────────────
    /**
     * 页面 ready 后按注册顺序执行；返回 Promise 会被等待。全部跑完才触发 enter，
     * 与 uTools 的「Runtime 等 onPluginReady 完成再进入」一致。
     */
    onPluginReady: (fn) => {
      if (typeof fn !== "function") return;
      listeners.ready.push(fn);
    },
    /**
     * 卡片出现在屏幕上时触发，参数与 uTools 同形：
     * { code, type: "text", payload: "", from: "main"|"panel"|"hotkey"|"redirect" }。
     * 卡片被隐藏后再显示会再触发一次。
     */
    onPluginEnter: (fn) => {
      if (typeof fn !== "function") return;
      listeners.enter.push(fn);
    },
    /**
     * 卡片隐藏（isKill = false，进程还在）或销毁 / 退出程序（isKill = true）时触发。
     */
    onPluginOut: (fn) => {
      if (typeof fn !== "function") return;
      listeners.out.push(fn);
    },
    /**
     * WinWidget 的每张卡片天生就是独立窗口，没有「从主窗口分离」这一步，
     * 所以这里只登记回调，永不触发——写在 DEGRADED 里说明原因。
     */
    onPluginDetach: (fn) => {
      if (typeof fn !== "function") return;
      listeners.detach.push(fn);
    },
    /** 定时任务：到点时跑回调；抛错/reject 会被记成失败。 */
    onScheduleTrigger: () => {
      throw unsupportedError("onScheduleTrigger");
    },
    /**
     * 「主输入框把内容推给插件」。WinWidget 没有 uTools 那个输入框，等价场景是：从控制中心或
     * 其他组件带着 payload 唤起本组件（redirect(label, payload)），此时回调收到
     * { code, type: "text"|"img"|"files", payload, from: "redirect" }。
     */
    onMainPush: (fn) => {
      if (typeof fn !== "function") return;
      widget.on("mainPush", (action) => {
        const a = action || {};
        try {
          fn(a, a.payload);
        } catch (e) {
          console.error("onMainPush:", e);
        }
      });
    },
    /**
     * uTools 的跨设备同步这里没有云端，改为本地广播：同一组件的其他卡片改了文档，本卡片会收到
     * { direction: "pull", docs: [...] }。
     */
    onDbPull: (fn) => {
      if (typeof fn !== "function") return;
      widget.on("dbPull", (payload) => {
        try {
          fn(payload || { direction: "pull", docs: [] });
        } catch (e) {
          console.error("onDbPull:", e);
        }
      });
    },

    // ── 窗口 ────────────────────────────────────────────────────────────
    /**
     * 开一个自定义窗口，返回 BrowserWindow 兼容对象。
     * url 是组件目录里的 HTML（可带 query）；options 见 BrowserWindowConstructorOptions；
     * callback 在页面 ready 后执行——`show:false` 的写法就是在这里 `win.show()`。
     */
    createBrowserWindow: (url, options, callback) => makeBrowserWindow(url, options, callback),
    /** 隐藏卡片；isFocusPrevWindow 为 true 时把焦点交还给之前的窗口。 */
    hideMainWindow: (isFocusPrevWindow) =>
      widget.call("window.main.hide", { isFocusPrevWindow: isFocusPrevWindow !== false }),
    showMainWindow: () => widget.call("window.main.show"),
    outPlugin: (isKill) => widget.call("window.main.out", { isKill: !!isKill }),
    /** "main"（卡片）或 "custom"（自己开的窗口）。 */
    getWindowType: () => WINDOW_TYPE,
    /** 自定义窗口里把消息发回父窗口（卡片，或开它的那个窗口）。 */
    sendToParent: (channel, ...args) =>
      widget.call("win.parent", { channel: String(channel), args: args }),
    /** 卡片页面内查找（WebView2 用浏览器的 window.find 实现，近似 Electron 的 findInPage）。 */
    findInPage: (text, options) =>
      widget.call("window.main.find", {
        text: String(text == null ? "" : text),
        forward: !(options && options.forward === false),
        matchCase: !!(options && options.matchCase),
      }),
    stopFindInPage: (action) =>
      widget.call("window.main.stopFind", { action: String(action || "clearSelection") }),
    /** 只改高度，宽度保持。 */
    setExpendHeight: (height) =>
      widget.call("window.main.expand", { height: Math.max(80, Math.round(Number(height) || 0)) }),

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
    getAppVersion: () => UTOOLS_COMPAT_VERSION,
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

  // ── 其余分类：屏幕 / 输入 / 复制 / 数据库 / 定时任务 / 模拟 / 动态功能 / 快捷入口 / Sharp / uBrowser ──
  // 这一段只做「uTools 名字 → 宿主方法」的映射，能力本身在 core/ 下同名分类文件里，
  // 这里不重复实现一遍判断逻辑。

  const round = (v) => Math.round(Number(v) || 0);
  const pointOf = (p) => ({ x: round(p && p.x), y: round(p && p.y) });
  const rectOf = (r) => ({
    left: round(r && (r.left ?? r.x)),
    top: round(r && (r.top ?? r.y)),
    width: round(r && r.width),
    height: round(r && r.height),
  });

  function dataUrlBytes(url) {
    return fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b));
  }

  /** uTools 的 NativeImage。宿主给的是 PNG data URL，解码与裁剪走 canvas，方法因此都是 Promise。 */
  function nativeImage(dataUrl) {
    const state = { url: typeof dataUrl === "string" ? dataUrl : "", bitmap: null };
    const whenReady = () =>
      state.bitmap
        ? Promise.resolve(state.bitmap)
        : new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              state.bitmap = img;
              resolve(img);
            };
            img.onerror = () => reject(new Error("nativeImage: cannot decode the picture"));
            img.src = state.url || "data:,";
          });
    const canvasOf = (source, w, h, sx, sy, sw, sh) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      canvas.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    };
    const image = {
      isEmpty: () => !state.url,
      get __dataUrl() {
        return state.url;
      },
      getSize: () => whenReady().then((b) => ({ width: b.width, height: b.height })),
      toDataURL: () => whenReady().then(() => state.url),
      toPNG: () => whenReady().then(() => dataUrlBytes(state.url)),
      toJPEG: (quality) =>
        whenReady()
          .then((b) => {
            const canvas = document.createElement("canvas");
            canvas.width = b.width;
            canvas.height = b.height;
            canvas.getContext("2d").drawImage(b, 0, 0);
            return canvas.toDataURL("image/jpeg", Number(quality) > 1 ? Number(quality) / 100 : Number(quality) || 0.85);
          })
          .then(dataUrlBytes),
      crop: (rect) =>
        whenReady().then((b) => {
          const r = rectOf(rect);
          return nativeImage(canvasOf(b, r.width, r.height, r.left, r.top, r.width, r.height));
        }),
      resize: (options) =>
        whenReady().then((b) => {
          const opts = options || {};
          const width = round(opts.width) || b.width;
          const height = round(opts.height) || round((b.height * width) / b.width);
          return nativeImage(canvasOf(b, width, height, 0, 0, b.width, b.height));
        }),
    };
    return image;
  }

  const screenApi = {
    getCursorScreenPoint: () => widget.call("screen.cursor"),
    getPrimaryDisplay: () => widget.call("screen.primary"),
    getAllDisplays: () => widget.call("screen.displays"),
    getDisplayNearestPoint: (point) => widget.call("screen.nearest", pointOf(point)),
    getDisplayMatching: (rect) => widget.call("screen.matching", rectOf(rect)),
    screenToDipPoint: (point) => widget.call("screen.toDip", pointOf(point)),
    dipToScreenPoint: (point) => widget.call("screen.toScreen", pointOf(point)),
    screenToDipRect: (rect) => widget.call("screen.toDip", rectOf(rect)),
    dipToScreenRect: (rect) => widget.call("screen.toScreen", rectOf(rect)),
    capture: (display) => widget.call("screen.capture").then(nativeImage),
    captureDisplay: (display) =>
      widget.call("screen.captureDisplay", { display: round(display) }).then(nativeImage),
    /** 交互截屏：交给 Windows 的截图浮层（ms-screenclip:），选完从剪贴板取图；取消得到 null。 */
    captureInteractive: (timeout) =>
      widget.call("screen.captureInteractive", { timeout: round(timeout) || 45000 }).then((url) =>
        url ? nativeImage(url) : null
      ),
  };

  /** 光标下的颜色：{ hex: "#RRGGBB", rgb: "rgb(r, g, b)" }。 */
  const screenColorPick = () => widget.call("screen.colorPick");

  // ── 复制 ────────────────────────────────────────────────────────────────
  function copyImage(source) {
    const url = typeof source === "string" ? source : source && source.__dataUrl;
    return widget.call("clipboard.writeImage", { image: String(url || "") });
  }

  function getCopyedFiles() {
    return widget.call("clipboard.readFiles");
  }

  // ── 输入：先把卡片藏起来，再在原来的窗口里粘贴/打字 ──────────────────────
  const inputApi = {
    hideMainWindowPasteText: (text) => widget.call("input.pasteText", { text: String(text ?? "") }),
    hideMainWindowPasteFile: (path) =>
      widget.call("input.pasteFile", { paths: [].concat(path || []).map(String) }),
    hideMainWindowPasteImage: (image) => {
      const url = typeof image === "string" ? image : image && image.__dataUrl;
      return widget.call("input.pasteImage", { image: String(url || "") });
    },
    hideMainWindowTypeString: (text) => widget.call("input.typeString", { text: String(text ?? "") }),
  };

  // ── 数据库：宿主侧文档库（data/db/<widget>.json） ───────────────────────
  const dbApi = {
    put: (doc) => widget.call("db.put", { doc }),
    get: (id) => widget.call("db.get", { id: String(id) }),
    // uTools takes a doc (or an id); the host takes either, so keep the shape the caller used.
    remove: (doc) =>
      widget.call("db.remove", typeof doc === "string" ? { id: String(doc) } : { doc }),
    bulkDocs: (docs) => widget.call("db.bulkDocs", { docs: docs || [] }),
    allDocs: (key) => widget.call("db.allDocs", key || {}),
    postAttachment: (id, data, type) =>
      widget.call("db.postAttachment", {
        id: String(id),
        type: String(type || "application/octet-stream"),
        // uTools 收 Buffer/Uint8Array；这里转 base64 传过去。
        data: String(data == null ? "" : data),
      }),
    getAttachment: (id) => widget.call("db.getAttachment", { id: String(id) }).then(nativeImage),
    getAttachmentType: (id) => widget.call("db.getAttachmentType", { id: String(id) }),
    replicateStateFromCloud: () => widget.call("db.replicateStateFromCloud"),
  };

  // ── 定时任务 ────────────────────────────────────────────────────────────
  function requestSchedule(schedule) {
    return widget.call("schedule.request", { schedule });
  }

  function getSchedules() {
    return widget.call("schedule.list");
  }

  function removeSchedule(code) {
    return widget.call("schedule.remove", { code: String(code) });
  }

  /** 到点了就跑回调；抛错/reject 会回报给宿主记成失败，与 uTools 的统计口径一致。 */
  function onScheduleTrigger(fn) {
    if (typeof fn !== "function") return;
    widget.on("schedule", (d) => {
      const payload = d || {};
      let settled;
      try {
        settled = Promise.resolve(fn(payload));
      } catch (e) {
        widget.call("schedule.result", { code: payload.code, ok: false, message: String(e && e.message || e) }).catch(() => {});
        return;
      }
      settled.then(
        () => widget.call("schedule.result", { code: payload.code, ok: true }).catch(() => {}),
        (e) => widget.call("schedule.result", { code: payload.code, ok: false, message: String(e && e.message || e) }).catch(() => {})
      );
    });
  }

  // ── 模拟操作（坐标单位是物理像素，与 uTools 一致，不缩放） ────────────────
  const simulateApi = {
    simulateKeyboardTap: (key, ...modifiers) =>
      widget.call("simulate.keyboardTap", { key: String(key), modifiers: modifiers.map(String) }),
    simulateMouseMove: (x, y) => widget.call("simulate.mouseMove", { x: Number(x), y: Number(y) }),
    simulateMouseClick: (x, y) => widget.call("simulate.mouseClick", { x: Number(x), y: Number(y) }),
    simulateMouseDoubleClick: (x, y) =>
      widget.call("simulate.mouseDoubleClick", { x: Number(x), y: Number(y) }),
    simulateMouseRightClick: (x, y) =>
      widget.call("simulate.mouseRightClick", { x: Number(x), y: Number(y) }),
  };

  // ── 动态功能 ────────────────────────────────────────────────────────────
  const featureApi = {
    getFeatures: (codes) => widget.call("features.get", { codes: codes || null }),
    setFeature: (feature) => widget.call("features.set", { feature }),
    removeFeature: (code) => widget.call("features.remove", { code: String(code) }),
  };

  // ── 快捷入口 ────────────────────────────────────────────────────────────
  const redirectApi = {
    redirect: (label, payload) => widget.call("redirect.to", { label, payload }),
    redirectHotKeySetting: (cmdLabel, autocopy) =>
      widget.call("redirect.hotkey", { cmdLabel: String(cmdLabel || ""), autocopy: !!autocopy }),
    getCmdHotKey: (cmdLabel) => widget.call("redirect.hotkeyGet", { cmdLabel: String(cmdLabel || "") }),
  };

  // ── Sharp：把链式调用收进 ops 数组，最后一次 sharp.run ───────────────────
  const SHARP_REFUSED = ["tint", "median", "composite", "trim", "normalize"];

  function sharpFactory(input, options) {
    const ops = [];
    let format = "png";
    let quality = 0;
    const source = (() => {
      if (input == null) return { create: { width: 1, height: 1 } };
      if (typeof input === "string") {
        return /^data:/i.test(input) ? { data: input } : { path: input };
      }
      if (input && typeof input === "object" && (input.width || input.height || input.create)) {
        return input.create ? { create: input.create } : { create: input };
      }
      if (input && input.__dataUrl) return { data: input.__dataUrl };
      return { data: String(input) };
    })();

    const api = {
      resize: (width, height) => {
        ops.push({ op: "resize", width: width == null ? undefined : Number(width), height: height == null ? undefined : Number(height) });
        return api;
      },
      rotate: (angle) => {
        ops.push({ op: "rotate", angle: Number(angle) || 0 });
        return api;
      },
      flip: () => { ops.push({ op: "flip" }); return api; },
      flop: () => { ops.push({ op: "flop" }); return api; },
      extract: (rect) => { ops.push({ op: "extract", ...rectOf(rect) }); return api; },
      extend: (edges) => { ops.push({ op: "extend", ...(edges || {}) }); return api; },
      grayscale: () => { ops.push({ op: "grayscale" }); return api; },
      negate: () => { ops.push({ op: "negate" }); return api; },
      blur: (sigma) => { ops.push({ op: "blur", sigma: Number(sigma) || 1 }); return api; },
      sharpen: (sigma, flat, jagged) => {
        ops.push({ op: "sharpen", sigma: Number(sigma) || 1, threshold: Number(flat) || 0, jagged: Number(jagged) || 0 });
        return api;
      },
      threshold: (level) => { ops.push({ op: "threshold", threshold: Number(level) || 128 }); return api; },
      gamma: (value) => { ops.push({ op: "gamma", gamma: Number(value) || 1 }); return api; },
      flatten: (background) => { ops.push({ op: "flatten", background: background && String(background) }); return api; },
      jpeg: (options) => {
        format = "jpeg";
        if (options && options.quality) quality = Number(options.quality);
        return api;
      },
      png: () => { format = "png"; return api; },
      webp: () => { format = "webp"; return api; },
      tiff: () => { format = "tiff"; return api; },
      clone: () => sharpFactory(input, options),
      toBuffer: () =>
        widget
          .call("sharp.run", { input: source, ops, output: { format, target: "buffer", quality: quality || undefined } })
          .then((r) => dataUrlBytes("data:image/" + (format === "jpeg" ? "jpeg" : format) + ";base64," + r.data)),
      toUint8Array: () => api.toBuffer(),
      toFile: (path) =>
        widget.call("sharp.run", {
          input: source,
          ops,
          output: { format, target: "file", path: String(path), quality: quality || undefined },
        }),
      metadata: () =>
        widget.call("sharp.run", { input: source, ops, output: { format, target: "metadata" } }),
    };
    for (const name of SHARP_REFUSED) {
      api[name] = () => {
        throw unsupportedError("sharp." + name);
      };
    }
    return api;
  }

  // ── uBrowser：只有页面抓取 ──────────────────────────────────────────────
  function ubrowserFactory(url) {
    const api = {
      goto: (target) => ubrowserFactory(String(target)),
      run: () =>
        widget.call("ubrowser.fetch", { url: String(url), timeout: 20000 }).then((r) => {
          if (r && r.skipped && r.skipped.length) {
            console.warn("utools.ubrowser: 以下交互步骤没有执行（没有内嵌浏览器）：" + r.skipped.join("、"));
          }
          return r;
        }),
    };
    for (const name of ["click", "input", "press", "select", "wait", "screenshot", "evaluate", "download", "scroll"]) {
      api[name] = () => {
        throw unsupportedError("ubrowser." + name);
      };
    }
    return api;
  }

  Object.assign(utools, {
    screen: screenApi,
    screenColorPick,
    copyImage,
    copyFile: (path) => widget.call("clipboard.writeFiles", { paths: [].concat(path || []).map(String) }),
    getCopyedFiles,
    ...inputApi,
    db: dbApi,
    requestSchedule,
    getSchedules,
    removeSchedule,
    onScheduleTrigger,
    ...simulateApi,
    ...featureApi,
    ...redirectApi,
    sharp: (input, options) => sharpFactory(input, options),
    ubrowser: {
      goto: (url) => ubrowserFactory(String(url)),
      run: () => {
        throw unsupportedError("ubrowser.run");
      },
    },
  });
  // uTools 的 db.promises 就是异步版本身；这里所有方法本来就是 Promise。
  dbApi.promises = dbApi;

  // 未知成员（AI、FFmpeg、支付……）不要返回 undefined：
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

  // ── 生命周期：ready → enter → out，顺序与 uTools 对齐 ───────────────────
  let readyDone = false;
  let readyChain = null;
  let entered = false;
  let pendingEnter = null;

  function enterAction(from) {
    return {
      code: widget.id,
      type: "text",
      payload: "",
      from: ENTRY_FROM[from] || "main",
    };
  }

  /** Runs onPluginReady callbacks in order and only then lets the enter through. */
  function runReady() {
    if (readyChain) return readyChain;
    const queue = listeners.ready.splice(0);
    readyChain = (async () => {
      for (const fn of queue) {
        try {
          await fn();
        } catch (e) {
          console.error("utools.onPluginReady:", e);
        }
      }
      readyDone = true;
      if (pendingEnter) {
        const from = pendingEnter;
        pendingEnter = null;
        fireEnter(from);
      }
    })();
    return readyChain;
  }

  function fireEnter(from) {
    if (!readyDone) {
      pendingEnter = from || "startup";
      runReady();
      return;
    }
    entered = true;
    const action = enterAction(from);
    for (const fn of listeners.enter.slice()) {
      try {
        fn(action);
      } catch (e) {
        console.error("utools.onPluginEnter:", e);
      }
    }
  }

  function fireOut(kill) {
    if (!entered && !kill) return;
    entered = false;
    for (const fn of listeners.out.slice()) {
      try {
        fn(!!kill);
      } catch (e) {
        console.error("utools.onPluginOut:", e);
      }
    }
  }

  if (typeof widget.on === "function") {
    widget.on("ready", () => runReady());
    widget.on("show", (d) => fireEnter((d && d.from) || "startup"));
    widget.on("hide", () => fireOut(false));
    widget.on("unload", () => fireOut(true));
    // ── 自定义窗口的两条消息通道 ──────────────────────────────────
    // 宿主说某个窗口的页面起来了（createBrowserWindow 的 callback 等这个）。
    widget.on("win.loaded", (d) => {
      const win = d && windowsById.get(d.id);
      if (win) win.__loaded(d.state);
    });
    widget.on("win.closed", (d) => {
      const win = d && windowsById.get(d.id);
      if (win) win.__closed();
    });
    // 父/子窗口发来的消息，交给页面里的 ipcRenderer.on(channel, …)。
    widget.on("ipc", (d) => ipcDispatch(d && d.channel, d && d.args));
  }

  // 页面侧 IPC 兼容层：uTools 插件在自定义窗口里用 ipcRenderer.on 收消息，
  // 这里给一个同名对象，不必改插件代码（它背后是本组件的窗口消息，不是 Electron）。
  if (typeof window !== "undefined" && !window.ipcRenderer) {
    Object.defineProperty(window, "ipcRenderer", {
      value: ipcRenderer,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  }

  // 自定义窗口里 window.close() 关不掉（没有 Electron 的窗口宿主），改成请宿主关这个窗口。
  if (WINDOW_TYPE === "custom") {
    try {
      const closeWin = () => {
        widget.call("win.close", { win: widget.windowId }).catch(() => {});
      };
      Object.defineProperty(window, "close", {
        value: closeWin,
        writable: true,
        configurable: true,
      });
    } catch (e) {
      /* 页面自己定义了 close，就不动它 */
    }
  }
  // 页面卸载兜底：宿主没来得及发 unload（窗口被系统销毁）时，仍按「进程结束」算一次。
  window.addEventListener("beforeunload", () => fireOut(true), { once: true });
})();
