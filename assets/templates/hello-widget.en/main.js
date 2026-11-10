// A small WinWidget widget: a greeting, the time, and a button that remembers its count.
// `widget` is provided by WinWidget: no import needed. In developer mode, saving reloads it.

const $ = (id) => document.getElementById(id);

// 1. Settings: "settings" in widget.json. When the user changes one, onChange tells you.
function showSettings(s) {
  $("greeting").textContent = s.greeting;
  tick();
}
showSettings(widget.settings.get());
widget.settings.onChange(showSettings);

// 2. The time: updated every second, in the user's language.
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

// 3. Saved data: what's in widget.storage stays, even after a restart.
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
  $("count").textContent = widget.t({ en: `${count} clicks`, "zh-TW": `按了 ${count} 次`, "zh-CN": `按了 ${count} 次` });
}
