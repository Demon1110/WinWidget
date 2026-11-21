# 窗口与弹框 API 重构规划

目标：让组件开窗、弹框、多窗口协作变成一组语义清楚、配置丰富、旧代码不用改的 API。

一句话结论：**把「窗口」当成一种有身份、有归属、有生命周期的对象来管理，弹框只是它的一种特化（`kind`），不再让每个组件自己写 HTML + 关闭逻辑。**

---

## 一、现状盘点

现在组件能用的窗口相关入口有三个，各自为政：

| 入口 | 能做什么 | 谁在用 |
|---|---|---|
| `widget.window` | `getSize` / `setSize` / `startDrag` / `hide` / `show`，只针对**卡片自己** | 所有卡片 |
| `utools.createBrowserWindow(url, options, callback)` + `win.*` | 开任意自定义窗口，Electron 风格的 BrowserWindow 方法集，父子单播通信 | 自建面板、桌面特效、桌面提醒的悬浮窗/提醒弹窗 |
| `widget.notify` | Windows 系统通知（托盘气泡），`at` 可定时、`tag` 可取消 | 想到时提醒类 |

### 真实缺口

按用户实际踩过的坑排：

1. **弹框全靠组件手搓**。`desktop-reminder` 为了一个「到时提醒」写了 `alert.html/alert.css/alert.js`，还要自己算 380×300、自己处理 Esc、自己回传结果。55 个组件要是都弹框，就是 55 套长得不一样的弹框。**没有 alert / confirm / prompt / toast。**
2. **多窗口只能父子单播**。`webContents.send` 只能父→子，`sendToParent` 只能子→父；A 窗口想通知兄弟窗口 B 做不到，只能绕一圈回卡片再转发。
3. **窗口 id 全靠页面自己拿变量记**。页面一刷新、或者从另一个窗口反查「我那个设置窗还在不在」就没有办法；重复点「设置」会开出第二个设置窗。
4. **关闭没有原因**。`win.on("closed")` 只带 `id`，组件分不清「用户点的 ×」「自己调的 close」「卡片被移除连带关的」。
5. **无边框窗拖不动**。`frame:false` 之后没有 `-webkit-app-region` 那种拖拽区，得自己写 `startDrag`；窗口也没有 `closeOnEsc`、`closeOnBlur`、`autoClose`、出现动画。
6. **定位只有绝对坐标**。想让弹框贴在卡片旁边、跟着卡片走、超出屏幕自动翻面，全得自己算。
7. **卡片自身能力弱**。卡片不能 `focus()`、不能主动置顶、不能设透明度、不能关掉自己。

---

## 二、设计原则

1. **旧的不动**。`utools.createBrowserWindow`、`win.*`、`widget.window.*`、`widget.notify` 全部保留原语义，新能力只做加法。55 个组件一行不用改。
2. **一个组件 = 一个窗口域**。窗口、弹框都在本组件内，跨组件通信不做（那是另一套安全模型）。
3. **身份三件套**：`id`（宿主分配、永不复用）、`key`（组件起的名字、可幂等复用）、`parent`（谁开的）。
4. **配置分层**：外观 / 尺寸位置 / 行为 / 内容 / 生命周期，同一套字段名在 `windows.open` 和 `dialog.*` 里通用，学一次就够。
5. **能力要有真实现**。做不到的（如窗口阴影、任务栏进度）继续回 `{unsupported: "原因"}`，不静默。
6. **弹框由宿主渲染**。内置一套和主题一致的页面，组件只传配置；想要完全自定义时用 `html:` 指自己的页面，外观配置仍生效。

---

## 三、三个 API 面

```
widget.window   —— 当前这个窗口（卡片或自定义窗口通用），自省与自我操作
widget.windows  —— 多窗口集合：开窗、枚举、查找、定向通信、广播、关闭
widget.dialog   —— 宿主渲染的弹框：alert / confirm / prompt / toast / 自定义
```

`widget.dialog` 内部就是一个 `kind` 打了标记的自定义窗口，所以 `windows.list()` 里能看到它，也能用 `windows.close(key)` 关掉它。

### 3.1 `widget.window`（当前窗口）

| 方法 | 说明 | 状态 |
|---|---|---|
| `type` | `"main"`（卡片）/ `"custom"` | ✅ 已有 `windowType` |
| `id` | 自定义窗口的 id，卡片为 0 | ✅ 已有 `windowId` |
| `getSize()` / `setSize(w,h)` | 页面区域 | ✅ 卡片已有 |
| `getBounds()` / `setBounds(b)` | 位置 + 尺寸 | 🆕 卡片补 |
| `getPosition()` / `setPosition(x,y)` | 屏幕位置 | 🆕 卡片补 |
| `center()` / `centerOn(anchor)` | 屏幕居中 / 贴到卡片、光标、某显示器 | 🆕 |
| `focus()` / `blur()` | 抢/放焦点 | 🆕 卡片补 |
| `setAlwaysOnTop(b)` / `isAlwaysOnTop()` | 置顶 | 🆕 卡片补 |
| `setOpacity(o)` | 0–1 | 🆕 卡片补 |
| `setTitle(t)` | 标题（卡片是多窗口列表里显示的名字） | 🆕 卡片补 |
| `show()` / `hide()` / `isVisible()` | 显隐 | ✅ 卡片已有 hide/show |
| `startDrag()` | 开始拖拽 | ✅ |
| `close(reason)` | 关掉自己（卡片 = 收起） | 🆕 |
| `setIgnoreMouseEvents(b)` | 鼠标穿透 | 🆕 卡片补 |

