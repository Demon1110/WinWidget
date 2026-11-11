# WinWidget

用 Rust 重写的 Windows 桌面组件（desktop widget）工具，功能对齐原 C# / .NET 9 版 FullWidget：每张卡片是一个无边框透明窗口 + 独立 WebView2 页面，组件本身就用普通的 **HTML + CSS + JavaScript** 写，主题和外观在控制中心里调。

![控制中心](docs/screenshots/control-center.png)

| 时钟卡片（instrument 主题） | 系统监控卡片 |
| --- | --- |
| ![时钟](docs/screenshots/card-clock.png) | ![系统监控](docs/screenshots/card-sysinfo.png) |

把全局主题切成 `paper` 后，同一张时钟卡片连内容编排都换了（纯读数改成月历式排版）：

![paper 主题下的时钟](docs/screenshots/card-clock-paper.png)

## 功能

- **38 个内置组件**：clock、analogclock、flipclock、worldclock、calendar、countdown、pomodoro、timer、progress、weather、forecast、airquality、sunmoon、sysinfo、usage、netspeed、disks、battery、network、pcinfo、recyclebin、volume、power、notes、todo、launcher、habits、calculator、search、infocard、rss、currency、dailyimage、onthisday、media、photoframe、whitenoise、label。
- **三种层级**：桌面层（贴在壁纸上、Win+D 不会被带走）、置顶（总在最前）、普通；可锁定位置、可鼠标穿透、可按比例缩放、可吸附对齐。
- **外观逐卡可调**：透明 / 磨砂（DWM 亚克力）、阴影、背景色与不透明度、文字色、强调色（可取 Windows 系统色）、字体、字号比例、圆角、内边距、整卡透明度、自定义 CSS。
- **三套主题**：`instrument`（深色仪器）、`paper`（浅色纸张）、`type`（排印风），主题切换即时生效，单张卡片也可单独指定主题。
- **控制中心**：我的组件、添加组件（38 个内置 + 用户组件，带预览图与分类筛选）、主题、设置（通用 / 热键 / 更新 / 数据目录 / 文件关联 / 低资源模式 / 开发者模式 / 自动更新 / 开机自启 / 全屏自动隐藏）。
- **托盘与热键**：手写 Win32 托盘图标（无第三方依赖），左键唤出控制中心，右键菜单可切换"隐藏全部卡片"、逐卡操作与主题；默认热键 `Ctrl+Alt+W`（控制中心）、`Ctrl+Alt+N`（便签）。
- **单实例**：第二次启动不会起两个进程，而是把已在运行的实例的控制中心唤到前台。
- **组件包（`.fwz`）**：支持拖拽到控制中心安装、导出、卸载，注册 `HKCU\Software\Classes\.fwz` 后双击即可安装。
- **权限模型**：组件在 `widget.json` 里声明所需能力（文件、媒体、系统信息、音频等），首次使用时由控制中心授权，未授权的能力调用直接失败。
- **开发者模式**：改完组件文件保存即热重载，页面上自动重载 + 保留组件状态；同时打开 WebView2 devtools。
- **低资源模式**：给 WebView2 追加 `--disable-gpu --disable-gpu-compositing` 等参数，降低显存与 CPU 占用。
- **全屏自动隐藏**：用 Windows 自己的 `SHQueryUserNotificationState` 判断是否有全屏应用/演示在跑，全屏时收起全部卡片。
- **每卡独立存储**：`widget.storage` 落到 `%APPDATA%\WinWidget\storage`，单卡上限 2 MB。
- **组件市场 / 自动更新**：都走可配置的 URL（`market_url`、`update_url`），未配置时对应入口给出明确提示。
- **命令行**：`winwidget list | add <id> | remove <id> | --version`，会与运行中的副本抢配置的写操作会被拒绝而不是偷偷写。

## 技术栈

| 部分 | 选型 |
| --- | --- |
| 窗口 / 事件循环 | `tao` 0.35 |
| WebView2 宿主 | `wry` 0.57（透明 WebView、IPC、devtools、拖拽） |
| 页面服务 | `tiny_http`（本地回环 HTTP，按 `Host` 路由到不同组件，端口随机） |
| Windows 原生 | `windows` 0.61 + 手写 `extern "system"` 绑定（托盘 `Shell_NotifyIconW`、DWM 亚克力、桌面层 `SetParent(Progman)`、回收站 `SHFileOperationW`、电源、音频） |
| 系统信息 | `sysinfo` 0.40 |
| 其它 | `serde`/`serde_json`、`notify`（文件监听）、`zip`（`.fwz` 打包）、`ureq`（市场/更新下载）、`flate2`（编译期压缩 assets）、`image`、`rfd`（文件对话框）、`winreg`（自启动与文件关联） |

