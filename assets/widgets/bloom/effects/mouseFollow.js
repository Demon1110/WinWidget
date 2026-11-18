// 星尘光标 - 鼠标移动时涌出多彩飘散的星尘粒子，停下后归于平静
// 设计原则：动则有星尘，静则无干扰；混入全光谱色彩，任意背景均可见
window.bloomRegister('mouseFollow',
  function (ctx, w, h, time, dt, state) {
    // -- 懒初始化 / 配置读取（无配置时走默认值，行为与原版一致） --
    if (!state.init) {
      state.particleCount = state.particleCount || 120;
      state.glowRadius = state.glowRadius || 38;
      state.trail = state.trail || 0.25;
      state.palette = state.palette || 'rainbow';
      // 根据调色板预设选择颜色组
      var pal;
      if (state.palette === 'warm') {
        pal = [
          { h: 0,   s: 90, l: 68 },
          { h: 25,  s: 95, l: 62 },
          { h: 45,  s: 95, l: 65 },
          { h: 350, s: 85, l: 65 }
        ];
      } else if (state.palette === 'cool') {
        pal = [
          { h: 185, s: 90, l: 72 },
          { h: 210, s: 90, l: 72 },
          { h: 265, s: 85, l: 72 },
          { h: 160, s: 80, l: 65 }
        ];
      } else if (state.palette === 'mono') {
        pal = [
          { h: 0, s: 0, l: 90 }
        ];
      } else { // rainbow（默认）
        pal = [
          { h: 185, s: 90, l: 72 },
          { h: 215, s: 90, l: 72 },
          { h: 270, s: 85, l: 72 },
          { h: 320, s: 85, l: 72 },
          { h: 45,  s: 95, l: 70 }
        ];
      }
      state.paletteArr = pal;

      state.init = true;
      state.particles = [];
      state.mx = null; state.my = null;
      state.prevX = null; state.prevY = null;
      state.speed = 0;
      state.stillTime = 0;          // 持续静止的时长，用于淡出光晕
      state.sprites = null;         // 预渲染各色辉光 sprite
    }

    // -- 常量（从 state 读取配置） --
    var MAX_PARTICLES = state.particleCount;  // 粒子上限（克制，避免视觉噪音）
    var TRAIL = state.trail;                   // 光晕惯性跟随系数
    var STILL_THRESHOLD = 0.8;                 // 低于此速度视为"静止"，不再生成粒子
    var GLOW_R = state.glowRadius;             // 静止光晕半径（小而克制）
    var PALETTE = state.paletteArr;

    // -- 预渲染各色辉光 sprite（只渲染一次，每色一张）--
    if (!state.sprites) {
      var sprites = [];
      for (var ci = 0; ci < PALETTE.length; ci++) {
        var c = PALETTE[ci];
        var spr = document.createElement('canvas');
        spr.width = 32; spr.height = 32;
        var sctx = spr.getContext('2d');
        var sg = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        sg.addColorStop(0, 'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,1)');
        sg.addColorStop(0.3, 'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,0.5)');
        sg.addColorStop(1, 'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,0)');
        sctx.fillStyle = sg;
        sctx.fillRect(0, 0, 32, 32);
        sprites.push(spr);
      }
      state.sprites = sprites;
    }

    // -- 获取鼠标位置 --
    // 优先：overlay preload 自行轮询（__bloomCursorService），不受主窗口节流影响。
    // 回退：utools / 主窗口注入 bloomCursor / services / 正弦模拟。
    var mx, my, onScreen;
    var point = null;
    if (window.__bloomCursorService && window.__bloomCursorService.getCursorScreenPoint) {
      try { point = window.__bloomCursorService.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.utools && window.utools.getCursorScreenPoint) {
      try { point = window.utools.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.bloomCursor) {
      point = window.bloomCursor;
    }
    if (!point && window.services && window.services.getCursorScreenPoint) {
      try { point = window.services.getCursorScreenPoint(); } catch (e) { point = null; }
    }

    if (point) {
      state.ox = window.screenX;
      state.oy = window.screenY;
      var lx = point.x - state.ox;
      var ly = point.y - state.oy;
      onScreen = (lx >= -20 && lx < w + 20 && ly >= -20 && ly < h + 20);
      if (state.mx === null) { state.mx = lx; state.my = ly; }
      state.mx += (lx - state.mx) * TRAIL;
      state.my += (ly - state.my) * TRAIL;
      mx = state.mx; my = state.my;
    } else {
      // 回退：正弦曲线模拟，加大运动幅度确保有粒子产出
      mx = w / 2 + Math.cos(time / 600) * w * 0.3;
      my = h / 2 + Math.sin(time / 470) * h * 0.25;
      onScreen = true;
    }

    // -- 计算鼠标速度 --
    var speed = 0;
    if (state.prevX !== null && onScreen) {
      var sdx = mx - state.prevX;
      var sdy = my - state.prevY;
      speed = Math.sqrt(sdx * sdx + sdy * sdy);
    }
    state.speed = state.speed * 0.7 + speed * 0.3;
    var spd = state.speed;
    state.prevX = mx; state.prevY = my;

    // -- 静止计时：移动时归零，静止时累加（用于光晕淡出）--
    if (spd < STILL_THRESHOLD) {
      state.stillTime += dt;
    } else {
      state.stillTime = 0;
    }

    // -- 生成粒子（仅在移动时，静止不生成）--
    if (onScreen && spd > STILL_THRESHOLD) {
      // 移动越快喷越多，但总量克制
      var spawn = Math.min(1 + Math.floor((spd - STILL_THRESHOLD) * 0.4), 6);
      for (var i = 0; i < spawn; i++) {
        if (state.particles.length >= MAX_PARTICLES) break;
        var angle = Math.random() * Math.PI * 2;
        var radial = Math.random() * 1.2 + 0.2;
        // 继承鼠标移动方向的一部分（拖尾感）
        var dirX = spd > 0.5 ? (mx - state.prevX) / spd * 0.3 : 0;
        var dirY = spd > 0.5 ? (my - state.prevY) / spd * 0.3 : 0;
        var maxLife = 0.5 + Math.random() * 0.9;  // 存活更短，停下后快速消失
        var colorIdx = (Math.random() * PALETTE.length) | 0;  // 随机选色
        state.particles.push({
          x: mx + (Math.random() - 0.5) * 5,
          y: my + (Math.random() - 0.5) * 5,
          vx: Math.cos(angle) * radial + dirX,
          vy: Math.sin(angle) * radial + dirY,
          size: Math.random() * 1.8 + 0.6,
          ci: colorIdx,
          life: maxLife,
          maxLife: maxLife
        });
      }
    }

    // -- 发光混合 --
    ctx.globalCompositeOperation = 'lighter';

    // -- 鼠标光晕：移动时亮，静止 0.8s 内淡出至无；色相随时间在调色板间流转 --
    if (onScreen) {
      // 0~1：刚移动=1，静止超过 0.8s=0
      var glowFade = state.stillTime < 0.8 ? (1 - state.stillTime / 0.8) : 0;
      if (glowFade > 0.01) {
        var glowAlpha = 0.08 * glowFade;
        var r = GLOW_R;
        // 色相缓慢流转（每 3 秒切一色），与粒子多彩呼应
        var gc = PALETTE[((time / 3000) | 0) % PALETTE.length];
        var gg = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        gg.addColorStop(0, 'hsla(' + gc.h + ',' + gc.s + '%,' + gc.l + '%,' + glowAlpha + ')');
        gg.addColorStop(0.5, 'hsla(' + gc.h + ',' + gc.s + '%,' + (gc.l - 14) + '%,' + (glowAlpha * 0.35) + ')');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(mx - r, my - r, r * 2, r * 2);
      }
    }

    // -- 更新 + 渲染粒子（用预渲染 sprite，避免每帧 createRadialGradient）--
    var ps = state.particles;
    var sprites = state.sprites;
    for (var j = ps.length - 1; j >= 0; j--) {
      var p = ps[j];
      p.life -= dt;
      if (p.life <= 0) {
        ps[j] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      // 运动：速度衰减 + 微小上飘（星尘感）
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.vy -= 0.015;
      p.x += p.vx;
      p.y += p.vy;

      var lr = p.life / p.maxLife;
      var alpha = lr * 0.75;
      var radius = p.size * (0.6 + lr * 0.7) * 2.5;

      // 用对应色的 sprite + globalAlpha，零梯度创建
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[p.ci], p.x - radius, p.y - radius, radius * 2, radius * 2);
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';
  },
  function (state) {
    state.init = false;
    state.particles = null;
    state.mx = null;
    state.my = null;
    state.prevX = null;
    state.prevY = null;
    state.speed = 0;
    state.stillTime = 0;
    state.sprites = null;
  }
);
