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
    preload: "webPreferences.preload 不会执行：WinWidget 没有 Node / Electron，页面侧用 ipcRenderer 兼容层代替",
    sendToParent: "只在本组件自己的窗口之间传递；没有 Electron 主进程",
    createBrowserWindow: "窗口异步建出来，id 要等返回的 Promise；尺寸/位置先用本地镜像值应答",
    readCurrentFolderPath: "读不到前台资源管理器路径",
    readCurrentBrowserUrl: "读不到前台浏览器地址",
    onPluginDetach: "每张卡片本身就是独立窗口，没有「从主窗口分离」这一步；回调会登记但永不触发",
  };
  const UNSUPPORTED = [
    "AI 能力（utools.ai 等）", "定时任务（onScheduleTrigger / requestSchedule）",
    "搜索框推送（onMainPush）", "跨设备同步（onDbPull）",
    "模拟操作（键盘/鼠标注入）", "动态功能", "快捷入口",
    "uBrowser 内嵌浏览器", "Sharp 图片处理", "FFmpeg 音视频处理", "支付",
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
    /** 定时任务：WinWidget 没有调度器，注册即抛 utools.unsupported。 */
    onScheduleTrigger: () => {
      throw unsupportedError("onScheduleTrigger");
    },
    /** 搜索框推送：WinWidget 没有 uTools 那种搜索框，注册即抛 utools.unsupported。 */
    onMainPush: () => {
      throw unsupportedError("onMainPush");
    },
    /** 跨设备同步：WinWidget 没有同步机制，注册即抛 utools.unsupported。 */
    onDbPull: () => {
      throw unsupportedError("onDbPull");
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
