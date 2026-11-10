//! The script injected before any page runs.
//!
//! wry only lets a page post strings, while FullWidget's SDK (and the control center) speak
//! objects. This shim keeps that protocol intact: `postMessage` stringifies what a page sends,
//! and `__WV_DELIVER` hands host messages to the listeners as a `MessageEvent` with an object —
//! the same shape WebView2's own `PostWebMessageAsJson` produces.

pub const SCRIPT: &str = r#"
(function () {
  if (window.__WV_READY) return;
  window.__WV_READY = true;

  var wv = (window.chrome && window.chrome.webview) || null;
  var listeners = [];

  function deliver(obj) {
    var ev;
    try { ev = new MessageEvent("message", { data: obj }); } catch (e) { ev = { data: obj }; }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](ev); } catch (e) { console.error(e); }
    }
  }

  if (wv) {
    var patched = false;
    try {
      var add = wv.addEventListener;
      var remove = wv.removeEventListener;
      Object.defineProperty(wv, "addEventListener", {
        configurable: true,
        value: function (type, fn) { if (type === "message") listeners.push(fn); else if (add) add.call(wv, type, fn); }
      });
      Object.defineProperty(wv, "removeEventListener", {
        configurable: true,
        value: function (type, fn) {
          if (type === "message") { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
          else if (remove) remove.call(wv, type, fn);
        }
      });
      patched = true;
    } catch (e) {
      patched = false;
    }

    try {
      var post = wv.postMessage;
      Object.defineProperty(wv, "postMessage", {
        configurable: true,
        value: function (m) { post.call(wv, typeof m === "string" ? m : JSON.stringify(m)); }
      });
      Object.defineProperty(wv, "postMessageWithAdditionalObjects", {
        configurable: true,
        value: function (m) { post.call(wv, typeof m === "string" ? m : JSON.stringify(m)); }
      });
    } catch (e) { /* the page will fall back to its own handling */ }
  }

  window.__WV_DELIVER = function (obj) {
    if (patched) return deliver(obj);
    if (wv && wv.dispatchEvent) {
      try { wv.dispatchEvent(new MessageEvent("message", { data: obj })); return; } catch (e) { /* fall through */ }
    }
    deliver(obj);
  };

  // Nothing outside a widget page needs a native context menu or page zoom.
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); }, false);
  document.addEventListener("dragstart", function (e) { if (e.target && e.target.tagName === "IMG") e.preventDefault(); }, false);
})();
"#;
