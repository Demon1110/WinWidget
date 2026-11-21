/* 多窗口测试台：每行一个用例。窗口 key 沿用 a / b，方便反复点。 */

const results = document.getElementById("results");
const list = document.getElementById("cases");

function record(label, startedAt, payload) {
  const li = document.createElement("li");
  const ms = Math.round(performance.now() - startedAt);
  li.innerHTML = `<strong>${label}</strong> <span class="ms">${ms} ms</span>`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(payload);
  li.appendChild(pre);
  results.prepend(li);
  console.error(`[simples-window] ${label} → ${JSON.stringify(payload)}`);
}

function runner(label, fn) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    const startedAt = performance.now();
    try {
      record(label, startedAt, await fn());
    } catch (err) {
      record(label, startedAt, { error: String((err && err.message) || err) });
    } finally {
      busy = false;
    }
  };
}

function button(label, hint, run) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "case";
  b.innerHTML = `<span class="case-label">${label}</span><span class="case-hint">${hint}</span>`;
  b.addEventListener("click", run);
  list.appendChild(b);
  return b;
}

/** 子窗共用的外观：无边框 + 半透明 + 圆角，跟卡片一套主题变量。 */
const PANEL = {
  html: "panel.html",
  width: 320,
  height: 240,
  frame: false,
  transparent: true,
  resizable: false,
};

function openPanel(key, extra) {
  return widget.windows.open({ ...PANEL, ...(extra || {}), key, title: `子窗 ${key}` });
}

/** 等窗口的 closed 结果：{ reason, button, value, result }。 */
function whenClosed(handle, timeoutMs) {
  return Promise.race([
    handle.closed,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs || 12000)),
  ]);
}