## 目录结构

```
WinWidget/
├─ Cargo.toml
├─ build.rs                   # 把 assets/ 压进二进制（+ 图标与版本资源）
├─ assets/                    # 与宿主解耦的前端资产（源码在这里改；发布时编进 exe）
│  ├─ widgets/                # 38 个内置组件，每个一个文件夹
│  ├─ sdk/                    # base.css、widget-sdk.js、widget.d.ts、three themes/
│  ├─ ui/control-center/      # 控制中心页面（index.html / style.css / app.js / i18n.js）
│  ├─ ui/docs/                # 内置文档页
│  ├─ templates/              # "新建组件"用的模板
│  └─ docs/                   # 组件开发指南、市场说明、里程碑说明（m* 截图不进二进制）
├─ src/
│  ├─ main.rs                 # 纯入口：单实例、事件循环、CLI、--apply-update；逻辑都在 lib.rs 里
│  ├─ lib.rs                  # 库入口，把下面几层按依赖顺序曝光
│  ├─ core/                   # 地基：assets(嵌入式资源表) / paths / config / storage / logging / text / net / img / util
│  ├─ model/                  # 磁盘上的描述与校验：manifest / catalog / categories / themes /
│  │                          #   appearance / permissions / icons
│  ├─ market/                 # 分发：packages(.fwz) / client(市场) / updater
│  ├─ runtime/                # 唯一持有窗口与事件循环的一层：app / window / bridge / snap / shim / monitor
│  ├─ ui/                     # 用户动作的入口面：control(控制中心 API) / menus / server(本地 HTTP)
│  └─ platform/               # 与 Windows 打交道：win32 / tray / shell / update(自我替换) / sysinfo / audio / media / files / power
└─ docs/screenshots/          # 本文用到的实机截图
```

## 构建与运行

需要 MSVC 工具链（Rust `stable-x86_64-pc-windows-msvc`）和系统里的 **WebView2 Runtime**（Win10 1803+ / Win11 一般已自带）。

```powershell
cargo build            # 调试版：target\debug\winwidget.exe
cargo build --release  # 发布版：target\release\winwidget.exe（opt-level="s" + LTO + strip）
cargo run
```

首次启动会自动建两张示例卡片（时钟 + 系统监控），打开控制中心，并写入 `%APPDATA%\WinWidget\config.json`。

命令行（适合脚本）：

```powershell
winwidget --version
winwidget list                 # 当前卡片 + 全部可用组件
winwidget add winwidget.notes  # 在桌面上放一张便签（需先退出正在运行的实例）
winwidget remove <instance-id>
```

### 资源从哪来（一个 exe 怎么装下全部组件）

`build.rs` 在编译时把 `assets/` 整棵扫一遍（跳过 `docs/m*` 截图），大于 256 字节的文件 deflate 压缩，落到 `OUT_DIR/asset-blobs/`，再生成一张「路径 / 是否压缩 / 字节」表；`src/core/assets.rs` 用 `include!` 把这张表和 `include_bytes!` 的压缩块一起收进二进制。发布版因此只有一个 exe，运行时直接从内存读，不落盘、不解压到临时目录。

读取顺序（`src/core/paths.rs::resolve_resource_root`）：`WINWIDGET_DEV_ROOT` → exe 旁边的 `assets\` → **调试版**再往上找三级祖先里的 `assets\`（`cargo run` 落到的就是仓库那份）→ 都没有就用二进制里那份。祖先那一档只在 `debug` 构建里生效：不然把发布版 exe 丢进 `dist\` 跑，它会悄悄用仓库的 `assets\`，文档也会以 `file://` 打开。要从仓库里跑**发布版**又想吃源码里的 `assets\`，用 `WINWIDGET_DEV_ROOT`（`scripts/run.ps1` 会替你设）。用二进制里那份时 `paths::get().resource_root()` 是虚拟路径 `embedded:/assets`，`paths::get().embedded()` 为真，所有读文件的地方（本地 HTTP 服务、组件清单、主题、图标、预览图、`.fwz` 导出、新建组件模板）都会自动改从资源表取。启动日志第一行 `Assets: …` 会直接告诉你走的是哪一路。

三条由此产生的事实：

