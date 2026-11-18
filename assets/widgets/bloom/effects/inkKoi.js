// ============================================================
// 水墨游鱼 (Ink Koi) — 全面优化版
// ============================================================
// 优化清单:
//  #2  splice → swap-and-pop (O(1) 粒子删除)
//  #3  墨晕粒子预渲染 sprite (消除每帧 createRadialGradient)
//  #4  辅助绘制函数提取到渲染循环外
//  #5  合并 save/restore (眼睛+触须+背鳍共用)
//  #6  鱼群分离互动 (简化 Boids)
//  #7  新增腹鳍 (Pelvic Fins)
//  #8  水面焦散光斑 (Caustics)
//  #9  非线性游速 (划水-滑行节奏)
//  #10 鳞片纹理暗示
//  #11 魔法数字提取为语义常量
//  #12 调色板数据复用
//  #13 time 缩放统一为秒+频率
// ============================================================

(function () {
  'use strict';

  // ===== 常量定义 (#11) =====
  var JOINT_COUNT = 8;
  var JOINT_SPACING = 0.78;
  var BORDER_DIST = 120;
  var HEAD_WIGGLE_FREQ = 3.5;      // Hz — 摆头频率
  var HEAD_WIGGLE_AMP = 0.22;      // rad — 摆头幅度
  var TURN_SMOOTH = 1.6;           // 转向平滑系数
  var RIPPLE_CHANCE = 0.007;       // 每帧涟漪生成概率
  var INK_CHANCE = 0.12;           // 每帧墨晕粒子生成概率
  var CAUSTIC_CHANCE = 0.008;      // 每帧焦散生成概率
  var SNOUT_FORWARD = 0.85;        // 头部前凸距离比
  var EYE_ANGLE = Math.PI / 2.15;  // 眼睛偏移角
  var EYE_DIST = 0.73;             // 眼睛凸出距离比
  var WHISKER_LONG_FREQ = 4.0;     // Hz — 长须摆动频率
  var WHISKER_SHORT_FREQ = 6.5;    // Hz — 短须摆动频率
  var BODY_SCALES = [0.65, 0.95, 1.15, 1.05, 0.88, 0.68, 0.45, 0.24];
  var FISH_SEP_DIST = 2.5;         // 鱼间最小距离 (乘以双鱼尺寸之和)
  var FISH_SEP_FORCE = 0.15;       // 分离推力系数

  // ===== 调色板 (#12: 白色系复用) =====
  var whitePalette = {
    body: 'rgba(250, 248, 244, 0.96)',
    bodyMid: 'rgba(238, 234, 228, 0.96)',
    bodyTail: 'rgba(228, 224, 218, 0.96)',
    finsOpaque: 'rgba(250, 248, 244, 0.75)',
    finsTranslucent: 'rgba(250, 248, 244, 0.25)',
    spotsColor: 'rgba(220, 30, 30, 0.85)'
  };

  var palettes = {
    kohaku: whitePalette,
    sanke: whitePalette,
    sumi: {
      body: 'rgba(40, 40, 42, 0.96)',
      bodyMid: 'rgba(30, 30, 32, 0.96)',
      bodyTail: 'rgba(20, 20, 22, 0.96)',
      finsOpaque: 'rgba(40, 40, 42, 0.65)',
      finsTranslucent: 'rgba(30, 30, 32, 0.15)',
      spotsColor: 'rgba(15, 15, 18, 0.85)'
    },
    kiUtsuri: {
      body: 'rgba(35, 35, 38, 0.96)',
      bodyMid: 'rgba(25, 25, 28, 0.96)',
      bodyTail: 'rgba(15, 15, 18, 0.96)',
      finsOpaque: 'rgba(35, 35, 38, 0.65)',
      finsTranslucent: 'rgba(25, 25, 28, 0.15)',
      spotsColor: 'rgba(235, 160, 0, 0.9)'
    }
  };

  // ===== 斑纹配置 =====
  var spotConfigs = {
    kohaku: [
      { jointIndex: 0, offsetAngle: 0, offsetDist: 0.1, radius: 0.75, color: 'red' },
      { jointIndex: 2, offsetAngle: -0.25, offsetDist: 0.2, radius: 0.9, color: 'red' },
      { jointIndex: 4, offsetAngle: 0.2, offsetDist: 0.15, radius: 0.65, color: 'red' }
    ],
    sanke: [
      { jointIndex: 0, offsetAngle: 0.15, offsetDist: 0.15, radius: 0.7, color: 'red' },
      { jointIndex: 1, offsetAngle: -0.4, offsetDist: 0.3, radius: 0.45, color: 'black' },
      { jointIndex: 3, offsetAngle: 0.25, offsetDist: 0.1, radius: 0.8, color: 'red' },
      { jointIndex: 4, offsetAngle: -0.3, offsetDist: 0.2, radius: 0.4, color: 'black' },
      { jointIndex: 6, offsetAngle: 0.1, offsetDist: 0.1, radius: 0.35, color: 'black' }
    ],
    sumi: [
      { jointIndex: 1, offsetAngle: 0.2, offsetDist: 0.1, radius: 0.95, color: 'black' },
      { jointIndex: 4, offsetAngle: -0.15, offsetDist: 0.15, radius: 0.75, color: 'black' }
    ],
    kiUtsuri: [
      { jointIndex: 0, offsetAngle: -0.15, offsetDist: 0.15, radius: 0.7, color: 'yellow' },
      { jointIndex: 2, offsetAngle: 0.3, offsetDist: 0.2, radius: 0.85, color: 'yellow' },
      { jointIndex: 4, offsetAngle: -0.2, offsetDist: 0.15, radius: 0.65, color: 'yellow' },
      { jointIndex: 6, offsetAngle: 0.1, offsetDist: 0.1, radius: 0.45, color: 'yellow' }
    ]
  };

  // ===== 预渲染墨晕精灵图 (#3) =====
  var inkSprites = null;

  function ensureInkSprites() {
    if (inkSprites) return;
    inkSprites = {};
    var SIZE = 128;
    var inkColors = {
      black: [35, 35, 38],
      red: [200, 30, 30],
      yellow: [225, 155, 5]
    };

    var keys = Object.keys(inkColors);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var rgb = inkColors[key];
      var offCanvas = document.createElement('canvas');
      offCanvas.width = offCanvas.height = SIZE;
      var offCtx = offCanvas.getContext('2d');
      var g = offCtx.createRadialGradient(
        SIZE / 2, SIZE / 2, SIZE * 0.025,
        SIZE / 2, SIZE / 2, SIZE / 2
      );
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)');
      g.addColorStop(0.35, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.4)');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      offCtx.fillStyle = g;
      offCtx.beginPath();
      offCtx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      offCtx.fill();
      inkSprites[key] = offCanvas;
    }
  }

  // ===== 辅助绘制函数 (#4: 提取到渲染循环外) =====

  // 胸鳍 (扇形划水鳍)
  function drawPectoralFin(ctx, x, y, angle, length, palette) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);

    var cp1x = x + Math.cos(angle - 0.4) * (length * 0.7);
    var cp1y = y + Math.sin(angle - 0.4) * (length * 0.7);
    var p1x = x + Math.cos(angle - 0.15) * length;
    var p1y = y + Math.sin(angle - 0.15) * length;

    var p2x = x + Math.cos(angle + 0.35) * length;
    var p2y = y + Math.sin(angle + 0.35) * length;
    var cp2x = x + Math.cos(angle + 0.5) * (length * 0.6);
    var cp2y = y + Math.sin(angle + 0.5) * (length * 0.6);

    ctx.bezierCurveTo(cp1x, cp1y, p1x, p1y, p1x, p1y);
    ctx.bezierCurveTo(
      x + Math.cos(angle + 0.05) * (length * 1.15),
      y + Math.sin(angle + 0.05) * (length * 1.15),
      p2x, p2y,
      p2x, p2y
    );
    ctx.quadraticCurveTo(cp2x, cp2y, x, y);
    ctx.closePath();

    var grad = ctx.createLinearGradient(x, y, p1x, p1y);
    grad.addColorStop(0, palette.finsOpaque);
    grad.addColorStop(0.4, palette.finsTranslucent);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // 扇骨脉络线
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.07)';
    ctx.lineWidth = 0.6;
    for (var i = 0; i <= 5; i++) {
      var t = i / 5;
      var targetX = p1x * (1 - t) + p2x * t;
      var targetY = p1y * (1 - t) + p2y * t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 腹鳍 (#7: 新增，增强写实度)
  function drawPelvicFin(ctx, x, y, angle, length, palette) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);

    var cp1x = x + Math.cos(angle - 0.3) * (length * 0.6);
    var cp1y = y + Math.sin(angle - 0.3) * (length * 0.6);
    var tipX = x + Math.cos(angle) * length;
    var tipY = y + Math.sin(angle) * length;
    var cp2x = x + Math.cos(angle + 0.4) * (length * 0.5);
    var cp2y = y + Math.sin(angle + 0.4) * (length * 0.5);

    ctx.quadraticCurveTo(cp1x, cp1y, tipX, tipY);
    ctx.quadraticCurveTo(cp2x, cp2y, x, y);
    ctx.closePath();

    var grad = ctx.createLinearGradient(x, y, tipX, tipY);
    grad.addColorStop(0, palette.finsOpaque);
    grad.addColorStop(0.5, palette.finsTranslucent);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // 鳍骨细线
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.05)';
    ctx.lineWidth = 0.4;
    for (var i = 0; i <= 3; i++) {
      var t = i / 3;
      var rayAngle = angle - 0.3 + t * 0.7;
      var rx = x + Math.cos(rayAngle) * (length * 0.85);
      var ry = y + Math.sin(rayAngle) * (length * 0.85);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(rx, ry);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 尾鳍与流苏 (蝶尾 + 水墨细丝)
  function drawCaudalFin(ctx, x, y, angle, length, width, palette, swimPhase) {
    ctx.save();

    // 双瓣蝶尾主扇面
    var lobes = [
      { ang: angle - 0.2, len: length, w: width * 1.1, opacity: 0.88, s: -1 },
      { ang: angle + 0.2, len: length * 0.92, w: width * 1.0, opacity: 0.68, s: 1 }
    ];

    for (var k = 0; k < 2; k++) {
      var curAngle = lobes[k].ang;
      var curLen = lobes[k].len;
      var curW = lobes[k].w;
      var s = lobes[k].s;

      ctx.beginPath();
      ctx.moveTo(x, y);

      var lcp1x = x + Math.cos(curAngle + s * 0.2) * (curLen * 0.45);
      var lcp1y = y + Math.sin(curAngle + s * 0.2) * (curLen * 0.45);
      var lp1x = x + Math.cos(curAngle - s * 0.1) * curLen;
      var lp1y = y + Math.sin(curAngle - s * 0.1) * curLen;

      var lp2x = x + Math.cos(curAngle + s * 0.45) * (curLen * 0.78);
      var lp2y = y + Math.sin(curAngle + s * 0.45) * (curLen * 0.78);
      var lcp2x = x + Math.cos(curAngle + s * 0.55) * (curLen * 0.4);
      var lcp2y = y + Math.sin(curAngle + s * 0.55) * (curLen * 0.4);

      ctx.bezierCurveTo(lcp1x, lcp1y,
        lp1x - Math.sin(curAngle) * curW * 0.35,
        lp1y + Math.cos(curAngle) * curW * 0.35,
        lp1x, lp1y);
      ctx.quadraticCurveTo(
        x + Math.cos(curAngle) * (curLen * 0.7),
        y + Math.sin(curAngle) * (curLen * 0.7),
        lp2x, lp2y);
      ctx.bezierCurveTo(
        lp2x + Math.sin(curAngle) * curW * 0.25,
        lp2y - Math.cos(curAngle) * curW * 0.25,
        lcp2x, lcp2y, x, y);
      ctx.closePath();

      var grad = ctx.createLinearGradient(x, y, lp1x, lp1y);
      grad.addColorStop(0, palette.finsOpaque);
      grad.addColorStop(0.3, palette.finsTranslucent);
      grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.05)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = grad;
      ctx.globalAlpha = lobes[k].opacity;
      ctx.fill();

      // 尾纱褶皱线 (7条精细骨架线)
      ctx.strokeStyle = 'rgba(60, 60, 60, 0.04)';
      ctx.lineWidth = 0.5;
      for (var i = 0; i <= 6; i++) {
        var t = i / 6;
        var tx = lp1x * (1 - t) + lp2x * t;
        var ty = lp1y * (1 - t) + lp2y * t;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 尾鳍末端水墨细丝流苏 (4根延迟卷曲墨线)
    ctx.save();
    ctx.lineWidth = 0.85;

    var threadAngles = [angle - 0.38, angle - 0.12, angle + 0.12, angle + 0.38];
    var threadLengths = [length * 1.6, length * 1.95, length * 1.85, length * 1.55];

    for (var i = 0; i < 4; i++) {
      var phase = swimPhase - 1.3 - i * 0.32;
      var tAngle = threadAngles[i] + Math.sin(phase) * 0.35;
      var tLen = threadLengths[i];

      ctx.beginPath();
      ctx.moveTo(x, y);

      var tcp1x = x + Math.cos(tAngle) * (tLen * 0.45);
      var tcp1y = y + Math.sin(tAngle) * (tLen * 0.45);
      var tcp2x = x + Math.cos(tAngle + Math.sin(phase + 0.5) * 0.22) * (tLen * 0.8);
      var tcp2y = y + Math.sin(tAngle + Math.sin(phase + 0.5) * 0.22) * (tLen * 0.8);
      var endX = x + Math.cos(tAngle + Math.sin(phase + 1.0) * 0.42) * tLen;
      var endY = y + Math.sin(tAngle + Math.sin(phase + 1.0) * 0.42) * tLen;

      ctx.bezierCurveTo(tcp1x, tcp1y, tcp2x, tcp2y, endX, endY);

      var threadGrad = ctx.createLinearGradient(x, y, endX, endY);
      threadGrad.addColorStop(0, palette.finsOpaque);
      threadGrad.addColorStop(0.35, palette.finsTranslucent);
      threadGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = threadGrad;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ===== 主渲染注册 =====
  window.bloomRegister('inkKoi',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13: 统一为秒
      var safeDt = Math.min(dt, 0.05);

      // ── 1. 初始化 ──
      if (!state.initialized) {
        state.fishCount = state.fishCount || 5;
        state.koiVariety = state.koiVariety || 'mixed';
        state.fishSize = state.fishSize || 25;
        state.swimSpeed = state.swimSpeed || 1;
        ensureInkSprites(); // #3
        state.fishes = [];
        state.inkParticles = [];
        state.ripples = [];
        state.caustics = []; // #8
        state.initialized = true;

        // 锦鲤品种/尺寸/速度基准（循环复用以支持任意 fishCount）
        var varietyBase = ['kohaku', 'sanke', 'sumi', 'kiUtsuri'];
        var sizeBase = [25, 20, 27, 18, 22];
        var speedBase = [65, 80, 58, 90, 72];
        var fishTypes = [];
        var sizes = [];
        var baseSpeeds = [];
        for (var vi = 0; vi < state.fishCount; vi++) {
          fishTypes.push(state.koiVariety === 'mixed' ? varietyBase[vi % varietyBase.length] : state.koiVariety);
          sizes.push(sizeBase[vi % sizeBase.length] * (state.fishSize / 25));
          baseSpeeds.push(speedBase[vi % speedBase.length] * state.swimSpeed);
        }

        for (var fi = 0; fi < fishTypes.length; fi++) {
          var type = fishTypes[fi];
          var size = sizes[fi];
          var speed = baseSpeeds[fi];

          var startX = Math.random() * w;
          var startY = Math.random() * h;
          var startAngle = Math.random() * Math.PI * 2;

          var joints = [];
          var jDist = size * JOINT_SPACING;
          for (var j = 0; j < JOINT_COUNT; j++) {
            joints.push({
              x: startX - Math.cos(startAngle) * j * jDist,
              y: startY - Math.sin(startAngle) * j * jDist,
              angle: startAngle
            });
          }

          state.fishes.push({
            x: startX, y: startY,
            angle: startAngle,
            speed: speed,
            size: size,
            type: type,
            colorPalette: palettes[type],
            spots: spotConfigs[type],
            joints: joints,
            swimPhase: Math.random() * Math.PI * 2,
            swimFrequency: 4.5 + Math.random() * 1.5,
            wiggleOffset: Math.random() * 100,
            targetX: Math.random() * w,
            targetY: Math.random() * h,
            targetTimer: Math.random() * 5 + 4
          });
        }
      }

      // ── 2. 焦散光斑 (#8) ──
      if (Math.random() < CAUSTIC_CHANCE) {
        state.caustics.push({
          x: Math.random() * w,
          y: Math.random() * h,
          rx: 15 + Math.random() * 30,
          ry: 8 + Math.random() * 15,
          rotation: Math.random() * Math.PI,
          alpha: 0.025 + Math.random() * 0.02,
          decay: 0.008 + Math.random() * 0.006
        });
      }

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      for (var ci = state.caustics.length - 1; ci >= 0; ci--) {
        var cst = state.caustics[ci];
        cst.alpha -= cst.decay * safeDt;
        cst.rotation += 0.1 * safeDt;

        if (cst.alpha <= 0) {
          var cLast = state.caustics.length - 1;
          if (ci !== cLast) state.caustics[ci] = state.caustics[cLast];
          state.caustics.pop();
          continue;
        }

        ctx.globalAlpha = cst.alpha;
        ctx.beginPath();
        ctx.ellipse(cst.x, cst.y, cst.rx, cst.ry, cst.rotation, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── 3. 涟漪 (#2: swap-and-pop) ──
      for (var ri = state.ripples.length - 1; ri >= 0; ri--) {
        var rp = state.ripples[ri];
        rp.r += rp.speed * safeDt;
        rp.alpha = 0.16 * (1 - rp.r / rp.maxR);

        if (rp.r >= rp.maxR || rp.alpha <= 0) {
          var rLast = state.ripples.length - 1;
          if (ri !== rLast) state.ripples[ri] = state.ripples[rLast];
          state.ripples.pop();
          continue;
        }

        ctx.save();
        ctx.strokeStyle = 'rgba(130, 145, 160, ' + rp.alpha + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();

        if (rp.r > rp.maxR * 0.22) {
          ctx.strokeStyle = 'rgba(130, 145, 160, ' + (rp.alpha * 0.45) + ')';
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, rp.r * 0.78, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── 4. 墨晕粒子 (#2 + #3: swap-and-pop + sprite 缓存) ──
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      for (var pi = state.inkParticles.length - 1; pi >= 0; pi--) {
        var p = state.inkParticles[pi];
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
        p.size += (p.maxSize - p.size) * 1.2 * safeDt;
        p.alpha -= p.decay * safeDt;

        if (p.alpha <= 0) {
          var pLast = state.inkParticles.length - 1;
          if (pi !== pLast) state.inkParticles[pi] = state.inkParticles[pLast];
          state.inkParticles.pop();
          continue;
        }

        ctx.globalAlpha = p.alpha;
        var sprite = inkSprites[p.colorKey] || inkSprites.black;
        ctx.drawImage(sprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      }
      ctx.restore();

      // ── 5. 鱼群分离互动 (#6) ──
      for (var si = 0; si < state.fishes.length; si++) {
        for (var sj = si + 1; sj < state.fishes.length; sj++) {
          var fA = state.fishes[si], fB = state.fishes[sj];
          var sdx = fA.x - fB.x;
          var sdy = fA.y - fB.y;
          var sDist = Math.sqrt(sdx * sdx + sdy * sdy);
          var minDist = (fA.size + fB.size) * FISH_SEP_DIST;
          if (sDist < minDist && sDist > 0) {
            var push = (minDist - sDist) * FISH_SEP_FORCE;
            var nx = sdx / sDist, ny = sdy / sDist;
            fA.targetX += nx * push;
            fA.targetY += ny * push;
            fB.targetX -= nx * push;
            fB.targetY -= ny * push;
          }
        }
      }

      // ── 6. 逐鱼更新与绘制 ──
      for (var bi = 0; bi < state.fishes.length; bi++) {
        var b = state.fishes[bi];

        // —— a. 目标游动导向 ——
        b.targetTimer -= safeDt;
        var dx = b.targetX - b.x;
        var dy = b.targetY - b.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (b.targetTimer <= 0 || dist < 120) {
          b.targetX = Math.random() * w;
          b.targetY = Math.random() * h;
          b.targetTimer = Math.random() * 6 + 5;
        }

        // 边界弹性避让
        if (b.x < BORDER_DIST || b.x > w - BORDER_DIST ||
            b.y < BORDER_DIST || b.y > h - BORDER_DIST) {
          b.targetX = w / 2 + (Math.random() - 0.5) * (w * 0.4);
          b.targetY = h / 2 + (Math.random() - 0.5) * (h * 0.4);
          b.targetTimer = 4;
        }

        // 目标朝向 + 摆头噪声 (#13)
        var targetAngle = Math.atan2(dy, dx);
        var headWiggle = Math.sin(timeSec * HEAD_WIGGLE_FREQ + b.wiggleOffset) * HEAD_WIGGLE_AMP;
        targetAngle += headWiggle;

        // 平滑旋转
        var angleDiff = targetAngle - b.angle;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        b.angle += angleDiff * TURN_SMOOTH * safeDt;

        // 非线性游速 (#9: 划水-滑行节奏)
        b.swimPhase += b.swimFrequency * safeDt;
        var rawSwim = Math.sin(b.swimPhase);
        var velocityScale = 0.55 + 0.55 * Math.max(0, rawSwim);
        var currentSpeed = b.speed * velocityScale;

        b.x += Math.cos(b.angle) * currentSpeed * safeDt;
        b.y += Math.sin(b.angle) * currentSpeed * safeDt;

        // —— b. 关节骨架解算 ——
        var joints = b.joints;
        joints[0].x = b.x;
        joints[0].y = b.y;
        joints[0].angle = b.angle;

        var jointDist = b.size * JOINT_SPACING;
        for (var ji = 1; ji < joints.length; ji++) {
          var prev = joints[ji - 1];
          var curr = joints[ji];
          var kx = curr.x - prev.x;
          var ky = curr.y - prev.y;
          var d = Math.sqrt(kx * kx + ky * ky);

          if (d > 0) {
            curr.x = prev.x + (kx / d) * jointDist;
            curr.y = prev.y + (ky / d) * jointDist;
            curr.angle = Math.atan2(ky, kx);
          } else {
            curr.x = prev.x + jointDist;
            curr.y = prev.y;
            curr.angle = 0;
          }
        }

        // —— c. 生成墨晕粒子 ——
        if (Math.random() < INK_CHANCE) {
          var dropJoint = joints[3 + Math.floor(Math.random() * 4)];
          var inkColorKey = 'black';
          if (b.type === 'kohaku' || (b.type === 'sanke' && Math.random() < 0.65)) {
            inkColorKey = 'red';
          } else if (b.type === 'kiUtsuri' && Math.random() < 0.45) {
            inkColorKey = 'yellow';
          }

          state.inkParticles.push({
            x: dropJoint.x,
            y: dropJoint.y,
            vx: (Math.random() - 0.5) * 8 - Math.cos(dropJoint.angle) * 15,
            vy: (Math.random() - 0.5) * 8 - Math.sin(dropJoint.angle) * 15,
            size: b.size * (0.35 + Math.random() * 0.4),
            maxSize: b.size * (2.2 + Math.random() * 1.8),
            alpha: 0.38 + Math.random() * 0.18,
            decay: 0.16 + Math.random() * 0.12,
            colorKey: inkColorKey
          });
        }

        // —— d. 生成涟漪 ——
        if (Math.random() < RIPPLE_CHANCE && velocityScale > 0.95) {
          state.ripples.push({
            x: b.x, y: b.y,
            r: b.size * 0.4,
            maxR: b.size * (5.5 + Math.random() * 5),
            alpha: 0.18,
            speed: b.size * (2.8 + Math.random() * 1.6)
          });
        }

        // —— e. 计算躯干轮廓 ——
        var leftPoints = [];
        var rightPoints = [];

        for (var li = 0; li < joints.length; li++) {
          var joint = joints[li];
          var halfW = b.size * BODY_SCALES[li];
          var normalAngle = joint.angle + Math.PI / 2;
          var cosN = Math.cos(normalAngle);
          var sinN = Math.sin(normalAngle);

          leftPoints.push({ x: joint.x + cosN * halfW, y: joint.y + sinN * halfW });
          rightPoints.push({ x: joint.x - cosN * halfW, y: joint.y - sinN * halfW });
        }

        // —— f. 绘制鳍 (在身体下方) ——

        // 胸鳍
        var leftPecAngle = joints[1].angle + Math.PI / 2 + 0.32 + Math.sin(b.swimPhase) * 0.25;
        drawPectoralFin(ctx, leftPoints[1].x, leftPoints[1].y, leftPecAngle, b.size * 1.5, b.colorPalette);

        var rightPecAngle = joints[1].angle - Math.PI / 2 - 0.32 - Math.sin(b.swimPhase) * 0.25;
        drawPectoralFin(ctx, rightPoints[1].x, rightPoints[1].y, rightPecAngle, b.size * 1.5, b.colorPalette);

        // 腹鳍 (#7: 新增)
        var leftPelvicAngle = joints[3].angle + Math.PI / 2 + 0.45 + Math.sin(b.swimPhase - 0.5) * 0.2;
        drawPelvicFin(ctx, leftPoints[3].x, leftPoints[3].y, leftPelvicAngle, b.size * 0.9, b.colorPalette);

        var rightPelvicAngle = joints[3].angle - Math.PI / 2 - 0.45 - Math.sin(b.swimPhase - 0.5) * 0.2;
        drawPelvicFin(ctx, rightPoints[3].x, rightPoints[3].y, rightPelvicAngle, b.size * 0.9, b.colorPalette);

        // 尾鳍 + 流苏
        var tailJoint = joints[7];
        var tailFinAngle = tailJoint.angle + Math.PI + Math.sin(b.swimPhase - 1.1) * 0.42;
        drawCaudalFin(ctx, tailJoint.x, tailJoint.y, tailFinAngle,
          b.size * 2.5, b.size * 1.4, b.colorPalette, b.swimPhase);

        // —— g. 绘制躯干 (save/restore for clip) ——
        ctx.save();
        ctx.beginPath();
        // 从左腮开始
        ctx.moveTo(leftPoints[1].x, leftPoints[1].y);

        // U型圆润头部
        var snoutFwd = b.size * SNOUT_FORWARD;
        var hcp1x = leftPoints[1].x + Math.cos(joints[0].angle) * snoutFwd;
        var hcp1y = leftPoints[1].y + Math.sin(joints[0].angle) * snoutFwd;
        var hcp2x = rightPoints[1].x + Math.cos(joints[0].angle) * snoutFwd;
        var hcp2y = rightPoints[1].y + Math.sin(joints[0].angle) * snoutFwd;
        ctx.bezierCurveTo(hcp1x, hcp1y, hcp2x, hcp2y, rightPoints[1].x, rightPoints[1].y);

        // 右半身
        for (var ri2 = 2; ri2 < joints.length; ri2++) {
          var midX = (rightPoints[ri2 - 1].x + rightPoints[ri2].x) / 2;
          var midY = (rightPoints[ri2 - 1].y + rightPoints[ri2].y) / 2;
          ctx.quadraticCurveTo(rightPoints[ri2 - 1].x, rightPoints[ri2 - 1].y, midX, midY);
        }
        ctx.lineTo(rightPoints[joints.length - 1].x, rightPoints[joints.length - 1].y);

        // 尾尖过渡
        var tailTipX = joints[7].x - Math.cos(joints[7].angle) * (b.size * 0.28);
        var tailTipY = joints[7].y - Math.sin(joints[7].angle) * (b.size * 0.28);
        ctx.lineTo(tailTipX, tailTipY);

        // 左半身 (倒序)
        ctx.lineTo(leftPoints[joints.length - 1].x, leftPoints[joints.length - 1].y);
        for (var li2 = joints.length - 1; li2 > 1; li2--) {
          var nmX = (leftPoints[li2].x + leftPoints[li2 - 1].x) / 2;
          var nmY = (leftPoints[li2].y + leftPoints[li2 - 1].y) / 2;
          ctx.quadraticCurveTo(leftPoints[li2].x, leftPoints[li2].y, nmX, nmY);
        }
        ctx.lineTo(leftPoints[1].x, leftPoints[1].y);
        ctx.closePath();

        // 身体渐变填充
        var bodyGrad = ctx.createLinearGradient(joints[0].x, joints[0].y, joints[7].x, joints[7].y);
        bodyGrad.addColorStop(0, b.colorPalette.body);
        bodyGrad.addColorStop(0.45, b.colorPalette.bodyMid);
        bodyGrad.addColorStop(1, b.colorPalette.bodyTail);
        ctx.fillStyle = bodyGrad;

        // 阴影增加水下层次
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
        ctx.fill();
        ctx.shadowBlur = 0;

        // 水墨描边
        ctx.strokeStyle = 'rgba(60, 60, 60, 0.12)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // clip → 斑纹 + 鳞片
        ctx.clip();

        // 彩色斑纹
        for (var si2 = 0; si2 < b.spots.length; si2++) {
          var spot = b.spots[si2];
          var sj2 = joints[spot.jointIndex];
          var spAngle = sj2.angle + spot.offsetAngle;
          var spX = sj2.x + Math.cos(spAngle) * (b.size * spot.offsetDist);
          var spY = sj2.y + Math.sin(spAngle) * (b.size * spot.offsetDist);
          var sr = b.size * spot.radius;

          var spotGrad = ctx.createRadialGradient(spX, spY, sr * 0.1, spX, spY, sr);
          if (spot.color === 'red') {
            spotGrad.addColorStop(0, 'rgba(215, 35, 35, 0.9)');
            spotGrad.addColorStop(0.5, 'rgba(195, 25, 25, 0.75)');
            spotGrad.addColorStop(1, 'rgba(195, 25, 25, 0)');
          } else if (spot.color === 'black') {
            spotGrad.addColorStop(0, 'rgba(35, 35, 38, 0.95)');
            spotGrad.addColorStop(0.6, 'rgba(25, 25, 28, 0.75)');
            spotGrad.addColorStop(1, 'rgba(25, 25, 28, 0)');
          } else if (spot.color === 'yellow') {
            spotGrad.addColorStop(0, 'rgba(235, 165, 5, 0.95)');
            spotGrad.addColorStop(0.5, 'rgba(205, 135, 0, 0.75)');
            spotGrad.addColorStop(1, 'rgba(205, 135, 0, 0)');
          }

          ctx.fillStyle = spotGrad;
          ctx.beginPath();
          ctx.arc(spX, spY, sr, 0, Math.PI * 2);
          ctx.fill();
        }

        // 鳞片纹理暗示 (#10: 极淡弧线)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.025)';
        ctx.lineWidth = 0.4;
        for (var sci = 1; sci < joints.length - 2; sci++) {
          var scJ = joints[sci];
          for (var ss = -1; ss <= 1; ss += 2) {
            ctx.beginPath();
            ctx.arc(scJ.x, scJ.y, b.size * BODY_SCALES[sci] * 0.6,
              scJ.angle + Math.PI / 2 * ss - 0.3,
              scJ.angle + Math.PI / 2 * ss + 0.3);
            ctx.stroke();
          }
        }

        ctx.restore(); // 恢复 clip

        // —— h. 眼睛 + 触须 + 背鳍 (#5: 合并 save/restore) ——
        ctx.save();

        // ▸ 眼睛
        var eyeCos = Math.cos(joints[1].angle + EYE_ANGLE);
        var eyeSin = Math.sin(joints[1].angle + EYE_ANGLE);
        var eyeD = b.size * EYE_DIST;
        var lEyeX = joints[1].x + eyeCos * eyeD;
        var lEyeY = joints[1].y + eyeSin * eyeD;
        var rEyeX = joints[1].x - eyeCos * eyeD;
        var rEyeY = joints[1].y - eyeSin * eyeD;

        // 金色虹膜
        ctx.fillStyle = 'rgba(225, 155, 10, 0.9)';
        ctx.beginPath();
        ctx.arc(lEyeX, lEyeY, b.size * 0.10, 0, Math.PI * 2);
        ctx.arc(rEyeX, rEyeY, b.size * 0.10, 0, Math.PI * 2);
        ctx.fill();

        // 黑色瞳孔
        ctx.fillStyle = 'rgba(15, 15, 18, 0.98)';
        ctx.beginPath();
        ctx.arc(lEyeX, lEyeY, b.size * 0.07, 0, Math.PI * 2);
        ctx.arc(rEyeX, rEyeY, b.size * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // 瞳孔高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.beginPath();
        var hlOff = b.size * 0.025;
        ctx.arc(lEyeX - hlOff, lEyeY - hlOff, b.size * 0.025, 0, Math.PI * 2);
        ctx.arc(rEyeX - hlOff, rEyeY - hlOff, b.size * 0.025, 0, Math.PI * 2);
        ctx.fill();

        // ▸ 触须 (#13: 统一时间缩放)
        ctx.strokeStyle = 'rgba(60, 60, 60, 0.28)';
        ctx.lineWidth = 0.9;

        var mouthTipX = joints[0].x + Math.cos(joints[0].angle) * (b.size * 0.6);
        var mouthTipY = joints[0].y + Math.sin(joints[0].angle) * (b.size * 0.6);

        // 后侧主长须
        var wSway1 = Math.sin(timeSec * WHISKER_LONG_FREQ + b.wiggleOffset) * 0.15;
        var lWA1 = joints[0].angle + Math.PI / 3.1 + wSway1;
        var rWA1 = joints[0].angle - Math.PI / 3.1 - wSway1;
        var wLen1 = b.size * 0.95;

        ctx.beginPath();
        ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
        ctx.quadraticCurveTo(
          leftPoints[0].x + Math.cos(lWA1) * (wLen1 * 0.5),
          leftPoints[0].y + Math.sin(lWA1) * (wLen1 * 0.5),
          leftPoints[0].x + Math.cos(lWA1 + 0.15) * wLen1,
          leftPoints[0].y + Math.sin(lWA1 + 0.15) * wLen1
        );
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rightPoints[0].x, rightPoints[0].y);
        ctx.quadraticCurveTo(
          rightPoints[0].x + Math.cos(rWA1) * (wLen1 * 0.5),
          rightPoints[0].y + Math.sin(rWA1) * (wLen1 * 0.5),
          rightPoints[0].x + Math.cos(rWA1 - 0.15) * wLen1,
          rightPoints[0].y + Math.sin(rWA1 - 0.15) * wLen1
        );
        ctx.stroke();

        // 前侧副短须
        var wSway2 = Math.sin(timeSec * WHISKER_SHORT_FREQ + b.wiggleOffset) * 0.1;
        var lWA2 = joints[0].angle + Math.PI / 5.5 + wSway2;
        var rWA2 = joints[0].angle - Math.PI / 5.5 - wSway2;
        var wLen2 = b.size * 0.48;

        var snoutOW = b.size * 0.12;
        var snoutOCos = Math.cos(joints[0].angle + Math.PI / 2) * snoutOW;
        var snoutOSin = Math.sin(joints[0].angle + Math.PI / 2) * snoutOW;

        ctx.beginPath();
        ctx.moveTo(mouthTipX + snoutOCos, mouthTipY + snoutOSin);
        ctx.quadraticCurveTo(
          mouthTipX + Math.cos(lWA2) * (wLen2 * 0.5),
          mouthTipY + Math.sin(lWA2) * (wLen2 * 0.5),
          mouthTipX + Math.cos(lWA2 + 0.1) * wLen2,
          mouthTipY + Math.sin(lWA2 + 0.1) * wLen2
        );
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(mouthTipX - snoutOCos, mouthTipY - snoutOSin);
        ctx.quadraticCurveTo(
          mouthTipX + Math.cos(rWA2) * (wLen2 * 0.5),
          mouthTipY + Math.sin(rWA2) * (wLen2 * 0.5),
          mouthTipX + Math.cos(rWA2 - 0.1) * wLen2,
          mouthTipY + Math.sin(rWA2 - 0.1) * wLen2
        );
        ctx.stroke();

        // ▸ 背鳍 (置于最上层)
        ctx.beginPath();
        ctx.moveTo(joints[2].x, joints[2].y);
        for (var di = 3; di <= 5; di++) {
          var dj = joints[di];
          var dNormAngle = dj.angle + Math.PI / 2;
          var dOffset = Math.sin(b.swimPhase + di) * (b.size * 0.12);
          ctx.lineTo(dj.x + Math.cos(dNormAngle) * dOffset, dj.y + Math.sin(dNormAngle) * dOffset);
        }
        ctx.strokeStyle = b.colorPalette.spotsColor;
        ctx.lineWidth = b.size * 0.26;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.5;
        ctx.stroke();

        ctx.restore(); // 恢复 眼睛+触须+背鳍
      }
    },
    // 清理内存
    function (state) {
      state.initialized = false;
      state.fishes = null;
      state.inkParticles = null;
      state.ripples = null;
      state.caustics = null;
    }
  );
})();
