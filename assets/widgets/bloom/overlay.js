let canvas, ctx;
let width, height;
let currentEffect = null;
let animationTimerId = null;
let effectState = {};
let glRenderer = null;

const renderers = {};
const renderers3D = {};
const initFns = {};

// ── 光标服务：uTools 版靠 Electron preload 自己 16ms 轮询 screen.getCursorScreenPoint ──
// WinWidget 没有 preload，这里改成走宿主 screen.cursor（同样是 DIP 坐标），缓存成同步可读的点，
// 接口与原 preload 的 window.__bloomCursorService 一致，特效脚本不用改。
window.__bloomCursorService = (function () {
  var point = null;
  var active = false;
  var timer = null;
  var busy = false;
  var misses = 0;

  function store(r) {
    if (r && typeof r.x === "number" && typeof r.y === "number") {
      point = { x: r.x, y: r.y };
      misses = 0;
    } else if (++misses > 40) {
      // 宿主一直不给坐标（没授权 screen）：关掉轮询，特效会走回退路径。
      active = false;
      point = null;
    }
  }

  function tick() {
    timer = null;
    if (!active) return;
    if (busy) { timer = setTimeout(tick, 10); return; }
    var call = window.widget && typeof window.widget.call === "function" ? window.widget.call("screen.cursor") : null;
    if (call && typeof call.then === "function") {
      busy = true;
      var settle = function () { busy = false; };
      call.then(store).catch(function () { misses++; }).then(settle, settle);
    } else {
      store(call);
    }
    timer = setTimeout(tick, 20);
  }

  return {
    available: true,
    getCursorScreenPoint: function () { return point ? { x: point.x, y: point.y } : null; },
    setActive: function (on) {
      active = !!on;
      if (active && !timer && !busy) tick();
      if (!active) { point = null; }
    }
  };
})();

// 需要鼠标坐标的特效：只有这些特效会让 overlay-preload 开启 60Hz 原生轮询
const CURSOR_EFFECTS = {
  mouseFollow: 1,
  lightVine: 1,
  glyphDust: 1,
  ironGlyph: 1,
  morphText: 1,
  glyphFireworks: 1,
  skyLantern: 1,
  gravityParticles: 1,
  constellation: 1,
  constellationTour: 1
};

// 2D 默认最多 60fps：60Hz 屏不受影响，120/144Hz 屏避免无意义的超采样渲染。
// 特效可通过 window.bloomRegister(id, render, init, { fps: 30 }) 单独降低。
const DEFAULT_2D_FPS = 60;

// 慢速氛围类特效 30fps 足够，直接减半 CPU/GPU；
// 光标交互、快速粒子/雨雪类保持 60fps，避免手感变差。
const FPS_2D_OVERRIDES = {
  aurora: 30,
  butterflyDream: 30,
  deepSea: 30,
  fireflies: 30,
  glowVine: 30,
  inkBloom: 30,
  inkKoi: 30,
  inkSpring: 30,
  kaleido: 30,
  lavaFlow: 30,
  constellationTour: 30,
  quantumEntangle: 30,
  ribbon: 30,
  ripple: 30,
  skyLantern: 30,
  snowfield: 30,
  sunsetSea: 30
};

window.bloomRegister = function(id, renderFn, initFn, options) {
  if (options && options.fps > 0) renderFn.fps = options.fps;
  renderers[id] = renderFn;
  initFns[id] = initFn;
};

window.bloomRegister3D = function(id, handler) {
  renderers3D[id] = handler;
  initFns[id] = function(state) {};
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  if (canvas) { canvas.width = width; canvas.height = height; }
  if (glRenderer) {
    glRenderer.setSize(width, height);
    if (effectState._camera) {
      effectState._camera.aspect = width / height;
      effectState._camera.updateProjectionMatrix();
    }
  }
  if (currentEffect) initEffect(currentEffect);
});

// 释放上一帧 3D 场景的 GPU 资源，避免频繁切换特效时 GPU 显存/上下文累积
function disposeScene(scene) {
  if (!scene) return;
  scene.traverse(function(obj) {
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    var mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    mats.forEach(function(mat) {
      if (!mat) return;
      if (mat.uniforms) {
        Object.keys(mat.uniforms).forEach(function(k) {
          var v = mat.uniforms[k] && mat.uniforms[k].value;
          if (v && v.isTexture && v.dispose) v.dispose();
        });
      }
      if (mat.map && mat.map.dispose) mat.map.dispose();
      if (mat.dispose) mat.dispose();
    });
  });
}

