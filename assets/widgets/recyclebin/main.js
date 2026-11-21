const $ = (id) => document.getElementById(id);
const t = widget.t;
let bin = null;
let asking = false; // a confirmation dialog is on screen for this card right now
let note = ""; // one line about a refused call, shown until the next look
let timer = 0; // the next look, whenever the last one scheduled it

function size(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 * 0.95 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function ago(secs) {
  if (secs === null || secs === undefined) return "";
  if (secs < 90) return t({ "zh-TW": "剛剛統計", "zh-CN": "刚刚统计", en: "just now" });
  const mins = Math.round(secs / 60);
  return t({
    "zh-TW": `${mins < 60 ? mins + " 分鐘" : Math.round(mins / 60) + " 小時"}前統計`,
    "zh-CN": `${mins < 60 ? mins + " 分钟" : Math.round(mins / 60) + " 小时"}前统计`,
    en: `${mins < 60 ? mins + " min" : Math.round(mins / 60) + " h"} ago`,
  });
}

/**
 * The host answers from its last measurement and walks the bin on a thread of its own: a full bin
 * takes over a minute to count, so the card never waits for it. While a walk or an empty run is in
 * flight the card looks again soon; otherwise it idles for a while.
 */
async function refresh() {
  clearTimeout(timer);
  try {
    bin = await widget.recycleBin.query();
    note = ""; // a fresh answer clears whatever a refused call left on the card
  } catch (e) {
    widget.log(`recyclebin: ${e.message}`);
  }
  render();
  const wait = bin && bin.emptying ? 700 : bin && bin.scanning ? 3000 : 20000;
  timer = setTimeout(refresh, wait);
}

function render() {
  const known = bin && typeof bin.items === "number" && bin.items >= 0;
  const emptying = !!(bin && bin.emptying);
  const empty = !emptying && (!known || bin.items === 0);
  document.body.classList.toggle("is-empty", empty);

  $("count").textContent = emptying ? "…" : known ? bin.items.toLocaleString(widget.locale) : "—";
  $("unit").textContent = emptying || !known ? "" : t({ "zh-TW": " 個項目", "zh-CN": " 个项目", en: bin.items === 1 ? " item" : " items" });

  if (emptying) {
    const done = size(bin.done || 0);
    $("size").textContent = typeof bin.total === "number"
      ? t({ "zh-TW": `已清空 ${done} / ${size(bin.total)}`, "zh-CN": `已清空 ${done} / ${size(bin.total)}`, en: `Cleared ${done} of ${size(bin.total)}` })
      : t({ "zh-TW": `已清空 ${done}`, "zh-CN": `已清空 ${done}`, en: `Cleared ${done}` });
  } else if (note) {
    $("size").textContent = note;
  } else if (!known) {
    $("size").textContent = t({ "zh-TW": "正在統計…", "zh-CN": "正在统计…", en: "Counting…" });
  } else if (bin.failed > 0) {
    $("size").textContent = t({
      "zh-TW": `還有 ${bin.failed} 處沒能刪除，可能被佔用`,
      "zh-CN": `还有 ${bin.failed} 处没能删除，可能被占用`,
      en: `${bin.failed} spots were left behind, probably in use`,
    });
  } else if (bin.items === 0) {
    $("size").textContent = t({ "zh-TW": "已經是空的", "zh-CN": "已经是空的", en: "Nothing in it" });
  } else {
    const total = t({ "zh-TW": `共 ${size(bin.size)}`, "zh-CN": `共 ${size(bin.size)}`, en: `${size(bin.size)} in all` });
    const age = ago(bin.age);
    $("size").textContent = age ? `${total} · ${age}` : total;
  }

  // how full, on a log scale: 1 MB shows a little, 10 GB fills it
  let frac = 0;
  if (emptying) {
    const total = typeof bin.total === "number" && bin.total > 0 ? bin.total : 0;
    frac = total ? Math.min(1, (bin.done || 0) / total) : 0.5;
  } else if (bin && bin.size > 0) {
    frac = Math.min(1, Math.log10(bin.size / 1048576 + 1) / Math.log10(10241));
  }
  const h = Math.max((!emptying && known && bin.items) ? 3 : 0, frac * 32);
  $("level").setAttribute("y", (44 - h).toFixed(1));
  $("level").setAttribute("height", h.toFixed(1));

  $("empty").disabled = asking || emptying || empty;
  $("empty").textContent = emptying ? t({ "zh-TW": "正在清空…", "zh-CN": "正在清空…", en: "Emptying…" })
    : t({ "zh-TW": "清空", "zh-CN": "清空", en: "Empty" });
}

/**
 * Emptying deletes for good, so a single click asks first: the host's own dialog says how much is
 * about to go, and only its 「清空」 hands the run to the host. The card itself never waits on the
 * deletion — `refresh()` follows it from there.
 */
$("empty").onclick = async () => {
  if (asking || (bin && bin.emptying)) return;
  asking = true;
  render();
  try {
    const known = bin && typeof bin.items === "number";
    const amount = known && bin.items > 0
      ? t({
        "zh-TW": `將永久刪除 ${bin.items.toLocaleString(widget.locale)} 個項目（${size(bin.size)}），刪除後無法恢復`,
        "zh-CN": `将永久删除 ${bin.items.toLocaleString(widget.locale)} 个项目（${size(bin.size)}），删除后无法恢复`,
        en: `This deletes ${bin.items} items (${size(bin.size)}) for good`,
      })
      : t({
        "zh-TW": "裏面的項目會被永久刪除，無法恢復",
        "zh-CN": "里面的项目会被永久删除，无法恢复",
        en: "What is inside will be deleted for good",
      });
    const answer = await widget.dialog.confirm({
      title: t({ "zh-TW": "清空資源回收筒", "zh-CN": "清空回收站", en: "Empty the Recycle Bin" }),
      content: amount,
      icon: "trash",
      danger: true,
      okText: t({ "zh-TW": "清空", "zh-CN": "清空", en: "Empty" }),
      cancelText: t({ "zh-TW": "取消", "zh-CN": "取消", en: "Cancel" }),
    });
    if (answer.confirmed) {
      // Answers as soon as the work has started; the loop in refresh() follows the run from there.
      await widget.recycleBin.empty();
      bin = { ...(bin || {}), emptying: true, done: 0 };
    }
  } catch (e) {
    widget.log(`recyclebin: ${e.message}`);
    note = t({
      "zh-TW": "清空沒有開始，稍後再試",
      "zh-CN": "清空没有开始，稍后再试",
      en: "Emptying did not start — try again in a moment",
    });
  } finally {
    asking = false;
  }
  refresh();
};
$("open").textContent = t({ "zh-TW": "打開", "zh-CN": "打开", en: "Open" });
$("open").onclick = () => widget.recycleBin.open().catch(() => {});

widget.appearance.onChange(render);
refresh();