- **开发时改 `assets/` 立即生效**（磁盘优先，不用重编）；发布出去以后没有磁盘副本，改内置组件要先导出成 `.fwz` 再装，或者直接复制到 `%APPDATA%\WinWidget\widgets`。
- **组件列表 = 内置（嵌入）+ `%APPDATA%\WinWidget\widgets`**：`catalog::scan()` 两条都扫。用户目录里的组件与内置同 id 时不覆盖，而是在「未加载」列表里报冲突。
- 「打开组件目录」对内置组件会提示先导出（内置的没有文件夹）；「打开文档」在单文件版本里走本地服务 `http://127.0.0.1:<端口>/__docs/`。

## 打包与发布

脚本都在 `scripts/`，本地跑的就是 CI 跑的那几个：

```powershell
pwsh -File scripts/run.ps1                    # 构建（调试）并启动；-Kill 先结束旧实例，-Release 用发布配置
pwsh -File scripts/package-windows.ps1        # 构建并产出一个自带 assets 的 exe（+ .sha256）
pwsh -File scripts/package-windows.ps1 -Upx   # 打包后用 UPX 再压一遍
pwsh -File scripts/package-windows.ps1 -SkipBuild -Version 1.2.0   # 不重编、指定版本号
python scripts/build-docs.py                  # 三语开发指南 → assets/docs/developer-guide.html（+ index.html）
```

