/* 宿主内置弹框的页面逻辑。
 *
 * 配置由宿主塞进 boot.dialog（见 runtime/dialog.rs 的 normalize），页面只负责：
 * 画出来、把用户的选择交回去（`win.result`）、按配置调自己的高度、处理 Esc 与自动关闭。 */
(function () {
  const boot = window.__FW_BOOT__ || {};
  const cfg = boot.dialog || {};
  const kind = cfg.kind || boot.kind || "alert";
  const widget = window.widget;
  if (!widget) return;

  const $ = (sel) => document.querySelector(sel);
  const dlg = $("#dlg");
  const head = $("#head");
  const iconEl = $("#icon");
  const titleEl = $("#title");
  const closeBtn = $("#close");
  const textEl = $("#text");
  const fieldWrap = $("#field");
  const inputEl = $("#input");
  const foot = $("#foot");
  const body = document.body;
  const root = document.documentElement;

  dlg.dataset.kind = kind;
  if (cfg.animation !== "none") body.dataset.animation = cfg.animation || "fade";
  if (kind === "toast") body.dataset.toast = "true";
  if (cfg.theme === "light" || cfg.theme === "dark") root.classList.add("dlg-" + cfg.theme);
  if (typeof cfg.accentColor === "string" && cfg.accentColor) {
    root.style.setProperty("--w-accent", cfg.accentColor);
  }

  // ── 内容 ────────────────────────────────────────────────────
  if (typeof cfg.content === "string") {
    if (cfg.rawHtml) textEl.innerHTML = cfg.content;
    else textEl.textContent = cfg.content;
  }
  textEl.dataset.tight = textEl.scrollHeight < 60 ? "true" : "false";

  // ── 图标与标题 ──────────────────────────────────────────────
  const iconTone = { info: "", warn: "warn", warning: "warn", error: "danger", danger: "danger", success: "success", bell: "" };
  const iconText = { info: "i", warn: "!", warning: "!", error: "×", danger: "×", success: "✓", bell: "!" };
  const icon = cfg.icon || (kind === "confirm" && cfg.danger ? "danger" : "info");
  if (icon) {
    iconEl.textContent = iconText[icon] || "i";
    iconEl.dataset.tone = iconTone[icon] || "";
  } else {
    iconEl.dataset.empty = "true";
  }

  const showTitle = cfg.showTitle !== false && !!cfg.title;
  if (kind === "toast") {
    // toast 没有头部：把图标挪到正文前面，一行之内说完。
    head.remove();
    if (icon) main.insertBefore(iconEl, textEl);
  } else if (showTitle) {
    titleEl.textContent = cfg.title;
  } else {
    head.remove();
  }

  // ── 按钮 ────────────────────────────────────────────────────
  const buttons = Array.isArray(cfg.buttons) && cfg.buttons.length
    ? cfg.buttons
    : kind === "alert"
      ? [{ id: "ok", text: cfg.okText || "知道了", kind: "primary" }]
      : [{ id: "cancel", text: cfg.cancelText || "取消" }, { id: "ok", text: cfg.okText || "确定", kind: cfg.danger ? "danger" : "primary" }];

  function finish(button, reason) {
    const value = fieldWrap.hidden ? undefined : inputEl.value;
    // 只交一次：按钮被连点或 Esc 与超时撞车时，后到的这次直接忽略。
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    widget.call("win.result", { button: button, value: value, reason: reason }).catch(() => {});
  }
  let finished = false;

  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dlg-btn" + (b.kind === "primary" ? " is-primary" : b.kind === "danger" ? " is-danger" : "");
    btn.textContent = b.text || b.id;
    btn.dataset.id = b.id;
    btn.onclick = () => finish(b.id, "button");
    foot.appendChild(btn);
  }
  if (kind === "toast") foot.remove();

  // ── 输入框（prompt） ────────────────────────────────────────
  const inputCfg = cfg.input;
  if (inputCfg && typeof inputCfg === "object") {
    fieldWrap.hidden = false;
    inputEl.value = inputCfg.value == null ? "" : String(inputCfg.value);
    inputEl.placeholder = inputCfg.placeholder == null ? "" : String(inputCfg.placeholder);
    if (inputCfg.password) inputEl.type = "password";
    if (inputCfg.maxLength) inputEl.maxLength = Number(inputCfg.maxLength) || 0;
    setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(cfg.defaultButton || "ok", "button");
      }
    });
  } else {
    fieldWrap.remove();
  }

  // ── 关闭、Esc、自动关闭 ─────────────────────────────────────
  if (closeBtn) {
    if (cfg.closable === false || kind === "toast") closeBtn.hidden = true;
    else closeBtn.onclick = () => finish(cfg.cancelButton || "", "user");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (cfg.closeOnEsc === false) return;
    e.preventDefault();
    finish(cfg.cancelButton || "", "esc");
  });

  let timer = null;
  const autoClose = Number(cfg.autoClose);
  if (Number.isFinite(autoClose) && autoClose > 0) {
    timer = setTimeout(() => finish(cfg.cancelButton || "", "timeout"), autoClose);
  }

  // ── 拖拽：无边框弹框靠标题条/空白处拖 ────────────────────────
  if (cfg.draggable !== false && cfg.frame === false) {
    if (head) head.classList.add("is-drag");
    const dragFrom = (el) => el && el.addEventListener && el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest("button, input, textarea, a, [data-no-drag]")) return;
      e.preventDefault();
      widget.window.startDrag();
    });
    dragFrom(head);
    dragFrom(dlg);
  }

  // ── 高度跟着内容走 ──────────────────────────────────────────
  // 固定高度（比如 300）会让「一句话提醒」下面空出一大块。正文是 flex 撑满的，
  // 量之前先把它临时改成自然高度，量完再还原，这样拿到的才是内容真高。
  function measureText() {
    const prevHeight = textEl.style.height;
    const prevFlex = textEl.style.flex;
    textEl.style.flex = "0 0 auto";
    textEl.style.height = "auto";
    const h = textEl.offsetHeight;
    textEl.style.height = prevHeight;
    textEl.style.flex = prevFlex;
    return h;
  }

  function naturalHeight() {
    let h = 0;
    if (head && head.isConnected) h += head.offsetHeight;
    if (main && main.isConnected) {
      const style = getComputedStyle(main);
      h += parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
      h += measureText();
      if (fieldWrap && fieldWrap.isConnected) {
        h += (parseFloat(style.rowGap || 0) || 0) + fieldWrap.offsetHeight;
      }
    }
    if (foot && foot.isConnected) h += foot.offsetHeight;
    return Math.ceil(h + 2);
  }

  async function fit() {
    if (cfg.fitContent === false) return;
    const wanted = Math.max(64, naturalHeight());
    const size = await widget.window.getSize().catch(() => null);
    const width = (size && size[0]) || Number(cfg.width) || 380;
    // 内容比窗口高时只涨到上限，再高就让正文自己滚。
    const cap = Number(cfg.maxHeight) || 620;
    widget.window.setSize(width, Math.min(wanted, cap)).catch(() => {});
  }
  // 字体、换行、异步内容都可能改变高度，几帧之后再量一次。
  requestAnimationFrame(() => requestAnimationFrame(fit));


  // toast 不需要焦点，也不该挡住底下的点击（宿主已按配置设了不抢焦点）。
  if (kind === "toast") {
    body.style.cursor = "default";
  }
})();