卡片上原来要 4 次 IPC 才能拼出来的"把自己挪到 (x,y) 并保持尺寸"，现在 `setBounds` 一次搞定。

### 3.2 `widget.windows`（多窗口）

| 方法 | 说明 |
|---|---|
| `open(options)` → `handle` | 开窗（或按键复用已有窗口） |
| `list()` | `[{id, key, kind, title, visible, focused, parent, createdAt}]` |
| `get(idOrKey)` | 那个窗口的 handle，没有就 `null` |
| `has(idOrKey)` | 布尔快捷方式 |
| `post(idOrKey, channel, ...args)` | 定向发消息（可以是兄弟窗口） |
| `broadcast(channel, ...args)` | 广播给本组件所有窗口（含卡片自己） |
| `close(idOrKey, reason)` | 关一个，`reason` 会传给等它的人 |
| `closeAll(filter)` | 按 `{kind, key前缀}` 批量关 |
| `on("opened" / "closed" / "message", fn)` | 集合级事件 |

handle 与 BrowserWindow 对象**是同一个东西**（同一份本地镜像），所以旧写法 `win.setSize(500,300)` 照旧能用，新写法 `windows.get("settings").setSize(...)` 拿到的是同一个对象。

```js
// 幂等开窗：连点五次「设置」只开一个
const settings = widget.windows.open({
  key: "settings",
  reuse: true,              // 默认 true：同 key 已存在就 focus 并返回它
  html: "settings.html",
  width: 520, height: 380,
  title: "设置",
  showTitle: false,          // 自绘标题，不带系统标题条
  frame: false,              // 无边框 + 圆角
  rounded: true,
  draggable: true,           // 无边框也能拖：宿主接管空白区拖拽
  closeOnEsc: true,
  animation: "slide",        // 出现动画
  anchor: "card",            // 贴在卡片旁边，出屏自动翻面
  offset: { x: 12, y: 0 },
});
```

### 3.3 身份与生命周期

| 概念 | 规则 |
|---|---|
| `id` | 宿主分配，从 1 递增，**永不复用**；上限同时 24 个窗口 |
| `key` | 组件内唯一；空 key 表示匿名窗口（不可按键查找，只能 id） |
| `reuse` | `true`（默认）：同 key 存在 → `focus()` 后返回原 handle；`false`：强制开新的，旧的自动加后缀 |
| `parent` | `dialog` 默认 `card`；`windows.open` 默认调用者所在窗口（卡片或某窗口） |
| `kind` | `"window"` / `"alert"` / `"confirm"` / `"prompt"` / `"toast"` / `"custom"` |
| 级联关闭 | 父窗口关闭 → 子窗口关（`reason:"parent"`）；组件卸载 → 全关（`"owner"`）；程序退出 → 全关 |
| 关闭原因 | `api` / `user`（点了 × 或 `window.close()`）/ `esc` / `blur` / `outside` / `timeout` / `button`（点了按钮）/ `parent` / `owner` / `destroyed` |

`closed` 事件与 `closed` Promise 都带同一个原因，组件终于能区分"用户关的"和"自己被连带关的"。

---

## 四、配置矩阵

同一套字段，`windows.open` 与 `dialog.*` 通用。✅ = 现有已支持，🆕 = 本次新增。

### 外观

| 字段 | 类型 | 默认 | 说明 | 状态 |
|---|---|---|---|---|
| `title` | string | `""` | 窗口标题 / 弹框标题 | ✅ |
| `showTitle` | bool | `false`（弹框）/ `true`（窗口） | 是否画标题条 | 🆕 |
| `icon` | string | 无 | 内置图标名或图片路径 | 🆕 |
| `frame` | bool | `true`（窗口）/ `false`（弹框） | 系统边框 | ✅ |
| `rounded` | bool | `true` | 圆角 | ✅ |
| `shadow` | bool | `true`（窗口）/ `false`（弹框） | 投影 | 🆕 |
| `transparent` | bool | `false` | 透明底 | ✅ |
| `backgroundColor` | string | 白 / 主题色 | `#0f1a24`、`rgba(...)` | ✅ |
| `opacity` | number | `1` | 整窗不透明度 | ✅ |
| `theme` | `"inherit"` / `"light"` / `"dark"` | `inherit` | 内置弹框跟随卡片主题或强制深浅 | 🆕 |
| `accentColor` | string | 主题强调色 | 主按钮、图标色 | 🆕 |
| `blur` | bool | `false` | 背景毛玻璃（仅 `transparent` 时生效） | 🆕 |
| `animation` | `"none"` / `"fade"` / `"slide"` / `"scale"` | `fade` | 出现/消失动画 | 🆕 |
| `animationMs` | number | `160` | 动画时长 | 🆕 |

