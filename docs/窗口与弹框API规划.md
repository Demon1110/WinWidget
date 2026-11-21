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

P2 里 `closeOnBlur` / `closeOnOutsideClick` / `modal` 三条走的是窗口失焦与 `EnableWindow`，需要在真机上点一下别处才能看到效果，验证留到有交互的会话；`autoClose` 与 `anchor` 已在真机上量过坐标与关闭原因。

### 真机返修第二轮：「无边框 + 直角」上圆下直

第一轮修完再看「无边框 + 直角 + 92% 透明」这条，弹框是**上圆下直**：左上、右上各带一道约 4px 的弧，左下、右下是 90 度。

| 环节 | 实测 | 结论 |
|---|---|---|
| 页面侧 | 在真机上临时把 `document.body.dataset.square` 与 `getComputedStyle` 打到弹框正文：`sq=true tl=0px bl=0px dlgtl=0px`，`innerHeight` 与 body 高都是 149 | 页面四角确实是 0，`data-square` 生效 |
| 窗口侧 | 对同一个 hwnd 重新 `DwmSetWindowAttribute(33, DONOTROUND)`（返回 0，成功）后像素不变 | `DONOTROUND` 对「客户区被扩展玻璃铺满」的无边框窗口不生效 |
| 定形 | 对同一个 hwnd `SetWindowRgn` 贴一个整矩形区域 | 弧立刻消失，四角变 90 度 |

所以那 4px 不是页面画的、也不是我们要求的，是 DWM 留在玻璃壳上的默认圆角——属于疏漏。修法是：无边框 + `rounded:false` 的窗口在 `fit_client` 之后补一次 `win32::clip_square`（`CreateRectRgn(0,0,w,h)` + `SetWindowRgn`），并把「要不要裁」记进 `CustomWin::square`，`setSize` / `setBounds` / 最大化 / `setFullScreen` 之后各重贴一次（区域是按尺寸定死的，窗口一变旧区域就会把新长出来的部分裁掉）。

复测（2560×1440，`target\release`）：左上 `y=630` 那一行从 `x=1090` 起就是页面 1px 描边，四角全 90 度；同一构建下默认圆角的 alert 仍是 16px 圆角（`y=650..666` 逐行内收 16px），没有被误裁。


迁移后真机量到的结果：弹框落在主屏右上角 `(2164, 16)`、宽 380、高按内容收到 168（原来是写死的 300，一句话提醒下面留白），点「完成」宿主日志记 `win 1: closed (button)`，页面拿到的返回值是 `{"button":"ok","confirmed":true,"reason":"button"}`；弹框出现时前台窗口一直是浏览器，没有抢焦点。

还没做的一件（不阻塞使用）：

1. `hello-widget` 模板示例：仓库里没有这个模板组件，指南里的示例段落已经覆盖同一份代码，是否要新建一个模板组件需要先定它放宿主仓库还是 Hub。

