const $ = (id) => document.getElementById(id);
const t = widget.t;
let opts = widget.settings.get();

const ACTIONS = [
  { id: "lock", once: true, name: { "zh-TW": "鎖定", "zh-CN": "锁定", en: "Lock" },
    icon: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>' },
  { id: "sleep", name: { "zh-TW": "睡眠", "zh-CN": "睡眠", en: "Sleep" },
    icon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>' },
  { id: "restart", name: { "zh-TW": "重新啟動", "zh-CN": "重启", en: "Restart" },
    icon: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19.5 4v4h-4"/>' },
  { id: "shutdown", name: { "zh-TW": "關機", "zh-CN": "关机", en: "Shut down" },
    icon: '<path d="M12 3.5v8"/><path d="M7.2 6.2a7.5 7.5 0 1 0 9.6 0"/>' },
  { id: "signout", name: { "zh-TW": "登出", "zh-CN": "注销", en: "Sign out" },
    icon: '<path d="M13.5 4.5h-7v15h7"/><path d="M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"/>' },
];
const ARM_MS = 3000;
let armed = null, armTimer = 0;

function render() {
  const shown = ACTIONS.filter((a) => opts[a.id] !== false && (a.id !== "signout" || opts.signout === true));
  $("acts").style.setProperty("--n", shown.length);
  $("acts").innerHTML = shown.map((a) => `<button class="act${armed === a.id ? " armed" : ""}" data-id="${a.id}" data-no-drag
      title="${t(a.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${a.icon}</svg>
      <span class="lab">${armed === a.id ? t({ "zh-TW": "再按一次", "zh-CN": "再按一次", en: "Again" }) : t(a.name)}</span>
      <i class="fuse"></i></button>`).join("");
}

/** Everything but locking can lose unsaved work, so it needs a second click within 3 seconds. */
$("acts").onclick = (e) => {
  const b = e.target.closest("button.act");
  if (!b) return;
  const a = ACTIONS.find((x) => x.id === b.dataset.id);
  if (!a.once && armed !== a.id) {
    clearTimeout(armTimer);
    armed = a.id;
    armTimer = setTimeout(() => { armed = null; render(); }, ARM_MS);
    render();
    return;
  }
  clearTimeout(armTimer);
  armed = null;
  render();
  widget.power(a.id).catch((err) => widget.log(`power: ${err.message}`));
};

widget.settings.onChange((s) => { opts = s; render(); });
widget.appearance.onChange(render);
render();