### 尺寸与位置

| 字段 | 类型 | 默认 | 说明 | 状态 |
|---|---|---|---|---|
| `width` / `height` | number | 800×600（窗口）/ 380×自适应（弹框） | 页面区域 | ✅ |
| `minWidth` / `minHeight` / `maxWidth` / `maxHeight` | number | 无 | 拖边上下限 | ✅ |
| `fitContent` | bool | `true`（弹框）/ `false`（窗口） | 内容变化时窗口高度跟着变 | 🆕 |
| `x` / `y` | number | 无 | 绝对位置 | ✅ |
| `center` | bool | 弹框 `true` | 当前显示器居中 | ✅ |
| `anchor` | `"card"` / `"cursor"` / `"screen"` / `"window:idOrKey"` / `{x,y}` | 弹框 `"card"` | 相对谁定位 | 🆕 |
| `offset` | `{x,y}` | `{0,0}` | 相对 anchor 的偏移 | 🆕 |
| `flip` | `"auto"` / `"none"` | `auto` | 出屏时自动翻到另一侧 | 🆕 |
| `monitor` | number | 当前 | 指定显示器索引 | 🆕 |

### 行为

| 字段 | 类型 | 默认 | 说明 | 状态 |
|---|---|---|---|---|
| `resizable` | bool | `true`（窗口）/ `false`（弹框） | 可拖边 | ✅ |
| `closable` | bool | `true` | 能否关闭（`false` 时 API 关闭也拒绝） | ✅ |
| `draggable` | bool | `true` | 无边框也能拖（宿主接空白区） | 🆕 |
| `dragArea` | string | `"[data-drag]"` | 只在这些元素上拖 | 🆕 |
| `alwaysOnTop` | bool | 窗口 `false` / 弹框 `true` | 置顶 | ✅ |
| `modal` | bool | `false` | 模态：父窗口临时禁用交互 | 🆕 |
| `focusable` | bool | `true` | `false` 不抢焦点（toast / overlay） | ✅ |
| `skipTaskbar` | bool | `true`（弹框） | 不进任务栏 | ✅ |
| `closeOnEsc` | bool | `true`（弹框） | Esc 关闭 | 🆕 |
| `closeOnBlur` | bool | `false` | 失焦自动关（选色器、命令面板用） | 🆕 |
| `closeOnOutsideClick` | bool | `false` | 点窗外关掉 | 🆕 |
| `autoClose` | number / `false` | toast `3000`，其余 `false` | 毫秒后自动关，`reason:"timeout"` | 🆕 |
| `clickThrough` | bool | `false` | 鼠标穿透（叠加层用） | ✅ `ignoreMouseEvents` |
| `layer` | `"normal"` / `"desktop"` / `"wallpaper"` | `normal` | Z 序带 | ✅ |
| `parentOf` | id / key | 调用者 | 显式指定归属窗口 | 🆕 |
| `closeWithParent` | bool | `true` | 父关时跟着关 | 🆕 |
| `progress` | number / `false` | `false` | 标题条进度（不支持则忽略） | 🆕 保留 |

### 内容（弹框专用）

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | string | 正文，纯文本自动转义；`html:true` 时按 HTML 渲染 |
| `html` | string | 用组件自己的页面（`"panel.html?x=1"`），完全自定义 |
| `icon` | string | 内置图标名（`info` / `warn` / `error` / `success` / `bell`）或图片路径 |
| `buttons` | array | `[{id, text, kind: "primary"\|"default"\|"danger", close: true, value}]` |
| `defaultButton` / `cancelButton` | string | 回车 / Esc 对应哪个按钮 |
| `input` | object | prompt 用：`{value, placeholder, multiline, password, maxLength}` |
| `result` | `"button"` / `"value"` | 返回 `{button}` 还是 `{button, value}` |

`toast` 额外：`at`（`"top-left" \| "top" \| "top-right" \| "bottom-left" \| "bottom" \| "bottom-right"`）、`width` 自适应、`stack`（同位置多条自动堆叠）。

---

## 五、`widget.dialog` 详解

