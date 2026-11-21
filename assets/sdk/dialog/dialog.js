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
  if (kind === "toast") body.dataset.toast = "true";
  // 有原生边框时客户区是矩形，圆角由窗口负责；无边框时由 `rounded` 说了算。
  if (cfg.frame === true || cfg.rounded === false) body.dataset.square = "true";
  if (cfg.theme === "light" || cfg.theme === "dark") root.classList.add("dlg-" + cfg.theme);
  if (typeof cfg.accentColor === "string" && cfg.accentColor) {
    root.style.setProperty("--w-accent", cfg.accentColor);
  }

  // 逐像素透明的窗口叠不了整窗 alpha（会把玻璃帧顶掉），所以透明度在页面上做；
  // 不透光的窗口由宿主对整窗设置，这里再叠一次就变成两重淡。
  // 淡的必须是整扇弹框面（底板 + 内容）：底板画在 body 上，base.css 的
  // `body { opacity: var(--w-opacity) }` 就是给这一档准备的；把 opacity 写在 `#dlg` 上
  // 只会让里面那层内容变淡，底板一动不动，看起来就是「只有字虚了」。
  const opacity = Number(cfg.opacity);
  if (cfg.transparent === true && Number.isFinite(opacity) && opacity > 0 && opacity < 1) {
    root.style.setProperty("--w-opacity", String(opacity));
  }

  // ── 入场：等宿主把窗口亮出来，再从第一帧放动画 ─────────────────
  // 动画如果从页面加载就开始跑，等到窗口显示时早就跑完了，观感是「啪」一下全亮。
  // 所以这里先停在 opacity 0，宿主 `set_visible` 之后会叫 `__fwReveal` 从头播。
  const anim = cfg.animation === "none" ? null : cfg.animation || "fade";
  const animMs = Number(cfg.animationMs);
  let revealed = false;
  let gateTimer = null;
  function reveal() {
    if (revealed) return;
    revealed = true;
    clearTimeout(gateTimer);
    // 清掉内联的 none / opacity，把动画交回给 CSS 那条 data-animation 规则，从头播一遍。
    body.style.animation = "";
    body.style.opacity = "";
  }
  window.__fwReveal = reveal;
  if (anim) {
    body.dataset.animation = anim;
    if (Number.isFinite(animMs) && animMs > 0) body.style.animationDuration = animMs + "ms";
    body.style.animation = "none";
    body.style.opacity = "0";
    // 兜底：万一宿主没叫门（老宿主、页面单独打开），别让弹框永远看不见。
    gateTimer = setTimeout(reveal, 1500);
  }

  // ── 内容 ────────────────────────────────────────────────────
  if (typeof cfg.content === "string") {
    if (cfg.rawHtml) textEl.innerHTML = cfg.content;
    else textEl.textContent = cfg.content;
  }
  textEl.dataset.tight = textEl.scrollHeight < 60 ? "true" : "false";

  // ── 徽标与标题 ──────────────────────────────────────────────
  // 头部那个圆徽标：内置一组矢量图标（比印一个字母耐看得多），也能换成组件自己的 logo。
  // `icon: "lock"` 用内置的；`icon: { svg }` 塞内联 SVG；`icon: { url }` 给图片（绝对地址或 data:）；
  // `icon: { text }` 就给一个字符；`icon: ""` 则整个不要。
  const glyph = (inner) => '<svg class="dlg-glyph" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  const ICONS = {
    info: glyph('<circle cx="12" cy="7" r="1.7"/><rect x="10.9" y="10.2" width="2.2" height="7.6" rx="1.1"/>'),
    success: glyph('<path d="M6.6 12.9l3.5 3.4 7.3-7.6" fill="none" stroke-width="2.6"/>'),
    warn: glyph('<path d="M12 6.2v7.2" fill="none" stroke-width="2.4"/><circle cx="12" cy="17.4" r="1.5"/>'),
    warning: glyph('<path d="M12 6.2v7.2" fill="none" stroke-width="2.4"/><circle cx="12" cy="17.4" r="1.5"/>'),
    error: glyph('<path d="M7.4 7.4l9.2 9.2M16.6 7.4l-9.2 9.2" fill="none" stroke-width="2.4"/>'),
    danger: glyph('<path d="M7.4 7.4l9.2 9.2M16.6 7.4l-9.2 9.2" fill="none" stroke-width="2.4"/>'),
    bell: glyph('<path d="M12 4.6a4.2 4.2 0 0 0-4.2 4.2v3.4L6 15.4h12l-1.8-3.2V8.8A4.2 4.2 0 0 0 12 4.6Z"/>'
      + '<path d="M9.7 18a2.4 2.4 0 0 0 4.6 0" fill="none" stroke-width="1.8"/>'),
    question: glyph('<path d="M9.3 9.6a2.8 2.8 0 0 1 5.4.9c0 1.7-2.7 1.8-2.7 3.5" fill="none" stroke-width="2"/>'
      + '<circle cx="12" cy="17.8" r="1.4"/>'),
    clock: glyph('<circle cx="12" cy="12" r="6.4" fill="none" stroke-width="2"/>'
      + '<path d="M12 8.6V12l2.4 1.6" fill="none" stroke-width="2"/>'),
    sparkle: glyph('<path d="M12 4.8l1.9 4.7 4.7 1.9-4.7 1.9L12 18l-1.9-4.7L5.4 11.4l4.7-1.9z"/>'),
    lock: glyph('<rect x="6.6" y="11" width="10.8" height="7.8" rx="2"/>'
      + '<path d="M9.4 11V8.6a2.6 2.6 0 0 1 5.2 0V11" fill="none" stroke-width="1.9"/>'),
    trash: glyph('<path d="M6.8 8.8h10.4" fill="none" stroke-width="2"/>'
      + '<path d="M10 8.8V6.4h4v2.4" fill="none" stroke-width="2"/>'
      + '<path d="M8.8 8.8l.6 8.4h5.2l.6-8.4" fill="none" stroke-width="2"/>'),
    heart: glyph('<path d="M12 18.6l-1.2-1.1C7.4 14.9 5.6 13.2 5.6 10.9a3.8 3.8 0 0 1 6.4-2.7 3.8 3.8 0 0 1 6.4 2.7c0 2.3-1.8 4-5.2 6.6Z"/>'),
    star: glyph('<path d="M12 5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L3.6 10.3l5-.7z"/>'),
  };
  const ICON_TONE = {
    info: "", success: "success", warn: "warn", warning: "warn", error: "danger", danger: "danger",
    bell: "", question: "", clock: "", sparkle: "", lock: "", trash: "danger", heart: "", star: "",
  };

  const rawIcon = cfg.icon;
  const noIcon = rawIcon === "" || rawIcon === false || rawIcon === "none";
  const icon = noIcon
    ? null
    : rawIcon === undefined || rawIcon === null
      ? (kind === "confirm" && cfg.danger ? "danger" : "info")
      : rawIcon;

  if (icon) {
    const setImage = (url) => {
      iconEl.dataset.image = "true";
      iconEl.innerHTML = '<img class="dlg-logo" alt="">';
      iconEl.firstChild.src = url;
    };
    if (typeof icon === "string") {
      if (/^(https?:|data:|blob:)/i.test(icon)) setImage(icon);
      else if (ICONS[icon]) {
        iconEl.innerHTML = ICONS[icon];
        iconEl.dataset.tone = ICON_TONE[icon] || "";
      } else {
        // 既不是内置名也不是地址，就当组件给的字符用
        iconEl.textContent = icon;
        if (icon.length > 1) iconEl.dataset.wide = "true";
      }
    } else if (typeof icon === "object" && icon !== null) {
      if (typeof icon.svg === "string" && icon.svg) {
        // 组件自己的 logo 不走圆形底色：直接铺在徽标位置上。
        iconEl.dataset.logo = "true";
        iconEl.innerHTML = icon.svg;
      } else if (typeof icon.url === "string" && icon.url) {
        setImage(icon.url);
      } else if (typeof icon.text === "string" && icon.text) {
        iconEl.textContent = icon.text;
        if (icon.text.length > 1) iconEl.dataset.wide = "true";
      } else {
        iconEl.dataset.empty = "true";
      }
    }
    if (typeof cfg.iconColor === "string" && cfg.iconColor) {
      iconEl.style.background = cfg.iconColor;
      // 换了底色就说明是组件自己的品牌色，图形改成白色才看得清
      iconEl.dataset.ink = "white";
    }
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
