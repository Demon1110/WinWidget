// ============================================================
// 千灯夜航 (Sky Lantern) — 夜空中缓缓升起的孔明灯
// ============================================================
// 视觉：数十盏孔明灯自下而上漂升，分远/中/近三层景深
//       （越小越暗越慢 = 越远）。每盏灯 = 暖纸灯罩（source-over）
//       + 跳动火芯（lighter）+ 大半径柔光晕（lighter），
//       重叠的光晕自然形成暖色辉光，是项目招牌的柔光审美。
// 交互：鼠标是一股上升气流——靠近的灯被托起、微微倾斜、火苗变亮；
//       快速划过会吹散灯群并撒下一串火星。
// 氛围：极淡的夜间星点 + 底部祭灯地的微光 + 周期性成群放飞。
//
// 性能：全部元素为预渲染精灵 + drawImage，无逐像素计算；
//       默认约 70 盏灯 × 3 次绘制，开销极低。
// ============================================================

(function () {
  'use strict';

  var STAR_COUNT = 90;            // 夜间星点
  var SPARK_MAX = 200;            // 火星上限
  var EXTRA_MAX = 20;             // 成群放飞的额外灯上限
  var SWIPE_SPEED = 7;            // 视为"快速划过"的每帧像素速度

  // 三层景深参数：size 为灯罩高度(px, 未乘屏幕缩放)
  var LAYERS = [
    { sizeMin: 12, sizeMax: 20, vyMin: 10, vyMax: 18, glowA: 0.20, bodyA: 0.55, swayA: 6, mouseR: 90, mouseF: 0.5 },
    { sizeMin: 22, sizeMax: 34, vyMin: 20, vyMax: 32, glowA: 0.32, bodyA: 0.80, swayA: 10, mouseR: 130, mouseF: 0.8 },
    { sizeMin: 40, sizeMax: 60, vyMin: 34, vyMax: 52, glowA: 0.46, bodyA: 1.00, swayA: 16, mouseR: 180, mouseF: 1.0 }
  ];

  var PALETTES = {
    gold: { paper: [255, 176, 92], glow: '255,150,60', flame: [255, 240, 200] },
    crimson: { paper: [255, 110, 90], glow: '255,84,60', flame: [255, 222, 192] },
    amber: { paper: [255, 200, 110], glow: '255,172,60', flame: [255, 246, 214] },
    ice: { paper: [150, 208, 255], glow: '120,190,255', flame: [232, 246, 255] }
  };

  function rgb(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')';
  }
  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  function lanternPath(g, cx, cy, bw, bh) {
    g.beginPath();
    g.moveTo(cx, cy - bh / 2);
    g.bezierCurveTo(cx + bw * 0.62, cy - bh / 2, cx + bw / 2, cy - bh * 0.18, cx + bw / 2, cy);
    g.bezierCurveTo(cx + bw / 2, cy + bh * 0.2, cx + bw * 0.6, cy + bh / 2, cx, cy + bh / 2);
    g.bezierCurveTo(cx - bw * 0.6, cy + bh / 2, cx - bw / 2, cy + bh * 0.2, cx - bw / 2, cy);
    g.bezierCurveTo(cx - bw / 2, cy - bh * 0.18, cx - bw * 0.62, cy - bh / 2, cx, cy - bh / 2);
    g.closePath();
  }

  // 暖纸灯罩：纵向渐变 + 底部内透光 + 竖向骨架 + 上下灯帽
  function makeBody(paper, flame) {
    var S = 96;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    var bw = 46, bh = 62, cx = S / 2, cy = S / 2;

    lanternPath(g, cx, cy, bw, bh);
    var grad = g.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
    grad.addColorStop(0, rgb(mix(paper, [34, 18, 10], 0.42)));
    grad.addColorStop(0.45, rgb(paper));
    grad.addColorStop(1, rgb(mix(paper, flame, 0.42)));
    g.fillStyle = grad;
    g.fill();

    // 内透光（火在灯里）
    g.save();
    lanternPath(g, cx, cy, bw, bh);
    g.clip();
    var ig = g.createRadialGradient(cx, cy + bh * 0.16, 2, cx, cy + bh * 0.16, bh * 0.55);
    ig.addColorStop(0, rgb(flame, 0.6));
    ig.addColorStop(1, rgb(flame, 0));
    g.fillStyle = ig;
    g.fillRect(0, 0, S, S);
    // 竖向骨架
    g.strokeStyle = 'rgba(58,30,12,0.16)';
    g.lineWidth = 1.4;
    for (var k = -1; k <= 1; k++) {
      g.beginPath();
      g.ellipse(cx + k * bw * 0.22, cy, bw * 0.16, bh * 0.5, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    // 轮廓微光，保证浅色桌面上也有边缘
    lanternPath(g, cx, cy, bw, bh);
    g.strokeStyle = rgb(mix(paper, [255, 255, 255], 0.4), 0.45);
    g.lineWidth = 1.2;
    g.stroke();

    // 灯帽
    g.fillStyle = 'rgba(52,27,12,0.92)';
    g.beginPath();
    if (g.roundRect) g.roundRect(cx - 9, cy - bh / 2 - 4, 18, 6, 2);
    else g.rect(cx - 9, cy - bh / 2 - 4, 18, 6);
    g.fill();
    g.beginPath();
    if (g.roundRect) g.roundRect(cx - 7, cy + bh / 2 - 1, 14, 5, 2);
    else g.rect(cx - 7, cy + bh / 2 - 1, 14, 5);
    g.fill();

    return c;
  }

  function makeGlow(glowStr) {
    var S = 160;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(' + glowStr + ',0.50)');
    grad.addColorStop(0.28, 'rgba(' + glowStr + ',0.22)');
    grad.addColorStop(0.6, 'rgba(' + glowStr + ',0.07)');
    grad.addColorStop(1, 'rgba(' + glowStr + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function makeFlame(flame) {
    var S = 48;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, rgb(flame, 1));
    grad.addColorStop(0.3, rgb(flame, 0.6));
    grad.addColorStop(1, rgb(flame, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeLantern(layer, w, h, sc, atBottom) {
    var L = LAYERS[layer];
    return {
      layer: layer,
      x: Math.random() * w,
      y: atBottom ? h + rand(40, 140) * sc : Math.random() * (h + 120 * sc) - 60 * sc,
      size: rand(L.sizeMin, L.sizeMax) * sc,
      vy: rand(L.vyMin, L.vyMax) * sc,
      phase: Math.random() * Math.PI * 2,
      swaySpeed: rand(0.7, 1.4),
      tilt: 0,
      tiltV: 0,
      f1: rand(0.8, 1.3),
      f2: rand(0.8, 1.3),
      boost: 0
    };
  }

  function initResources(state, w, h) {
    var sc = Math.max(0.8, Math.min(1.6, Math.min(w, h) / 720));
    state.sc = sc;
    state.w = w;
    state.h = h;

    var spec = PALETTES[state.palette] || PALETTES.gold;
    state.spec = spec;
    state.body = makeBody(spec.paper, spec.flame);
    state.glow = makeGlow(spec.glow);
    state.flame = makeFlame(spec.flame);

    // 三层灯群
    var total = state.count;
    state.layers = [[], [], []];
    var quota = [Math.round(total * 0.45), Math.round(total * 0.35), 0];
    quota[2] = Math.max(4, total - quota[0] - quota[1]);
    for (var li = 0; li < 3; li++) {
      for (var i = 0; i < quota[li]; i++) {
        state.layers[li].push(makeLantern(li, w, h, sc, false));
      }
    }
    state.extras = [];

    // 星点
    state.stars = [];
    for (var s = 0; s < STAR_COUNT; s++) {
      state.stars.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.8,
        r: rand(0.5, 1.4),
        ph: Math.random() * Math.PI * 2,
        sp: rand(0.5, 1.6)
      });
    }

    state.sparks = [];
    state.clusterTimer = rand(4, 8);
    state.mouse = null;
    state.mouseOn = false;
    state.mouseX = w / 2;
    state.mouseY = h / 2;
    state.speed = 0;
    state.prevX = null;
    state.prevY = null;
  }

  function readCursor(w, h, time, state) {
    var point = null;
    if (window.__bloomCursorService && window.__bloomCursorService.getCursorScreenPoint) {
      try { point = window.__bloomCursorService.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.utools && window.utools.getCursorScreenPoint) {
      try { point = window.utools.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.bloomCursor) point = window.bloomCursor;
    if (!point && window.services && window.services.getCursorScreenPoint) {
      try { point = window.services.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (point) {
      state.ox = window.screenX;
      state.oy = window.screenY;
      var lx = point.x - state.ox;
      var ly = point.y - state.oy;
      return { x: lx, y: ly, on: lx >= -40 && lx < w + 40 && ly >= -40 && ly < h + 40, real: true };
    }
    return {
      x: w / 2 + Math.cos(time / 1600) * w * 0.26,
      y: h * 0.55 + Math.sin(time / 1100) * h * 0.16,
      on: true,
      real: false
    };
  }

  function spawnSpark(state, x, y, vx, vy) {
    if (state.sparks.length >= SPARK_MAX) return;
    var life = rand(0.5, 1.2);
    state.sparks.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: rand(1.5, 4) * state.sc });
  }

  function updateLantern(l, dt, time, state) {
    var sc = state.sc;
    var layer = LAYERS[l.layer];

    l.y -= l.vy * state.riseSpeed * dt;
    l.tiltV *= Math.pow(0.02, dt); // 衰减
    l.tilt = Math.sin(time * 0.0005 * l.swaySpeed + l.phase) * 0.05 * state.sway + l.tiltV;
    l.boost *= Math.pow(0.2, dt);

    if (state.mouseOn) {
      var swayX = Math.sin(time * 0.0004 * l.swaySpeed + l.phase) * layer.swayA * state.sway * sc;
      var dx = (l.x + swayX) - state.mouseX;
      var dy = l.y - state.mouseY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var R = layer.mouseR * sc;
      if (dist < R) {
        var inf = 1 - dist / R;
        // 上升气流托起
        l.y -= inf * layer.mouseF * (46 + state.speed * 1.4) * dt;
        // 气流向两侧排开
        var push = (dx / (dist || 1)) * inf * layer.mouseF * 46;
        l.x += push * dt;
        l.tiltV += (push > 0 ? 1 : -1) * inf * 1.4 * dt;
        l.boost = Math.max(l.boost, inf);
      }
    }

    // 越顶后回到底部重新升起
    if (l.y < -90 * sc) {
      var nl = makeLantern(l.layer, state.w, state.h, sc, true);
      l.x = nl.x; l.y = nl.y; l.size = nl.size; l.vy = nl.vy;
      l.phase = nl.phase; l.swaySpeed = nl.swaySpeed; l.tilt = 0; l.tiltV = 0; l.boost = 0;
    }
  }

  function drawLantern(ctx, l, time, state) {
    var layer = LAYERS[l.layer];
    var sc = state.sc;
    var swayX = Math.sin(time * 0.0004 * l.swaySpeed + l.phase) * layer.swayA * state.sway * sc;
    var x = l.x + swayX;
    var y = l.y;
    var s = l.size;

    var flick = 0.7 + 0.3 * Math.sin(time * 0.011 * l.f1 + l.phase * 3) * Math.sin(time * 0.023 * l.f2 + l.phase);
    flick = Math.max(0.35, Math.min(1, flick)) + l.boost * 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(l.tilt);

    // 光晕
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, layer.glowA * state.glow * (0.7 + flick * 0.4));
    var gs = s * 3.4;
    ctx.drawImage(state.glow, -gs / 2, -gs / 2, gs, gs);

    // 灯罩
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = layer.bodyA;
    ctx.drawImage(state.body, -s * 0.5, -s * 0.62, s, s * 1.24);

    // 火芯
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, (0.5 + flick * 0.5) * layer.bodyA);
    var fs = s * 0.5;
    ctx.drawImage(state.flame, -fs / 2, s * 0.06, fs, fs);

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function render(ctx, w, h, time, dt, state) {
    if (state.palette === undefined) state.palette = 'gold';
    if (state.count === undefined) state.count = 70;
    if (state.riseSpeed === undefined) state.riseSpeed = 1;
    if (state.sway === undefined) state.sway = 1;
    if (state.glow === undefined) state.glow = 1;

    if (!state.init || state.gridW !== w || state.gridH !== h) {
      initResources(state, w, h);
      state.init = true;
      state.gridW = w;
      state.gridH = h;
    }

    var cursor = readCursor(w, h, time, state);
    if (cursor.on) {
      if (state.prevX !== null) {
        var mdx = cursor.x - state.prevX;
        var mdy = cursor.y - state.prevY;
        var inst = Math.sqrt(mdx * mdx + mdy * mdy);
        state.speed = state.speed * 0.7 + inst * 0.3;
      }
      state.prevX = cursor.x;
      state.prevY = cursor.y;
      state.mouseX = cursor.x;
      state.mouseY = cursor.y;
      state.mouseOn = true;
    } else {
      state.mouseOn = false;
      state.prevX = null;
      state.speed = 0;
    }

    var dtSec = Math.min(dt, 0.05);
    var sc = state.sc;
    var i, l;

    // -- 1. 夜间星点 --
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    for (i = 0; i < state.stars.length; i++) {
      var st = state.stars[i];
      var tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 0.001 * st.sp + st.ph));
      ctx.globalAlpha = tw * 0.35;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // -- 2. 底部祭灯地微光 --
    var gg = ctx.createLinearGradient(0, h * 0.86, 0, h);
    gg.addColorStop(0, 'rgba(' + state.spec.glow + ',0)');
    gg.addColorStop(1, 'rgba(' + state.spec.glow + ',0.08)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    ctx.globalCompositeOperation = 'source-over';

    // -- 3. 成群放飞 --
    state.clusterTimer -= dtSec;
    if (state.clusterTimer <= 0) {
      state.clusterTimer = rand(6, 12);
      if (state.extras.length < EXTRA_MAX) {
        var cx = rand(w * 0.15, w * 0.85);
        var n = 3 + Math.floor(Math.random() * 3);
        for (i = 0; i < n && state.extras.length < EXTRA_MAX; i++) {
          var el = makeLantern(Math.random() < 0.5 ? 1 : 2, w, h, sc, true);
          el.x = cx + rand(-50, 50) * sc;
          el.y = h + rand(30, 120) * sc + i * 26 * sc;
          state.extras.push(el);
        }
      }
    }

    // -- 4. 更新并绘制（远→中→近→额外） --
    var order = [0, 1, 2];
    for (var oi = 0; oi < order.length; oi++) {
      var arr = state.layers[order[oi]];
      for (i = 0; i < arr.length; i++) {
        updateLantern(arr[i], dtSec, time, state);
        drawLantern(ctx, arr[i], time, state);
      }
    }
    for (i = state.extras.length - 1; i >= 0; i--) {
      updateLantern(state.extras[i], dtSec, time, state);
      drawLantern(ctx, state.extras[i], time, state);
    }

    // -- 5. 快速划过撒火星 --
    if (state.mouseOn && state.speed > SWIPE_SPEED) {
      var nSpark = Math.min(3, Math.floor(state.speed / 6));
      for (i = 0; i < nSpark; i++) {
        spawnSpark(state,
          state.mouseX + rand(-8, 8) * sc,
          state.mouseY + rand(-6, 6) * sc,
          rand(-30, 30) * sc,
          rand(-70, -20) * sc);
      }
    }

    // -- 6. 火星 --
    if (state.sparks.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (i = state.sparks.length - 1; i >= 0; i--) {
        var sp = state.sparks[i];
        sp.life -= dtSec;
        if (sp.life <= 0) { state.sparks.splice(i, 1); continue; }
        sp.vy -= 30 * dtSec;      // 余焰上浮
        sp.vx *= Math.pow(0.4, dtSec);
        sp.x += sp.vx * dtSec;
        sp.y += sp.vy * dtSec;
        var a = sp.life / sp.max;
        ctx.globalAlpha = a * 0.9;
        var ssz = sp.size * (0.6 + a * 0.6) * 2;
        ctx.drawImage(state.flame, sp.x - ssz / 2, sp.y - ssz / 2, ssz, ssz);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // -- 7. 光标上升气流提示 --
    if (state.mouseOn) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + Math.min(0.12, state.speed * 0.004);
      var hr = 110 * sc;
      ctx.drawImage(state.glow, state.mouseX - hr / 2, state.mouseY - hr / 2, hr, hr);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function resetState(state) {
    state.init = false;
    state.mouse = null;
    state.mouseOn = false;
    state.prevX = null;
    state.speed = 0;
  }

  window.bloomRegister('skyLantern', render, resetState);
})();