```js
// 提示
const r1 = await widget.dialog.alert({
  title: "到时提醒",
  content: "11:30 的会议要开始了",
  icon: "bell",
  buttons: [{ id: "ok", text: "知道了", kind: "primary" }],
});
// r1 → { button: "ok", reason: "button" }

// 确认
const r2 = await widget.dialog.confirm({
  content: "删除「买菜」这条待办？",
  danger: true,
  buttons: [
    { id: "cancel", text: "取消" },
    { id: "ok", text: "删除", kind: "danger" },
  ],
  cancelButton: "cancel",
});
if (r2.button === "ok") await widget.db.remove("reminder/1");

// 输入
const r3 = await widget.dialog.prompt({
  title: "重命名",
  input: { value: "旧名字", placeholder: "新的名字" },
  buttons: [{ id: "cancel", text: "取消" }, { id: "ok", text: "确定", kind: "primary" }],
});
if (r3.button === "ok") rename(r3.value);

// 轻提示：不阻塞、自动消失、可堆叠
widget.dialog.toast({ content: "已保存", at: "bottom-right", autoClose: 2500 });

// 自定义页面弹框：外观配置照旧生效，内容自己画
const panel = widget.dialog.window({
  key: "picker",
  html: "picker.html",
  width: 320, height: 420,
  frame: false, rounded: true, draggable: true,
  closeOnBlur: true,
});
```

返回约定：

- `alert` / `confirm` / `prompt` → 直接是 `Promise<{button, value?, reason}>`，关闭即 resolve，永不 reject（用户取消不是错误）。
- `toast` → 立即返回 `{id, close()}`。
- `dialog.window` / `windows.open` → 立即返回 handle，带 `closed: Promise<{reason}>`；想等结果就 `await handle.closed`。

内置页面的行为（不需要组件写）：

- Esc / 点遮罩 / 点按钮 → 对应 `reason`；`autoClose` 到点自动关。
- `fitContent: true` 时页面量完高度回传，宿主调窗口高度（弹框不再固定 380×300 留一片空白）。
- 主题、字体、圆角、内距全部吃卡片的 CSS 变量，组件改主题弹框跟着变。
- 内容超长时内部滚动，不撑破窗口。

---

## 六、通信

| 方向 | 新写法 | 旧写法（保留） |
|---|---|---|
| 任一窗口 → 任一窗口 | `widget.windows.post("settings", "refresh", data)` | 无（原来做不到） |
| 任一窗口 → 全组件 | `widget.windows.broadcast("theme-changed", t)` | 无 |
| 父 → 子 | `win.webContents.send("ch", ...)` | ✅ 同一 |
| 子 → 父 | `utools.sendToParent("ch", ...)` | ✅ 同一 |

收消息统一到一处：

```js
widget.on("message", ({ from, channel, args }) => {
  // from: { id, key, kind } —— 谁发的
});
```

自定义窗口页面里 `ipcRenderer.on(channel, (e, ...args) => {})` 继续可用（内部转成 `message` 事件，两套都能收，不重复触发）。

---

## 七、关闭语义

| 场景 | 触发 | reason | 谁能感知 |
|---|---|---|---|
| 点标题条 × | 系统关闭 | `user` | 父窗口 `closed`、该窗口 `closed` Promise |
| 页面 `window.close()` | 页面 | `user` | 同上 |
| `win.close()` / `windows.close()` | 组件 | `api` | 同上（可带自定义 reason 字符串） |
| Esc / 点遮罩 / 点窗外 | 内置弹框 | `esc` / `outside` | `alert` 的 Promise 用 `cancelButton` 收尾 |
| `autoClose` 到点 | 宿主 | `timeout` | Promise resolve |
| 父窗口关闭 | 级联 | `parent` | 子窗口 `closed` |
| 组件被移除 / 程序退出 | 宿主 | `owner` | 已在关闭流程内，页面收不到也无所谓 |
| 系统销毁（任务管理器、崩溃） | 系统 | `destroyed` | 卡片收 `win.closed` |

`closable:false` 只挡用户关闭（×、`window.close()`），`destroy()` 仍能强拆，避免组件把自己锁死。

---

## 八、落点（代码在哪儿）

| 层 | 文件 | 改动 |
|---|---|---|
| 窗口身份 | `src/runtime/window_category.rs` | `CustomWin` 增 `key` / `kind` / `created_at` / `close_reason`；新增 `win.list` / `win.get` / `win.post` / `win.broadcast` / `win.closeAll` |
| 窗口集合 | `src/runtime/app.rs` | `create_custom` 支持 key 查重与复用；`close_custom(id, reason)`；`broadcast(instance, …)`；`close_customs_of` 带 reason |
| 内置弹框 | `src/runtime/dialog.rs`（新） | `DialogSpec` 解析、默认值按 kind 套用、结果回传、`fitContent` 回写高度 |
| 内置页面 | `assets/dialog/{dialog.html,dialog.css,dialog.js}`（新） | 渲染标题/图标/正文/按钮/输入框，回传结果 |
| 页面路由 | `src/ui/server.rs` | `/__fw/dialog.html?w=&win=&dt=<kind>` 走内置页并注入 boot |
| 卡片能力 | `src/runtime/window_category.rs::card_call` | `window.getBounds/setBounds/setPosition/focus/setAlwaysOnTop/setOpacity/setTitle/setIgnoreMouseEvents/close` |
| SDK | `assets/sdk/widget-sdk.js` | `widget.windows`、`widget.dialog`、`widget.window` 扩展、`message` 事件 |
| 兼容层 | `assets/sdk/utools.js` | handle 与 BrowserWindow 对象合一；`win.closed` 带 reason |
| 文档 | `docs/組件開發指南.md`（繁）、`docs/组件开发指南.zh-CN.md`、`docs/widget-guide.en.md` | 新增「窗口与弹框」一章 |
| 版本 | `src/lib.rs` | 不手动 bump（GitHub Actions Release 自动迭代） |