**发布件只有一个文件**：`dist\WinWidget-<版本>-windows-x64.exe`（约 7.5 MB），旁边一份 `.sha256`。没有 zip，也没有安装包——`assets\` 整棵（38 个组件、SDK、主题、控制中心、开发文档）在编译时就被 `build.rs` 压进二进制，运行时从内存读，不落盘、不解压。只有 `assets\docs\m*`（里程碑截图，约 13 MB，纯仓库素材）被排除。

脚本末尾有一道自检：把产物拷到一个**没有 `assets\`** 的临时目录里跑 `winwidget list`，能列出 30+ 个内置组件才算出包成功——否则说明资源没编进去，只是从仓库的 `assets\` 里捡到的。

复制这个 exe 到任何位置就能跑；数据仍在 `%APPDATA%\WinWidget`。要绿色版（数据放 exe 旁边的 `data\`），在同目录建一个空的 `portable` 文件即可。

应用内更新也走这条链：`updater.rs` 从 Release 里挑 `.exe`（名字带 `setup` 的安装包优先，兼容旧版本；否则就是单文件 exe），下载到 `%LOCALAPPDATA%\WinWidget\update\`，再以 `new.exe --apply-update <要替换的 exe>` 启动它。替换器等旧进程退出（Windows 不让程序覆盖自己正在运行的镜像），拷过去，再拉起新版本——见 `src/platform/update.rs`。替换失败会弹窗说明，不会静默失败；`update\` 里的旧下载在下次启动时清掉。

发布走 GitHub Actions 的 **Release** 工作流（手动 `Run workflow`，选 `patch` / `minor` / `major`），阶段顺序固定：

| 阶段 | 干什么 | 落库吗 |
| --- | --- | --- |
| `prepare` | 只算新版本号，改 `Cargo.toml` + `Cargo.lock` 上传成 artifact | 否 |
| `checks` | `cargo fmt --check` / `clippy -D warnings` / `cargo test` | 否 |
| `windows` | `scripts/package-windows.ps1` → 单文件 exe + sha256（含脱离 `assets\` 的自检） | 否 |
| `docs` | 渲染三语开发指南，并校验「文档和 Markdown 源文件是否同步」 | 否 |
| `release` | 全部成功后才提交版本号、打 tag、建 GitHub Release | 是 |

任何一步失败，分支上都不会留下「只改了版本号」的提交，也不会有 tag / Release；重跑从当前版本继续递增，不会重号。

## 自己写一个组件

一个组件就是一个文件夹，放进 `%APPDATA%\WinWidget\widgets\`（发布版里内置组件编在 exe 里，开发期改的是仓库的 `assets/widgets/`）：

```
my-widget/
├─ widget.json      # 元信息：id、名称、尺寸、设置项、权限
├─ index.html       # 卡片内容，<body> 就是卡片本身
├─ style.css
├─ main.js
└─ icon.svg
└─ preview/         # 可选：{theme}.{lang}.webp 预览图，控制中心里显示
```

`widget.json` 里声明设置项后，控制中心会**自动生成表单**，不需要写任何 UI：

```json
{
  "id": "my.quote",
  "name": { "zh-CN": "每日一句", "en": "Daily quote" },
  "version": "1.0.0",
  "size": { "width": 300, "height": 160 },
  "settings": [
    { "key": "quotes", "type": "textarea", "label": "句子（一行一句）",
      "default": "慢慢来，比较快。\n今天也要好好吃饭。" }
  ]
}
```

```js
// main.js —— 读设置、存数据、调宿主能力
const paint = () => {
  document.body.textContent = widget.settings.get("quotes").split("\n")[0];
};
paint();
widget.settings.onChange(paint);           // 控制中心改完设置立刻生效
widget.storage.get("pick").then(console.log);
widget.call("shell.open", { target: "https://example.com" });  // 需在 permissions 里声明
```

- 样式基线由主题提供：`w-label`、`w-num`、`w-btn`、`w-display` 等类名直接用，背景/圆角/字色会跟着主题走。
- 完整 API（`widget.call` / `widget.on` / `widget.settings` / `widget.storage` / 权限清单 / 调试 / 打包）见
  **`assets/docs/developer-guide.html`**（三语单文件，双击就能读，不联网）——它由
  [`assets/docs/組件開發指南.md`](assets/docs/組件開發指南.md) 经 `python scripts/build-docs.py` 生成；
  也可以从控制中心「設定 → 開發文檔 → 打開」直接打开，或走宿主的 `/__docs/`。
- 编辑期把 `widget.d.ts` 放到同一目录，VS Code 里 `widget.` 会有完整补全与注释。

## 主题与样式

- 主题在 `assets/sdk/themes/<id>/theme.css`，本质是一组 CSS 变量：`--w-bg`、`--w-bg-solid`、`--w-fg`、`--w-accent`、`--w-system-accent`、`--w-radius`、`--w-padding` 等。
- 宿主把"全局主题 + 该卡外观覆盖 + 用户自定义 CSS"算好后注入页面：`<style id="__fw_theme">`（变量）、`<link id="__fw_theme_link">`（主题文件）、`<style id="__fw_user">`（用户 CSS）。首页 `window.__FW_BOOT__` 里同时给一份 `appearance.values`，组件可按需读取。
- 新增主题：在 `assets/sdk/themes/` 下加一个目录 + `theme.css` + `theme.json`，控制中心会自动列出来。

## 页面与宿主的通信

WebView2 的 `chrome.webview.postMessage` 在 wry 下**只能传字符串**（传对象宿主一条也收不到），所以协议固定为：

- 页面 → 宿主：`host.postMessage(JSON.stringify({ id, m, p }))`
- 宿主 → 页面：`host.evaluate_script` 调 `window.__WV_DELIVER(obj)` 派发 `MessageEvent`
- 这套 shim 由宿主在 `with_initialization_script` 里注入（`src/runtime/shim.rs`），同时也顺手屏蔽了页面右键菜单与图片拖拽，避免在卡片上弹出浏览器菜单。

## 数据目录

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\WinWidget\config.json` | 全局配置：主题、实例（位置/尺寸/层级/设置/外观）、热键、授权 |
| `%APPDATA%\WinWidget\widgets\` | 用户组件；`.install` 为安装暂存 |
| `%APPDATA%\WinWidget\storage\` | 每张卡片 `widget.storage` 的数据 |
| `%LOCALAPPDATA%\WinWidget\logs\app.log` | 运行日志（含本地服务端口、页面 `ready`、错误） |
| `%LOCALAPPDATA%\WinWidget\exports\` | 导出的 `.fwz` |
| `%LOCALAPPDATA%\WinWidget\WebView2\` | WebView2 用户数据目录：整台进程只开一个浏览器进程、一份档案，所有卡片共用（便携版是 `data\local\WebView2`）。程序绝不会再在 exe 旁边生成 `<exe 名>.WebView2`；早期版本留下的那一份会在启动时删掉并记一行日志 |
| `%LOCALAPPDATA%\WinWidget\local\` | 市场缓存、媒体缓存、更新下载 |

## 已验证

- `cargo build` / `cargo build --release` 通过，release 单文件 **约 7.5 MB**（`opt-level="s"` + LTO + strip + 嵌入式 assets，含 devtools 支持；上一版不带资源是 3.8 MB）。
- 单文件脱离 `assets\`：把 `dist\WinWidget-1.0.0-windows-x64.exe` 单独拷到空目录，`list` 仍列出 **38 个内置组件**；再往 `%APPDATA%\WinWidget\widgets` 放一个测试组件，同一目录下 `list` 变成 **39 个**（内置 + 用户目录的合集）。
- 空目录里直接跑：日志 `Catalog: 38 widget(s)`、`Themes: instrument, paper, type; system accent #…`、`Serving pages on 127.0.0.1:9818`、两张卡 `ready`；本地服务对嵌入资源全部 200 —— `/__fw/base.css`(8.9 KB)、`/__fw/widget-sdk.js`(23.7 KB)、`/__fw/themes/instrument/theme.css`、`/__ui/control-center/index.html`、`/__ui/control-center/img/theme-paper.png`(222 KB)、`/__docs/developer-guide.html`(225 KB)、`/__templates/hello-widget/widget.json`、`/__preview/builtin/clock/preview/instrument.zh-CN.webp`。
- 自更新：旧实例在跑时，替换器等到 `copy` 成功（约 3 s）才覆盖并拉起新副本；日志 `apply-update: … -> …` / `copied, starting the new build` / `started … (pid …)`，替换后目标 exe 字节数与「新版本」一致，新实例日志照常 38 个组件。
- 资源来源与档案位置：把发布版 exe 拷到仓库里的 `dist\_t\`（上游两级就有仓库的 `assets\`）再启动，日志第一行是 `Assets: embedded:/assets` —— 说明它用的是自己肚子里那份，不会被源码树带偏；同一次启动打印 `removed the old WebView2 profile …winwidget.exe.WebView2 (4096 bytes)`，启动后目录里只有 `winwidget.exe`、`portable`、`data\`，浏览器档案落在 `data\local\WebView2`（单文件/便携形态实测）。
- 文档入口：单文件版本走服务，`/__docs/index.html` 在 `http://127.0.0.1:<端口>` 上 200（230,465 B），`/__fw/base.css` 200（8,942 B）；`widgets.localhost` 是卡片入口专用的主机名，Windows 自己解析不了，所以交给浏览器的链接一律写 `127.0.0.1`。
- 启动日志：`Catalog: 38 widget(s)`、`Themes: instrument, paper, type; system accent #…`、`Serving pages on 127.0.0.1:<port>`。
- 卡片实际渲染：时钟卡片（深色圆角卡 + 大字号时间 + 24 小时刻度条）、系统监控卡片（双环形仪表 + 磁盘/网络）；把 `theme_id` 改成 `paper` 后同一张卡片换成浅色纸张排版 —— 三张截图都用 `PrintWindow` 抓真实窗口内容。
- 控制中心实际渲染：三栏布局、组件列表、内容/外观/位置与行为三页签；设置项开关状态与 `widget.json` 的默认值一致（`24 小时制 / 显示秒 / 显示日期` 全为开）。
- 托盘链路：第二份副本启动 → `Another copy is already running; showing it` → 托盘线程收到 `ASK_CONTROL` → `Opening the control center` → 控制中心窗口出现并渲染。
- 手改 `config.json`（带 BOM，记事本/PowerShell 写入的常见情况）不会被当成坏文件重置：读取时会先剥掉 BOM。

