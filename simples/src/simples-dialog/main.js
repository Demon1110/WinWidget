/* 弹框测试台：每行一个用例，点一下就跑一次，结果记在下面的列表里。 */

const results = document.getElementById("results");
const list = document.getElementById("cases");

/** 记一条结果：用例、耗时、返回值（JSON 一行）。 */
function record(label, startedAt, payload) {
  const li = document.createElement("li");
  const ms = Math.round(performance.now() - startedAt);
  li.innerHTML = `<strong>${label}</strong> <span class="ms">${ms} ms</span>`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(payload);
  li.appendChild(pre);
  results.prepend(li);
  console.error(`[simples-dialog] ${label} → ${JSON.stringify(payload)}`);
}

/** 统一的跑法：同一个用例连点两次第二次直接忽略，免得窗口叠一堆。 */
function runner(label, fn) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    const startedAt = performance.now();
    try {
      const value = await fn();
      record(label, startedAt, value);
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

const CASES = [
  [
    "alert 默认",
    "380 宽 · 圆角 · 淡入 · 只有一个「知道了」",
    () => widget.dialog.alert({ title: "保存完成", content: "三份文件已经写进回收站。", icon: "success" }),
  ],
  [
    "图标：内置 lock + 自定义底色",
    "icon:\"lock\" · iconColor 换成紫色 · 危险按钮",
    () =>
      widget.dialog.confirm({
        title: "锁一下",
        content: "头部徽标是内置的锁图标，底色被 iconColor 换成了紫色。",
        icon: "lock",
        iconColor: "#8b5cf6",
        okText: "锁上",
        cancelText: "算了",
      }),
  ],
  [
    "图标：组件自己的 icon.svg",
    "icon:{url} · 用组件包里的图片当 logo",
    () =>
      widget.dialog.alert({
        title: "用自有图标",
        content: "左上角该是这张蓝色小窗口图，圆形底色没有了。",
        icon: { url: "icon.svg" },
        okText: "知道了",
      }),
  ],
  [
    "图标：内联 SVG",
    "icon:{svg} · 不落地文件，直接给 SVG 字符串",
    () =>
      widget.dialog.alert({
        title: "自己的 logo",
        content: "左上角该是这个方块 W，而不是默认的圆徽标。",
        icon: {
          svg: '<svg viewBox="0 0 24 24"><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#7c5cff"/><path d="M6.5 17V8l5.5 5.6L17.5 8v9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
        },
        okText: "不错",
      }),
  ],
  [
    "alert 无标题 + 2.5 秒自动关",
    "320 宽 · 不显示标题 · 到点自己消失，reason=timeout",
    () =>
      widget.dialog.alert({
        title: "这条标题不该出现",
        showTitle: false,
        content: "两秒半之后我会自己关掉。",
        okText: "好",
        width: 320,
        autoClose: 2500,
      }),
  ],
  [
    "confirm 危险色",
    "图标 × · 「删除」用危险色 · 「再想想」走 cancel",
    () =>
      widget.dialog.confirm({
        title: "删除这条提醒？",
        content: "删掉之后不会再响，也找不回来。",
        danger: true,
        okText: "删除",
        cancelText: "再想想",
      }),
  ],
  [
    "confirm 自定义按钮",
    "两个按钮都不叫 ok / cancel，defaultButton=done",
    () =>
      widget.dialog.confirm({
        title: "这条提醒已经到点了",
        content: "顺手开个会？",
        buttons: [
          { id: "later", text: "10 分钟后再提醒" },
          { id: "done", text: "现在完成", kind: "primary" },
        ],
        defaultButton: "done",
        cancelButton: "later",
      }),
  ],
  [
    "prompt 带初始值",
    "输入框聚焦并全选 · 回车等于确认",
    () =>
      widget.dialog.prompt({
        title: "改个时间",
        content: "输入框里已经填好了原来的时间。",
        input: { value: "19:30 喝水" },
        okText: "改成这个",
      }),
  ],
  [
    "prompt 密码 + 6 位上限",
    "type=password · maxLength 6 · 取消返回空值",
    () =>
      widget.dialog.prompt({
        title: "验证一下",
        content: "随便打几个字，看看是不是遮住的。",
        input: { placeholder: "最多 6 位", password: true, maxLength: 6 },
      }),
  ],
  [
    "toast 1.5 秒",
    "320 宽 · 深色条 · 不抢焦点 · 不挡点击",
    async () => {
      const toast = widget.dialog.toast({ content: "已加入提醒列表", autoClose: 1500 });
      return { id: toast.id };
    },
  ],
  [
    "dialog.window 自定义页面",
    "页面自己画，用 win.result 交卷",
    () => widget.dialog.window({ html: "custom.html", title: "自定义页面", width: 320, height: 150 }).closed,
  ],
  [
    "anchor=card 贴着卡片弹",
    "卡片下方放不下就翻到上方，最后夹进工作区",
    () =>
      widget.dialog.confirm({
        title: "锚点测试",
        content: "我应该贴着卡片边缘，而不是屏幕正中。",
        anchor: "card",
        offset: [0, 8],
      }),
  ],
  [
    "460×220 原生边框 + 不圆角 + 92% 透明",
    "frame=true 时露系统边框（透光关掉、标题只在标题栏写一次）；四角是方的；整窗 92%；标题栏图标换成包里的 icon.png",
    () =>
      widget.dialog.confirm({
        title: "外观全开",
        content: "这一只只能按窗口按钮关，Esc 不管用；四角应该是方的，整窗略带透明。",
        width: 460,
        height: 220,
        frame: true,
        rounded: false,
        opacity: 0.92,
        closeOnEsc: false,
        draggable: false,
        windowIcon: "icon.png",
      }),
  ],
  [
    "无边框 + 直角 + 92% 透明",
    "和上一条反过来：没有系统边框，直角靠页面自己画，四角不该有白色小尖",
    () =>
      widget.dialog.confirm({
        title: "直角无边框",
        content: "这一只没有系统边框，四角仍要是方的，整窗半透明，并且四角外要能看见桌面。",
        width: 380,
        height: 180,
        rounded: false,
        opacity: 0.9,
      }),
  ],
  [
    "modal 模态",
    "弹出来时父卡片点不动，关掉立刻恢复",
    () =>
      widget.dialog.confirm({
        title: "模态确认",
        content: "试着点一下背后的卡片：应该点不动。",
        modal: true,
      }),
  ],
  [
    "进任务栏 + 不置顶",
    "skipTaskbar=false 时任务栏该多出一条按钮；alwaysOnTop=false 时点一下背后的卡片就能把它压到后面",
    () =>
      widget.dialog.confirm({
        title: "当个正常窗口",
        content: "任务栏里应该能看到这一只；点一下背后的卡片，它就会被压到后面去。",
        skipTaskbar: false,
        alwaysOnTop: false,
      }),
  ],
  [
    "anchor=cursor 跟着鼠标",
    "弹框出现在鼠标右下，放不下就翻到左上",
    () =>
      widget.dialog.alert({
        content: "我应该在鼠标旁边。",
        anchor: "cursor",
        offset: [12, 12],
        autoClose: 4000,
        okText: "知道了",
      }),
  ],
];

const runs = CASES.map(([label, hint, fn]) => button(label, hint, runner(label, fn)));

document.getElementById("clear").addEventListener("click", () => {
  results.innerHTML = "";
});