分层约束：`check-arch.py` 那条「core 不反向依赖 runtime」的红线不动，新代码只在 `runtime` 与 `assets` 里。

---

## 九、兼容对照

| 旧写法 | 新写法 | 是否必须迁移 |
|---|---|---|
| `utools.createBrowserWindow(url, opt, cb)` | `widget.windows.open({html:url, ...opt})` | 否，旧的全可用 |
| `win.webContents.send(ch, ...)` | `windows.post(id, ch, ...)` | 否 |
| `utools.sendToParent(ch, ...)` | `windows.post(parentId, ch, ...)` | 否 |
| `win.on("closed")` | `windows.on("closed", ({id, key, reason}) => …)` | 否，旧的仍只给 id |
| 组件自写 alert.html | `widget.dialog.alert({...})` | 建议，弹框样式统一、省一套 HTML |
| `widget.notify()`（系统气泡） | 不变 | 否 |

保留 `notify` 的系统语义：它是"离开 WinWidget 也要看到"的通知，和窗口内 toast 不是一件事，两者并存。

---

## 十、分期

| 期 | 内容 | 风险 | 可独立发版 |
|---|---|---|---|
| **P0** | 身份与多窗口：`key`、`list/get/has`、`post/broadcast`、`close(reason)`、`windows.on` | 低（只加方法） | 是 |
| **P1** | 内置弹框：`dialog.alert/confirm/prompt/toast`、`fitContent`、`/__fw/dialog.html` | 中（新增页面与路由） | 是 |
| **P2** | 配置矩阵：`draggable`、`closeOnEsc`、`closeOnBlur`、`closeOnOutsideClick`、`autoClose`、`animation`、`modal`、`anchor` | 中（动窗口层与 Win32 交互） | 是 |
| **P3** | 文档三语 + `hello-widget` 模板示例 + `desktop-reminder` 迁到 `dialog.alert`（删掉自写的 alert 页） | 低 | 是 |

P3 的迁移是收益最直观的一步：桌面提醒的到时弹窗从"自己写一套 380×300 的页面"变成一次 `dialog.alert` 调用，顺带解决它内容少时下半留白的问题（`fitContent`）。

---

## 十一、示例：一次完整的「多窗口 + 弹框」流程

```js
// card（卡片）
const editor = widget.windows.open({
  key: "editor",
  html: "editor.html",
  width: 640, height: 480,
  title: "编辑待办",
  showTitle: true,
  center: true,
  reuse: true,
});

editor.webContents.send("load", { id: currentId });

widget.windows.on("message", async ({ from, channel, args }) => {
  if (channel !== "save") return;
  await widget.db.put(args[0]);
  widget.dialog.toast({ content: "已保存", at: "bottom-right" });
  widget.windows.post(from.id, "saved", args[0]._id);
});

widget.windows.on("closed", ({ key, reason }) => {
  widget.log(`窗口 ${key} 关闭：${reason}`);
});
```

```js
// editor.html（编辑器窗口）
ipcRenderer.on("load", (e, doc) => fill(doc));

document.getElementById("save").onclick = async () => {
  utools.sendToParent("save", readDoc());
  window.close();              // 宿主记 reason = "user"
};
```

---

## 十二、落地进度

三个拍板点都按「同意」执行，P0 → P3 已落地并推送。

| 阶段 | 状态 | 提交 | 说明 |
|---|---|---|---|
| P0 身份、通信、关闭 | ✅ | `d2b98d8` | `key` 复用、`win.list/get/has/post/broadcast/closeAll`、关闭带 `reason`、卡片补 `focus/setAlwaysOnTop/setOpacity/setBounds` |
| P1 内置弹框页 | ✅ | `d8c16e8` | `widget.dialog` 的 alert / confirm / prompt / toast / window，配置归一在 `runtime/dialog.rs` |
| P2 配置矩阵 | ✅ | `3121d51` | `autoClose` 宿主兜底、`closeOnBlur`、`closeOnOutsideClick`、`modal`、`anchor`/`offset` |
| P3 文档与示例 | ✅ | `b53fb66` | 三语指南新增「弹框与多窗口」整章 |
| P3 desktop-reminder 迁移 | ✅ | Hub `b14c963` + 宿主 `1a3f75b` | 提醒弹窗改走 `widget.dialog.confirm`，删掉 `alert.html/css/js`；宿主放行 `x`/`y`/`center`，给了坐标就不再默认居中 |
| 真机返修：外观与模态 | ✅ | 本批 | 见下节 |

