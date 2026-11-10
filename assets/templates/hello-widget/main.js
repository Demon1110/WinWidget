// 一個最小的 WinWidget 組件：問候語、時間、一個會記住次數的按鈕。
// `widget` 由 WinWidget 自動提供，不用 import。開發者模式下，存檔就會自動重新載入。

const $ = (id) => document.getElementById(id);

// 1. 設定：widget.json 裏的 settings。用戶在控制中心改了，onChange 會馬上通知。
function showSettings(s) {
  $("greeting").textContent = s.greeting;
  tick();
}
showSettings(widget.settings.get());
widget.settings.onChange(showSettings);

// 2. 時間：每秒更新一次，按用戶的語言顯示。
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

// 3. 保存資料：widget.storage 裏的東西會一直留着，重開電腦也在。
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
