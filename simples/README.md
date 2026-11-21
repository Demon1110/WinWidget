# simples：窗口与弹框 API 的真机测试用例

`simples/` 放的是**手工测试用**的小组件，不是产品件。每个目录就是一个组件源码，打包成
`.fwz` 装进真机点一遍，就能把窗口/弹框那套 API 的每条分支走一遍。

- 源码：`simples/src/<组件>/`（和 WinWidgetHub 的组件结构一样：`widget.json` + 页面）
- 产物：`simples/packages/<组件>-<版本>.fwz`
- **不会进 exe**：`build.rs` 只把仓库根下的 `assets\` 编进二进制，`simples\` 在 `assets\`
  之外，所以 `scripts/package-windows.ps1` 打出来的 exe 里没有这些测试件（脚本里也加了
  一道显式拦截，防止有人把它挪进 `assets\`）。

## 打包与真机安装

```powershell
node simples/pack.mjs          # 打包到 simples/packages
node simples/pack.mjs --check  # 只核对仓库里的产物是否和源码一致
```

装进真机：把 `simples/packages/*.fwz` 拖到控制中心完成安装，或者解压后把目录放到
`%APPDATA%\WinWidget\widgets\`，重启宿主。装好后从 `list` 或控制中心把卡片放到桌面。

## simples-dialog：`widget.dialog` 用例

| 用例 | 期望 |
|---|---|
| alert 默认 | 380 宽、圆角、淡入，只有一个「知道了」，点它 `reason=button` |
| alert 无标题 + 2.5 秒自动关 | 不显示标题、窗口 320 宽，到点自己消失且 `reason=timeout` |
| confirm 危险色 | 左侧图标变成 ×（danger），「删除」是危险色按钮 |
| confirm 自定义按钮 | 两个按钮文案来自 `buttons`，`defaultButton: "done"` 时回车/主按钮是「现在完成」 |
| prompt 带初始值 | 输入框里预填 `19:30 喝水` 并全选，回车等于确认 |
| prompt 密码 + 6 位上限 | 输入被遮住，最多 6 个字符，取消时 `value` 为空 |
| toast 1.5 秒 | 320 宽深色条，不抢焦点、不挡鼠标，1.5 秒自己关（`autoClose`） |
| dialog.window 自定义页面 | 打开 `custom.html`，点「就用它」返回 `button=apply`，关窗口返回 `user` |
| anchor=card | 弹框贴着卡片边缘（下方放不下就翻到上方），而不是屏幕正中 |
| 460×220 原生边框 + 不圆角 + 92% 透明 | 看得到系统边框、没有圆角、半透明，Esc 不关（`closeOnEsc: false`） |
| modal 模态 | 弹框在场的几秒里卡片点不动，关掉立刻恢复 |
| anchor=cursor | 弹框落在鼠标右下 +12 处，放不下就翻到左上，4 秒自己关 |

每次结果都会写进卡片底部「结果」列表，同时经 `console.error` 落到 `%APPDATA%\WinWidget\logs\app.log`，
搜 `[simples-dialog]` 就能对照。

## simples-window：多窗口用例

| 用例 | 期望 |
|---|---|
| 开窗 A（同 key 反复点） | 第二次不会多开，`sameId=true`，只是把 A 叫到前面 |
| 开窗 B | A、B 并存，id 不同 |
| windows.list | 每项带 `id / key / kind / title / visible / focused` |
| windows.has / find | `has("a")` 为 true，`find("b")` 拿回 B 的 id |
| post 给 A | A 页面的消息列表出现 `ping` |
| broadcast | A、B 都收到 `all-hands` |
| close A（reason=by-key） | 结果里 `reason="by-key"` |
| closeOnEsc | 按 Esc 自己关，`reason="esc"` |
| closeOnBlur | 点一下卡片就关 |
| closeOnOutsideClick | 点窗口外面才关，点窗口内部不算 |
| modal | 子窗开着时卡片点不动，关掉恢复 |
| 无边框可拖拽 | 按住子窗顶栏能整体拖动 |
| 无边框 + 直角 | 四角干净 90 度：窗口层整扇裁直、页面也没画圆角；按住顶栏仍能拖 |
| 透明 + 鼠标穿透（8 秒自关） | 虚线框之外全透明；点框内任意位等于点它下面的卡片，框里的计数始终是 0；8 秒后自己关 |
| 弹框正文吃 HTML（rawHtml） | 加粗、列表、行内颜色都照标签渲染；不传 `rawHtml` 时同一串连尖括号一起当文字显示 |
| 弹框整页 HTML（dialog.window） | 窗口由 `rich.html` 自绘，外观仍是弹框；点「就用它」返回 `button=apply`，点「先不用」返回 `button=dismiss` |
| closeAll | 所有子窗关掉，卡片还在 |
| 卡片自操作 | 卡片抬到最前、置顶、透明度 0.85、右移 24px，再恢复 |

`closeOnBlur` / `closeOnOutsideClick` / `closeOnEsc` 三条是 P2 里最晚才在真机点到的几项，
2026-11-21 在这次重装宿主后逐条点过：Esc 一下（按下几乎立刻抬起）也能关，`closeOnBlur`
点卡片即关，`closeOnOutsideClick` 点窗口内部不动、点外面才关。三条的根因与宿主改法记在
`docs/窗口与弹框API规划.md` 第六轮那节。

「透明与鼠标穿透」「HTML 内容」也是同一天补上的：覆盖窗（`overlay.html`）用
`transparent: true` + `ignoreMouseEvents: true` 开在自己卡片上方 300×150 处，实测点框中心
只有宿主日志里的 `card_notify window.front`（按下落到了卡片），框里的「本页收到的点击」一直
是 0，8 秒后 `autoClose` 记 `closed (timeout)`；`rawHtml` 那条弹框把 `content` 里的加粗、列表、
行内 `color` 都渲染出来，`dialog.window` 那条的 `rich.html` 自绘整页、点按钮把 `button=apply`
交回创建方。