### 真机返修：三个缺陷

测试台 `simples/simples-dialog` 在真机上点出了三处问题，根因与改法：

| 现象 | 根因 | 改法 |
|---|---|---|
| `modal` 关掉后父卡片一点就响系统提示音 | `win32::enable_window` 的参数极性写反：`on=true` 传 0（禁用）、`on=false` 传 1（启用），于是关窗时反而把父窗口禁用了 | 改成 `if on { 1 } else { 0 }`；验证用 `IsWindowEnabled` 直读父卡片：模态期间 `False`，关掉后 `True` |
| `frame:true` + `rounded:false` + `opacity:0.92` 仍然圆角、也不透明 | ① 宿主只认 `roundedCorners`，弹框传的是 `rounded`，要求被丢掉；② 带边框的顶层窗口默认吃 DWM 圆角；③ 页面不读 `opacity`，而玻璃帧又叠不了整窗 alpha | 窗口层两个键都认；`frame && !rounded` 只调 `set_round_corner(false)`（不走 `polish_frame`，否则原生标题栏被一起关掉）；`frame:true` 归一成不透光窗口，`opacity` 走整窗 alpha，页面侧只在透明窗口里叠 `opacity` |
| 圆角弹窗四角有小尖尖 | 逐像素透明的窗口又被 DWM 裁了一刀圆角，和页面自画的圆角错位 | 透明窗口一律 `dwm_round = rounded && !transparent`，圆角只由页面画（与卡片同一套做法） |

另外两点顺带修掉：`set_visible` 会按 tao 缓存的样式重写扩展样式，把 `WS_EX_LAYERED` 抹掉，所以创建时的整窗透明度改成「显示之后」再设一次，并在页面 `ready` 与 `win.show` 时补回；`frame:true` 不再同时写两行标题（原生标题栏有标题时页面标题默认关掉）。

真机复测（2560×1440）：方框那条四角 90 度、`GetLayeredWindowAttributes` 读到 `alpha=235`（0.92）；无边框直角那条压在浏览器窗口上能看到底色透出来（把 `opacity` 临时改 0.4 时整块明显变淡，说明页面侧生效）；默认圆角那条四角平滑、圆角外是桌面，没有白尖；模态期间父卡片 `IsWindowEnabled=False`，点「确定」后回到 `True`，再点卡片能正常弹框。

P2 里 `closeOnBlur` / `closeOnOutsideClick` / `modal` 三条走的是窗口失焦与 `EnableWindow`，需要在真机上点一下别处才能看到效果，第一轮只验了 `modal`；`autoClose` 与 `anchor` 已在真机上量过坐标与关闭原因。`closeOnBlur` / `closeOnOutsideClick` 与 `closeOnEsc` 的真机验收见第七轮。

### 真机返修第二轮：「无边框 + 直角」上圆下直

第一轮修完再看「无边框 + 直角 + 92% 透明」这条，弹框是**上圆下直**：左上、右上各带一道约 4px 的弧，左下、右下是 90 度。

| 环节 | 实测 | 结论 |
|---|---|---|
| 页面侧 | 在真机上临时把 `document.body.dataset.square` 与 `getComputedStyle` 打到弹框正文：`sq=true tl=0px bl=0px dlgtl=0px`，`innerHeight` 与 body 高都是 149 | 页面四角确实是 0，`data-square` 生效 |
| 窗口侧 | 对同一个 hwnd 重新 `DwmSetWindowAttribute(33, DONOTROUND)`（返回 0，成功）后像素不变 | `DONOTROUND` 对「客户区被扩展玻璃铺满」的无边框窗口不生效 |
| 定形 | 对同一个 hwnd `SetWindowRgn` 贴一个整矩形区域 | 弧立刻消失，四角变 90 度 |

所以那 4px 不是页面画的、也不是我们要求的，是 DWM 留在玻璃壳上的默认圆角——属于疏漏。修法是：无边框 + `rounded:false` 的窗口在 `fit_client` 之后补一次 `win32::clip_square`（`CreateRectRgn(0,0,w,h)` + `SetWindowRgn`），并把「要不要裁」记进 `CustomWin::square`，`setSize` / `setBounds` / 最大化 / `setFullScreen` 之后各重贴一次（区域是按尺寸定死的，窗口一变旧区域就会把新长出来的部分裁掉）。

复测（2560×1440，`target\release`）：左上 `y=630` 那一行从 `x=1090` 起就是页面 1px 描边，四角全 90 度；同一构建下默认圆角的 alert 仍是 16px 圆角（`y=650..666` 逐行内收 16px），没有被误裁。