## 已知限制

- **内置组件没有磁盘目录**：发布版里它们在 exe 里，「打开组件目录」对内置组件会提示先导出 `.fwz`；`assets\docs\m*`（里程碑截图，约 13 MB）没有编进二进制，需要看图请从仓库取。
- **音频设备友好名**未取到：`windows` 0.61 里没有 `PROPVARIANT → String` 的现成辅助，`audio.state()` 的 `device` 固定为 `null`（音量数值本身正常）。
- **`shell.paths` 与 `callWithFiles` 降级**：wry 没有 `postMessageWithAdditionalObjects`，页面无法把文件对象一并交给宿主，文件清单以 `p.files`（纯文件名数组）传递、宿主侧返回空数组。
- **卡片右键菜单**用原生 `TrackPopupMenu`（Win32 手写），没有接 `assets/ui/menu` 的自绘菜单，视觉上是系统菜单。
- **组件市场 / 自动更新**默认未配置 `market_url`、`update_url`，入口会明确提示"还没有设定来源"。
- **默认热键 `Ctrl+Alt+W`** 可能与系统里其它程序冲突，注册失败只记 `warn` 日志，不影响启动；可在控制中心"设置 → 热键"里改。
- **「新建组件」没有用上 `assets/templates/hello-widget*`**：`packages::create` 找的是 `templates/widget`，这个目录不存在，所以一直走代码里内联的最小模板（模板目录目前只被 `/__templates/` 文档示例引用）。
- 更新链路兼容两种资产：名字带 `setup` 的安装包（旧版本发布件）直接拉起安装，其他 `.exe` 走 `--apply-update` 自我替换。

## 说明

项目结构、组件资产与 IPC 契约对齐原 FullWidget；宿主层（窗口、托盘、桌面层、DWM 效果、页面服务、控制中心与组件 API 分发、权限/存储/市场/更新）由 Rust 重写，不再依赖 .NET。
