# C 类组件所需的宿主能力规划

> 面向上一次「uTools 插件可移植性分析」里 C 类 30 个插件的落地设计。
> 本文只谈「宿主需要补什么、补成什么样」，组件的页面实现见各自 `src/<id>/`。

## 一、原则

1. **窄接口优先**：宁可多写几个专用方法，也不开一个能跑任意命令的 `system.exec`。
2. **权限按方向拆**：能往系统里写（粘贴、打字）和能从系统里读（键鼠事件、进程列表）是两种风险，不要共用一个权限位。
3. **事件走批处理，不做轮询**：高频数据（键鼠、进程）以 16 ms 为一批推给页面，宿主侧不跑定时器轮询。
4. **默认关闭、随实例销毁**：任何订阅在卡片关闭或页面失联时立刻撤销，不残留钩子。
5. **不给字符只给键码**：键鼠订阅只回虚拟键码与扫描码，不回可还原成文本的字符流。
6. **越界的部分不做**：顶层穿透幕布（浮在所有窗口之上 + 逐像素透明 + 点得穿）已被明确否决，涉及它的插件改形态或放弃。

## 二、权限位

在现有 17 项基础上新增三项：

| 权限 | 覆盖的能力 | 为什么单独拆 |
| --- | --- | --- |
| `input.read` | `input.subscribe` 键鼠事件 | 与 `input`（往系统里打字）方向相反，风险独立 |
| `system.read` | 进程、端口、WiFi 配置、显示器状态 | 只读系统信息，不写注册表、不改系统设置 |
| `system.write` | 屏保、开机启动一类受控写操作 | 与只读分开，写操作必须逐项列明 |

`net.serve` 沿用 `network:*` 的命名习惯，新增 `network:serve`，不引入新的顶层权限名。

## 三、方法清单

### 3.1 `input.subscribe`（权限 `input.read`）

```
input.subscribe({ keys?: bool, mouse?: bool, throttle?: number }) -> { keys, mouse, throttle }
input.unsubscribe() -> null
```

- `keys` 默认 `false`，`mouse` 默认 `false`，两者都关等同于取消订阅。
- `throttle` 是批次间隔，取值 8–100 ms，默认 16；宿主按这个间隔把攒下的原始事件合成一批。
- 返回值是宿主实际生效的参数，页面据此校正自己的预期。
- 同一实例重复调用是覆盖，不是叠加；切换参数不会重启钩子线程（钩子是进程级、按需启停）。

事件通过 `widget.on("input", cb)` 推送，一批一条消息：

```
{
  "seq": 17,            // 批次序号，单调递增，用于丢弃乱序
  "t": 1732612800123,   // 批次生成时刻（毫秒）
  "keys": [             // 仅当订阅了 keys
    { "vk": 65, "scan": 30, "down": true, "at": 1732612800100 },
    ...
  ],
  "mouse": [            // 仅当订阅了 mouse
    { "x": 1280, "y": 640, "kind": "move" | "down" | "up" | "wheel", "button": "left" | "right" | "middle", "delta": -120, "at": ... },
    ...
  ],
  "dropped": 0          // 一批超过 256 条时丢弃的条数，让页面知道数据不全
}
```

安全约定：

- 只给 `vk` / `scan` / 按下抬起标志，不给 `char`，也不做键盘布局翻译。
- 宿主在没有任何订阅者时不装钩子，摘钩后立即停止采集。
- 页面失联（卡片关闭、页面崩溃）由宿主在实例销毁时撤销订阅，页面不需要自己清理。
- 控制中心授权文案必须写明「可以读到你按下的每一个键」。

### 3.2 `system.processes`（权限 `system.read`）

```
system.processes({ sort?: "cpu" | "memory" | "name", limit?: number }) -> {
  total: number,
  items: [{ pid, name, cpu, memory, started, path? }]
}
```

- `limit` 默认 20，上限 100；`path` 只在调用方另有 `shell.info` 权限时给出，避免顺手拿到全盘路径。
- CPU 用两次采样的差值算，首次调用返回当前瞬时值（可能为 0），页面自己决定是否忽略第一帧。

### 3.3 `system.ports`（权限 `system.read`）

```
system.ports({ protocol?: "tcp" | "tcp6" | "udp" | "all", listening?: bool }) -> {
  items: [{ proto, local, localPort, remote, remotePort, state, pid }]
}
```

- 只读表项，不做端口占用进程的关闭操作。
- 默认 `listening: true`，即只看监听中的端口。

### 3.4 `wifi.profiles`（权限 `system.read`）

```
wifi.profiles() -> { items: [{ ssid, auth, cipher, hasKey, key? }] }
```