### 真机返修第三轮：`dialog.window` 的四个白角与开窗白闪

| 现象 | 根因 | 改法 |
|---|---|---|
| `dialog.window({ html })` 弹出来是一扇**有系统边框的不透光窗口**，页面自己画的圆角外侧露出四个白角 | 只有内置页面那四种 kind 走 `dialog::normalize`，`window` 这种「页面由组件画」的被当成普通窗口，于是 `frame` 落回 `true`、`transparent` 落回 `false`，页面圆角外面就是 WebView 的默认白底 | 新增 `dialog::look`：只补外观那层默认值（无边框、透光、圆角、透明底、跟随主题），尺寸/位置/交互仍归组件；`window` kind 在 `win.create` 里过一遍 |
| 弹框出现的一瞬间白屏一下 | 窗口建好立刻 `set_visible`，此时 WebView 还在画自己的白底，页面还没渲染 | 弹框窗口先藏着，页面 `ready` 之后由 `App::mark_custom_loaded` 再亮出来；实测点击到可见约 300ms，期间桌面上什么都不出现，不再是「白框先闪一下」 |

`look` 和 `normalize` 同一条规矩：组件坚持要 `frame:true` 就同时把 `transparent` 关掉，免得玻璃帧配标题栏又漏白边。

### 真机返修第四轮：弹框徽标可换、入场动画挪到显示那一帧

| 诉求 | 原来什么样 | 现在怎么做 |
|---|---|---|
| 左上角那个圆徽标一个字母，丑，还得能换成组件自己的 logo | 圆底色里印一个字符：`i` `!` `×` `✓` | 内置一小组矢量描的图形（`info` `success` `warn` `error` `bell` `question` `clock` `sparkle` `lock` `trash` `heart` `star`），描在同一个圆徽标上；要自己的 logo 就给 `icon: { svg }`（内联 SVG）、`icon: { url }`（图片，组件包内的相对路径也认，弹框页和组件同源）或 `icon: { text }`（一个字符）；底色用 `iconColor` 换，`icon: ""` 连徽标都不要 |
| 弹框「啪」一下整块出现，淡入根本看不见 | 入场动画挂在 CSS 上，页面一加载就开始跑；窗口要等页面 ready 才显示，等亮出来时 160ms 早跑完了 | 页面先停在 `opacity: 0` 等一声令：宿主 `set_visible` 之后 `evaluate_script("__fwReveal()")` 才把动画交回给 CSS 从头播；顺序是先亮窗口再叫门，反了会看到完整画面闪一下再重播。另有 1.5s 兜底，避免老宿主/页面单独打开时永远不显示 |

`animationMs` 一并接上了：它现在是真正的动画时长（之前只是个占位字段）。

### 真机返修第五轮：原生标题栏那个图标也要能换

「460×220 原生边框」这条用的是系统标题栏，左上角那个图标一直是 Windows 的通用占位图，和组件毫无关系。

| 诉求 | 原来什么样 | 现在怎么做 |
|---|---|---|
| 原生标题栏的小图标支持自定义 | 全宿主只有控制中心给自己 `set_window_icon`，自定义窗口一律沿用 exe 的图标，看着像别人的程序 | 新增 `windowIcon` 选项：组件包内相对路径（`"icon.png"`）或 `data:` 内联位图，`png`/`ico`/`bmp`/`jpg`/`webp` 都行；`app::custom_window_icon` 解出来、超 32px 先缩到 32、再 `set_window_icon`；`false` 明确不要 |
| 只让一个选项管两个地方 | 徽标（页面里）和标题栏图（原生）是两套东西，组件要写两遍 logo | `windowIcon` 没写时，只要 `icon` 是位图（`{ url }` 或 `data:`）就拿它顶上；`icon: "lock"` 这种内置名、`icon.svg` 不参与——Windows 要的是内存里的像素，SVG 解不了，也不替组件去联网 |

顺带：这条也接在 `createBrowserWindow` 上，普通自建窗口同样能用 `windowIcon`。



迁移后真机量到的结果：弹框落在主屏右上角 `(2164, 16)`、宽 380、高按内容收到 168（原来是写死的 300，一句话提醒下面留白），点「完成」宿主日志记 `win 1: closed (button)`，页面拿到的返回值是 `{"button":"ok","confirmed":true,"reason":"button"}`；弹框出现时前台窗口一直是浏览器，没有抢焦点。

### 真机返修第六轮：三个关闭开关真机验收

多窗口测试台（`simples/simples-window`）里 `closeOnEsc` / `closeOnBlur` / `closeOnOutsideClick` 三条点了没反应。分开看是三个不同的坑：

