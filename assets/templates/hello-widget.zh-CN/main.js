// 一个最小的 WinWidget 组件：问候语、时间、一个会记住次数的按钮。
// `widget` 由 WinWidget 自动提供，不用 import。开发者模式下，保存就会自动重新加载。

const $ = (id) => document.getElementById(id);

// 1. 设置：widget.json 里的 settings。用户在控制中心改了，onChange 会马上通知。
function showSettings(s) {
  $("greeting").textContent = s.greeting;
  tick();
}
showSettings(widget.settings.get());
widget.settings.onChange(showSettings);

// 2. 时间：每秒更新一次，按用户的语言显示。
function tick() {
  const now = new Date();
  $("time").textContent = now.toLocaleTimeString(widget.locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: widget.settings.get("showSeconds") ? "2-digit" : undefined,
    hourCycle: "h23",
  });
  $("date").textContent = now.toLocaleDateString(widget.locale, { month: "long", day: "numeric", weekday: "short" });
}
setInterval(tick, 1000);

// 3. 保存数据：widget.storage 里的东西会一直留着，重开电脑也在。
let count = 0;
widget.storage.get("count").then((n) => {
  count = n || 0;
  showCount();
});
$("count").addEventListener("click", () => {
  count++;
  showCount();
  widget.storage.set("count", count);
});
function showCount() {
  $("count").textContent = widget.t({ "zh-TW": `按了 ${count} 次`, "zh-CN": `按了 ${count} 次`, en: `${count} clicks` });
}