// Load common.js first (shared utilities for 3D effects), then check if effect is registered
window.startEffect = function(effectId, options) {
  if (animationTimerId) { clearInterval(animationTimerId); cancelAnimationFrame(animationTimerId); animationTimerId = null; }
  const oldCanvas = document.getElementById('bloom-canvas');
  if (oldCanvas) oldCanvas.remove();
  if (effectState && effectState._scene) {
    try { disposeScene(effectState._scene); } catch (e) {}
    effectState._scene = null;
  }
  if (glRenderer) {
    try { glRenderer.dispose(); } catch (e) {}
    try { if (glRenderer.forceContextLoss) glRenderer.forceContextLoss(); } catch (e) {}
    glRenderer = null;
  }

  canvas = document.createElement('canvas');
  canvas.id = 'bloom-canvas';
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.appendChild(canvas);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;

  currentEffect = effectId;
  effectState = options ? { ...options } : {};
  // 光标类特效才开启 preload 的原生轮询，其余特效完全跳过
  if (window.__bloomCursorService && window.__bloomCursorService.setActive) {
    try { window.__bloomCursorService.setActive(!!CURSOR_EFFECTS[effectId]); } catch (e) {}
  }
  initEffect(effectId);

  const is3D = renderers3D.hasOwnProperty(effectId);

  if (is3D) {
    glRenderer = new THREE.WebGLRenderer({ 
      canvas, 
      alpha: true, 
      antialias: false, // Disabling antialias can significantly boost performance, especially for transparent windows
      powerPreference: 'high-performance',
      precision: 'mediump' // Medium precision is usually enough and faster on mobile/low-end GPUs
    });
    glRenderer.setSize(width, height);
    // Be more conservative with pixel ratio on very high density screens
    glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    glRenderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    effectState._scene = scene;
    effectState._camera = camera;
    renderers3D[effectId].init(scene, camera, effectState);
    const _effectId = effectId;
    const handler3D = renderers3D[_effectId];
    // 特效可通过 handler.fps 声明帧率上限：氛围类慢速动画 30fps 足够，
    // 高刷新率屏幕上可省一半以上 GPU/CPU；未声明则保持全帧率
    const minFrameMs = handler3D.fps > 0 ? 1000 / handler3D.fps : 0;
    let lastTime = performance.now();
    let nextTime = lastTime + minFrameMs;
    (function animate3D() {
      if (currentEffect !== _effectId) return;
      animationTimerId = requestAnimationFrame(animate3D);
      const time = performance.now();
      // 与 2D 相同的累加式节流：120/144/165Hz 上也能稳定落在目标 30fps，而不是 25/28fps
      if (minFrameMs > 0 && time + 1 < nextTime) return;
      const dt = Math.min((time - lastTime) / 1000, 0.05); lastTime = time;
      if (minFrameMs > 0) {
        nextTime += minFrameMs;
        if (nextTime <= time) nextTime = time + minFrameMs;
      }
      handler3D.update(scene, camera, time, dt, effectState);
      glRenderer.render(scene, camera);
    })();
  } else {
    ctx = canvas.getContext('2d', { alpha: true });
    const _effectId = effectId;
    const renderFn = renderers[_effectId];
    const targetFps = renderFn.fps > 0 ? renderFn.fps : (FPS_2D_OVERRIDES[_effectId] || DEFAULT_2D_FPS);
    const minFrameMs = 1000 / targetFps;
    let lastTime = performance.now();
    let nextTime = lastTime + minFrameMs;
    (function animate2D() {
      if (currentEffect !== _effectId) return;
      const time = performance.now();
      // 1ms 容差覆盖 60Hz 屏 16.6/16.67ms 的计时误差；
      // 用 nextTime 累加而不是 lastTime=time，可在 144Hz 上交替 2/3 帧，平均仍为 60fps
      if (time + 1 < nextTime) {
        animationTimerId = requestAnimationFrame(animate2D);
        return;
      }
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      nextTime += minFrameMs;
      if (nextTime <= time) nextTime = time + minFrameMs;
      ctx.clearRect(0, 0, width, height);
      renderFn(ctx, width, height, time, dt, effectState);
      animationTimerId = requestAnimationFrame(animate2D);
    })();
  }
};

function initEffect(id) {
  if (initFns[id]) initFns[id](effectState);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Override startEffect to support dynamic loading
const _origStartEffect = window.startEffect;
let startSeq = 0;
const scriptCache = {};

// 同一个脚本只加载一次；失败时清掉缓存，允许下次重试
function loadScriptOnce(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = loadScript(src).catch(function(err) {
      delete scriptCache[src];
      throw err;
    });
  }
  return scriptCache[src];
}

window.startEffect = async function(effectId, options) {
  const seq = ++startSeq;
  const registered = renderers.hasOwnProperty(effectId) || renderers3D.hasOwnProperty(effectId);
  if (!registered) {
    // Load common.js (shared helpers for 3D effects) then the effect file
    const is3D = ['ocean', 'nebula', 'crystal', 'glyphDust', 'ironGlyph', 'morphText', 'glyphFireworks'].includes(effectId);
    try {
      if (is3D) {
        await loadScriptOnce('effects/common.js');
        if (seq !== startSeq) return;
      }
      await loadScriptOnce('effects/' + effectId + '.js');
    } catch (err) {
      console.error('特效脚本加载失败: ' + effectId, err);
      return;
    }
    // 加载期间用户又切了别的特效：本次加载结果作废，避免旧特效覆盖新特效
    if (seq !== startSeq) return;
  }
  try {
    _origStartEffect(effectId, options);
  } catch (err) {
    console.error('特效启动失败: ' + effectId, err);
  }
};

// ── 这一页是被卡片用 overlay.html?fx=<id>&d=<display> 打开的：先把 fx 跑起来 ──
// （卡片之后要换特效就走 executeJavaScript —— 这一条只负责「窗口一出现就有东西在动」）
(function () {
  function param(key) {
    var m = new RegExp('[?&]' + key + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  window.__bloomParam = param;

  var fx = param('fx');
  if (fx) {
    var go = function () {
      try { window.startEffect(fx); } catch (e) { console.error('特效启动失败: ' + fx, e); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else requestAnimationFrame(go);
  }

  // ── 心跳：卡片页重载（换主题、开发模式热重载）之后，靠它接回窗口 id 与正在跑的特效 ──
  function beat() {
    if (!window.widget || typeof window.widget.call !== 'function') return;
    try {
      window.widget.call('win.parent', {
        channel: 'bloom:beat',
        args: [{ win: window.widget.windowId || 0, fx: currentEffect || '', d: param('d') }]
      });
    } catch (e) {}
  }
  beat();
  setInterval(beat, 2500);
})();