| 现象 | 根因 | 改法 |
|---|---|---|
| `closeOnEsc` 一点效果都没有 | `WinFlags.close_on_esc` 只在 `window_category.rs` 建窗时从 `jbool` 读进来，Rust 侧从没读过它；内置弹框页按 Esc 能关，是因为 `dialog.js` 自己监听了 `keydown`，`windows.open` 自绘的页面没有这段 | 宿主侧接手：`platform::win32` 记「Esc 刚按下」，事件循环里 `App::escape_pressed` 把带 `closeOnEsc` 的窗口 `close_custom(id, "esc")` |
| `closeOnBlur` / `closeOnOutsideClick` 只在真失焦时判 | `main.rs` 的 `Focused(false)` → `custom_blurred` 是唯一入口。卡片是 `NOACTIVATE` 的、自建窗口 `set_visible(true)` 也不抢焦点，点卡片根本不会让子窗失焦，`Focused(false)` 永远不来 | 主键改成「左键按在窗口外面」，`App::pointer_pressed` 统一处理：有 `closeBlur` 给 `"blur"`，否则给 `"outside"`；真失焦那条留着当兜底 |
| 键怎么听 | 40ms 取态会漏掉一次快速点按；低级键盘钩子装得上、但实测只在第一次回调之后再没动静 | 鼠标按下用 `WH_MOUSE_LL`（精确到每一次按下）；Esc 用 10ms 取态 + 边沿判定，真人按一次至少三四十毫秒，够采样两三次 |

另外两个细节一并处理，否则「点一下才弹出来的窗口」会自己关掉：开窗那一下的按下发生在窗口建出来之前，但事件可能排队排到窗口已经站住之后才被处理；`pointer_pressed` 因此比较按下时刻与窗口的 `created_ms`，早于建窗的按下不算「点了别处」。`closeOnBlur` / `closeOnOutsideClick` 也补进了 `dialog.rs` 的 `KNOWN`，弹框同样能用。

真机验收（2560×1440，`cargo build --release` 后重启宿主）：

| 用例 | 操作 | 结果 |
|---|---|---|
| `closeOnEsc` | 点这一行开窗，立刻按一下 Esc（`SendKeys {ESC}`，按下与抬起几乎同时） | 日志 `win 1: closed (esc)`，页面拿到 `{"reason":"esc"}`，耗时 2.2s（含我这边点击后的等待） |
| `closeOnBlur` | 开窗后点卡片顶部 | 日志 `closed (blur)`，页面拿到 `{"reason":"blur"}` |
| `closeOnOutsideClick` | 开窗后先点窗口内部（面板空白处），再点卡片 | 点内部不动；点外面后 `closed (outside)`，页面拿到 `{"reason":"outside"}` |

### 真机返修第七轮：测试台补「透明与鼠标穿透」「HTML 内容」用例

「透明 / 鼠标穿透 / 内容支持 HTML」这三条此前只在文档里写着，测试台里没有能点的例子；顺带补一条直角窗口的对照。一共四条用例、三个新页面：

| 用例 | 页面 | 期望 |
|---|---|---|
| 无边框 + 直角（`rounded: false`） | `square.html` | 四角 90 度：窗口层 `clip_square` 整扇裁直，页面不写 `border-radius`；按住顶栏仍能拖 |
| 透明 + 鼠标穿透（8 秒自关） | `overlay.html` | `transparent: true` + `ignoreMouseEvents: true`，除虚线框外像素全透明；点框内任意位置事件落到下面的卡片，框里的计数一直是 0；`autoClose` 8 秒自己关 |
| 弹框正文吃 HTML（rawHtml） | 内置弹框页 | 同一个 `content` 加 `rawHtml: true` 后按标签渲染（加粗、`ul` 列表、行内 `color`）；不加就原样当文字 |
| 弹框整页 HTML（dialog.window） | `rich.html` | 每一像素由组件页面画，外观仍是弹框（无边框、圆角、淡入）；点「就用它」交回 `button=apply` |

真机量到的（2560×1440）：覆盖窗按卡片 `getBounds` 偏移落在 `1967,580 300×150`，`win.get` 读回 `ignoreMouse: true`；点框中心后宿主日志只多出 `card_notify window.front`（说明按下落到卡片），页内计数仍是「0 次」；8 秒后 `win 1: closed (timeout)`。`rawHtml` 那条点「知道了」返回 `{"button":"ok","reason":"button"}`；`dialog.window` 那条点「就用它」返回 `{"reason":"button","button":"apply","result":{"button":"apply","reason":"button"}}`。

两处为了看得清而调整的地方：覆盖框底色从 12% 抬到 62%——12% 时卡片上的字和框里的字叠在一起没法读；`rawHtml` 那条弹框给了 `x: 240, y: 260`——弹框是玻璃底，默认居中会正好压在明亮的编辑器窗口上，透出来的字比正文还清楚。

### 还没做的

1. `hello-widget` 模板示例：仓库里没有这个模板组件，指南里的示例段落已经覆盖同一份代码，是否要新建一个模板组件需要先定它放宿主仓库还是 Hub。