- `key` 默认不返回；只有同时持有 `system.write` 时才返回明文密码，且返回值外层带 `revealed: true`，控制中心可以据此显示提醒。
- 实现走系统 WLAN API（`WlanEnumInterfaces` / `WlanGetProfile`），不调 `netsh`，避免命令行注入与本地化输出解析。

### 3.5 `system.screensaver`（权限 `system.write`）

```
system.screensaver({ action: "start" | "settings" }) -> { ok: bool }
```

- `start` 走 `WM_SYSCOMMAND` + `SC_SCREENSAVE` 广播；`settings` 打开系统屏保设置页（`control desk.cpl,,@screensaver`）。
- 不做「关闭屏保」「绕过锁屏」这类动作，那是安全边界之外的事。

### 3.6 `network:serve`（权限 `network:serve`）

```
net.serve({ port: number, host?: "127.0.0.1" | "0.0.0.0" }) -> { port, host, token }
net.close({ port }) -> null
```

- 默认只绑 `127.0.0.1`；绑 `0.0.0.0` 需要用户在授权时额外确认一次。
- 页面只能通过 `widget.on("net.conn")` 拿到连接事件，收发都走宿主回调，不暴露原始 socket。
- 同一实例最多两条监听；实例销毁即关。

### 3.7 官方工具包（`tool.exec`）

ffmpeg 不再让组件自己找二进制，宿主登记为官方工具：

```
tool.ensure({ "id": "ffmpeg", "version": "7.1" }) -> { path, version }
tool.run({ "id": "ffmpeg", "args": [...], "timeout": 600000 }) -> { code, stdout, stderr }
```

- 首次使用下载到组件自己的 bin 目录，校验 SHA-256 后解包；下载失败要明确报网络错误，不静默降级。
- `args` 白名单校验：只允许 `-i`、`-c:v`、`-c:a`、`-vf`、`-ss`、`-t`、`-y` 这类固定选项，出现 shell 元字符直接拒绝。

### 3.8 屏幕捕获（已有，补说明）

`screen.capture` / `screen.captureDisplay` / `screen.captureInteractive` 已经在宿主里，C 类的截图与图片处理直接复用：

- `screen.captureInteractive` 提供选区，返回裁剪后的 PNG（base64），页面拿来做贴图、加水印预览。
- 连续帧捕获（录屏）不在这一轮，仍缺 Windows Graphics Capture 的帧流通道。

## 四、组件映射

| 组件 | 依赖 | 形态调整 |
| --- | --- | --- |
| `image-watermark` | `file.read/write`、`screen.capture` | 批量队列，单图即刻预览 |
| `image-batch` | `file.read/write`、`file.list` | 目录遍历 + 规则队列，进度按文件回报 |
| `chart-colors` | `file.read/write` | 内置 ColorBrewer 与制图色板，可导出 ASE/JSON |
| `desk-widgets` | `win.create` / `win.post` | 桌面级多窗口，沿用 wallpaper / desktop 层 |
| `butterfly` | `schedule`、`win.create` | 壁纸层装饰，不接交互 |
| `spider-man` | `schedule`、`win.create` | 同上，按时间爬一次 |
| `tap-tonic` | `input.read`、`audio` | 按键音，音色本地合成 |
| `keys-visual` | `input.read` | 卡片内可视化 + 可选壁纸层大字 |
| `keys-visual-multi` | `input.read`、`screen.displays` | 多屏各开一块壁纸层 |
| `mouse-effect` | `input.read`、`win.create` | 壁纸层轨迹，装饰用 |
| `video-batch` | `tool.exec`（ffmpeg） | 队列 + 预设，先转码后抽帧 |
| `port-monitor` | `system.read` | 进程/端口两张表，30 秒刷新 |
| `hdr-switch` | `system.read` + 显示器信息 | 先只读 HDR 状态，写入留待 display config 通道 |
| `wifi-passwords` | `system.read`（+ 可选 `system.write`） | 明文默认打码，点击才 reveal |
| `screensaver` | `system.write` | 一键启动 + 打开设置 |
| `luzhanqi` | `network:serve` | 双人局域网，先本机回环对战 |
| `essay` | 无（不做 AI 版） | 排版、字数、导出 Markdown |
| `emoji-search` | 无（本地词库） | 本地表情词库 + 模糊匹配，不调模型 |
| `emoji-fusion` | 本地合成 | 表情叠加合成，不做 AI 出图 |
| `screenshot-studio` | `screen.captureInteractive` | 选区 + 贴图 + 延时截图，长截图不做 |
| `zoom-record` | 暂不做 | 缺连续帧通道 |
| `screen-record` | 暂不做 | 同上 |
