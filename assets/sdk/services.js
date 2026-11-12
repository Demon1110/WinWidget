/*! WinWidget preload-compat shim.
 *
 * uTools plugins may ship a `preload.js` that puts a `window.services` bridge in the page. That
 * script runs under Node in Electron's preload context, which WinWidget does not have, so a page
 * like uTools' 剪贴板 plugin dies on its first `window.services.xxx()` call — a whole white page.
 *
 * This file stands in for that bridge: the same method names, answered by the host over the normal
 * bridge (`widget.call`). Coverage is deliberately honest rather than complete — anything not
 * implemented here is defined as a no-op that logs once, so the page still renders its own UI.
 *
 * Loaded after `utools.js`; if a real `window.services` already exists (a self-contained page that
 * built its own bridge), this leaves it alone and does nothing.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof widget === "undefined") return;
  if (window.services) return;

  const call = (m, p) => widget.call(m, p);
  /**
   * A page that mounted a moment before the user allowed this widget's permissions gets
   * "permission denied" on its first read and would stay empty forever. Keep asking for a while
   * instead: consent, or an install that grants it, lands within a few seconds.
   */
  const callWhenAllowed = async (m, p, tries = 12) => {
    for (let i = 0; i < tries; i++) {
      try {
        return await call(m, p);
      } catch (err) {
        const text = String((err && err.message) || err);
        if (!/permission denied|not allowed/i.test(text) || i === tries - 1) throw err;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    return undefined;
  };
  const warn = (what) => {
    if (warned[what]) return;
    warned[what] = true;
    console.warn("[WinWidget] window.services." + what + " is not bridged by this host (no preload/Node) — ignored");
  };
  const warned = Object.create(null);

  /** A no-op that still satisfies `await` and `.map()` style calls further down the page. */
  const noop = (name) =>
    function () {
      warn(name);
      return Promise.resolve(undefined);
    };

  // ── clipboard history (uTools 剪贴板 plugin) ───────────────────────────────
  let seen = null; // Set of record ids already handed to the page
  let timer = 0;

  function newest(list) {
    return Array.isArray(list) ? list : [];
  }

  function startWatching(fn) {
    if (timer) return;
    timer = setInterval(async () => {
      let list;
      try {
        list = newest(await callWhenAllowed("clipboard.history", {}));
      } catch {
        return;
      }
      if (!seen) {
        seen = new Set(list.map((r) => r && r._id));
        return; // the first round only establishes the baseline
      }
      const fresh = list.filter((r) => r && !seen.has(r._id));
      fresh.forEach((r) => seen.add(r._id));
      // Oldest first, the order a listener would have received them in.
      for (const record of fresh.reverse()) {
        try {
          fn(record);
        } catch (err) {
          console.error("[WinWidget] services listener threw:", err);
        }
      }
    }, 800);
  }

  function stopWatching() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  const recordPaths = (records) => {
    const paths = [];
    (records || []).forEach((r) => {
      if (!r || r.type !== "files" || !Array.isArray(r.value)) return;
      r.value.forEach((f) => f && typeof f.path === "string" && paths.push(f.path));
    });
    return paths;
  };

  window.IS_APP_PUBLIC = true;

  window.services = {
    // ── records ──
    readAllRecords: async () => newest(await callWhenAllowed("clipboard.history", {})),
    clearAllRecords: async () => {
      stopWatching();
      await call("clipboard.history.clear", {});
      seen = new Set();
    },
    removeRecords: async (ids) => {
      const list = (ids || []).map((v) => String(v));
      await call("clipboard.history.remove", { ids: list });
      if (seen) list.forEach((id) => seen.delete(id));
    },
    listenAppendRecord: (fn) => {
      if (typeof fn !== "function") return;
      startWatching(fn);
      window.addEventListener("unload", stopWatching, { once: true });
    },
    filesExists: async (paths) => {
      const list = (paths || []).map((v) => String(v));
      let answer = [];
      try {
        answer = await callWhenAllowed("clipboard.filesExist", { paths: list });
      } catch {
        answer = [];
      }
      return list.map((_, i) => (Array.isArray(answer) && typeof answer[i] === "boolean" ? answer[i] : true));
    },

    // ── copy / paste, routed to the uTools API the page already has ──
    executeCopy: (records) => {
      const list = records || [];
      const kinds = new Set(list.map((r) => r && r.type));
      if (kinds.size === 1 && kinds.has("text")) {
        return window.utools.copyText(list.map((r) => r.value).join("\n"));
      }
      if (kinds.size === 1 && kinds.has("files")) {
        const paths = recordPaths(list);
        if (paths.length) return window.utools.copyFile(paths);
        return undefined;
      }
      const paths = recordPaths(list);
      if (paths.length) return window.utools.copyFile(paths);
      warn("executeCopy (mixed record types)");
      return undefined;
    },
    executePaste: (records) => {
      const list = records || [];
      const texts = list.filter((r) => r && r.type === "text").map((r) => r.value);
      const paths = recordPaths(list);
      if (texts.length) window.utools.hideMainWindowPasteText(texts.join("\n"));
      if (paths.length) window.utools.hideMainWindowPasteFile(paths);
      if (!texts.length && !paths.length) warn("executePaste (pictures are not bridged)");
    },
    dragToFiles: noop("dragToFiles"),
    pinScreen: noop("pinScreen"),
    pinScreenListenReceiveData: noop("pinScreenListenReceiveData"),
    enterToPinData: noop("enterToPinData"),
    mcpPinData: noop("mcpPinData"),
    collectPutDB: async () => [],
  };

  // A plugin that gates on a real preload may check this; there is no Node here.
  if (typeof window.require !== "function") {
    window.require = function (name) {
      warn("require(" + name + ")");
      throw new Error("WinWidget has no Node.js: require('" + name + "') is not available");
    };
  }
})();