const CASES = [
  [
    "开窗 A（同 key 反复点应复用）",
    "第二次点不该多出一个窗口，只是把 A 叫到前面",
    async () => {
      const w = openPanel("a");
      await w.loaded;
      const reopened = openPanel("a");
      return { id: w.id, sameId: reopened.id === w.id, count: (await widget.windows.list()).length };
    },
  ],
  [
    "开窗 B（新 key，另一个 id）",
    "两个窗口可以同时存在，id 不同",
    async () => {
      const b = openPanel("b");
      await b.loaded;
      return { id: b.id, count: (await widget.windows.list()).length };
    },
  ],
  [
    "windows.list",
    "key / kind / title / visible / focused 都在",
    () => widget.windows.list(),
  ],
  [
    "windows.has / find",
    "has('a') 应为 true；find 拿到 handle 的 id",
    async () => {
      const has = await widget.windows.has("a");
      const found = await widget.windows.find("b");
      return { has: has, foundId: found && found.id };
    },
  ],
  [
    "post 给 A",
    "A 页面顶上会出现「收到 ping」",
    () => widget.windows.post("a", "ping", Date.now()),
  ],
  [
    "broadcast 给所有窗口",
    "A、B 都收到，卡片自己不会收到",
    () => widget.windows.broadcast("all-hands", { at: Date.now() }),
  ],
  [
    "close A（reason=by-key）",
    "关闭原因会出现在 A 的 closed 结果里",
    async () => {
      const handle = widget.windows.get("a");
      if (!handle) return { note: "先开窗 A" };
      const closed = whenClosed(handle);
      await widget.windows.close("a", "by-key");
      return await closed;
    },
  ],
  [
    "closeOnEsc",
    "按 Esc 应该自己关掉，reason=esc",
    async () => {
      const w = openPanel("esc", { closeOnEsc: true, title: "Esc 关我" });
      return await whenClosed(w);
    },
  ],
  [
    "closeOnBlur",
    "点一下别处（比如卡片）就该关掉",
    async () => {
      const w = openPanel("blur", { closeOnBlur: true, title: "失焦关我" });
      return await whenClosed(w);
    },
  ],
  [
    "closeOnOutsideClick",
    "点到窗口外面才关，点窗口自己不算",
    async () => {
      const w = openPanel("outside", { closeOnOutsideClick: true, title: "点外面关我" });
      return await whenClosed(w);
    },
  ],
  [
    "modal 模态",
    "弹出期间卡片点不动，关掉立刻恢复",
    async () => {
      const w = openPanel("modal", { modal: true, title: "模态子窗" });
      return { id: w.id, note: "关掉它再试卡片按钮" };
    },
  ],
  [
    "无边框可拖拽",
    "按住子窗顶栏能拖动整个窗口",
    async () => {
      const w = openPanel("drag", { draggable: true, title: "拖我" });
      await w.loaded;
      return { id: w.id };
    },
  ],
  [
    "透明 + 鼠标穿透（8 秒自关）",
    "整窗只有虚线框和字是画出来的；点框里任意位置等于点它下面的卡片，框里收不到点击",
    async () => {
      const bounds = await widget.window.getBounds();
      const w = widget.windows.open({
        html: "overlay.html",
        key: "overlay",
        title: "鼠标穿透",
        width: 300,
        height: 150,
        x: bounds.x + 20,
        y: bounds.y + 470,
        frame: false,
        transparent: true,
        ignoreMouseEvents: true,
        autoClose: 8000,
        resizable: false,
      });
      await w.loaded;
      const state = await widget.call("win.get", { key: "overlay" });
      return {
        id: w.id,
        ignoreMouse: state && state.ignoreMouse,
        at: state && { x: state.x, y: state.y, width: state.width, height: state.height },
        note: "8 秒后自己关（reason=timeout）",
      };
    },
  ],
  [
    "弹框正文吃 HTML（rawHtml）",
    "同一个 content：rawHtml=true 当标签渲染（加粗/列表/行内上色），不传就原样当文字显示",
    () =>
      widget.dialog.alert({
        title: "HTML 正文",
        rawHtml: true,
        icon: "sparkle",
        width: 460,
        // 挪到桌面左侧：弹框是玻璃底，压在明亮的编辑器窗口上会透出背后的字。
        x: 240,
        y: 260,
        content:
          "<b>这段是 HTML</b>，不是纯文本。<ul>" +
          '<li>加粗、<i>斜体</i>、<span style="color:#4cc2ff">行内上色</span>都照原样</li>' +
          "<li>列表和换行也按标签排</li></ul>" +
          '<p style="opacity:.6">不传 rawHtml 时，这一整串会连尖括号一起当文字显示。</p>',
      }),
  ],
  [
    "弹框整页 HTML（dialog.window）",
    "窗口由组件自己的 rich.html 画；点「就用它」返回 button=apply，点「先不用」返回 button=dismiss",
    async () => {
      const w = widget.dialog.window({
        html: "rich.html",
        key: "rich",
        title: "整页 HTML",
        width: 400,
        height: 300,
        center: true,
      });
      await w.loaded;
      // 人来点按钮，别用用例里那 12 秒的等待上限。
      return await whenClosed(w, 120000);
    },
  ],
  [
    "closeAll",
    "关掉本组件所有自定义窗口，卡片留着",
    async () => {
      const closed = await widget.windows.closeAll();
      return { closed: closed, count: (await widget.windows.list()).length };
    },
  ],
  [
    "卡片自操作：focus + 置顶 + 0.85 透明 + 右移 24",
    "卡片自己会抬到前面、变淡、挪一点，再看 isAlwaysOnTop",
    async () => {
      const bounds = await widget.window.getBounds();
      await widget.window.focus();
      await widget.window.setAlwaysOnTop(true);
      await widget.window.setOpacity(0.85);
      await widget.window.setBounds({ x: bounds.x + 24, y: bounds.y });
      return { bounds: bounds, onTop: await widget.window.isAlwaysOnTop() };
    },
  ],
  [
    "卡片自操作：恢复",
    "透明度回到 1、撤掉置顶",
    async () => {
      await widget.window.setOpacity(1);
      await widget.window.setAlwaysOnTop(false);
      const bounds = await widget.window.getBounds();
      await widget.window.setBounds({ x: bounds.x - 24, y: bounds.y });
      return { bounds: bounds, onTop: await widget.window.isAlwaysOnTop() };
    },
  ],
];

CASES.forEach(([label, hint, fn]) => button(label, hint, runner(label, fn)));

document.getElementById("clear").addEventListener("click", () => {
  results.innerHTML = "";
});
