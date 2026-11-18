// ============================================================
// 云动雨斜 (Cloud Rain) — 全面优化版
// ============================================================
// 优化清单:
//  #3a 云 blob 预渲染 sprite (消除每帧 ~40 次 createRadialGradient)
//  #3b 雨丝分桶批量 stroke (消除每帧 ~200 次 createLinearGradient)
//  #4  辅助绘制函数提取到渲染循环外 (远山/单朵云/批量雨)
//  #11 魔法数字提取为语义常量
//  #12 调色板数据复用 (云/雨/山/雾/闪电色统一)
//  #13 时间缩放统一为秒
//  #14 新增三层远山剪影 (呼应"淡墨山岚"意境)
//  #15 新增山间流动雾气 (山若隐若现)
//  #16 雨的近/远层次增强 (空气透视)
//  #17 闪电照亮湿地反光
// ============================================================

(function () {
  'use strict';

  // ===== 常量定义 (#11) =====
  var WIND_PHASE_FREQ = 0.05;          // 风向相位推进速率 (Hz)
  var WIND_ANGLE_BASE = 0.28;          // 基础风向角 (rad ≈ 16°)
  var WIND_ANGLE_AMP1 = 0.06;          // 主摆幅
  var WIND_ANGLE_AMP2 = 0.03;          // 次摆幅
  var WIND_ANGLE_FREQ2 = 2.7;          // 次摆频率倍率

  var DROP_COUNT_DIV = 6;              // 雨滴密度系数 (w / DROP_COUNT_DIV)
  var DROP_COUNT_MIN = 60;
  var DROP_COUNT_MAX = 200;
  var DROP_SPEED_BASE = 300;           // 雨速下限
  var DROP_SPEED_RANGE = 300;          // 雨速深度增量
  var DROP_SPEED_JITTER = 100;         // 雨速随机抖动
  var DROP_LEN_BASE = 14;
  var DROP_LEN_DEPTH = 22;
  var DROP_LEN_JITTER = 10;
  var DROP_OPACITY_BASE = 0.12;
  var DROP_OPACITY_DEPTH = 0.2;
  var DROP_OPACITY_JITTER = 0.06;

  var RAIN_DEPTH_BUCKETS = 3;          // 雨丝分桶数 (#3b)
  var RAIN_NEAR_WIDTH = 1.5;           // 近景雨线宽 (#16 增强)
  var RAIN_FAR_WIDTH = 0.4;

  var SPLASH_CHANCE = 0.15;            // 雨滴落地溅起概率
  var SPLASH_OPACITY_BASE = 0.1;
  var SPLASH_OPACITY_RANGE = 0.08;
  var SPLASH_MAX_R_BASE = 4;
  var SPLASH_MAX_R_RANGE = 6;
  var SPLASH_SPEED_BASE = 16;
  var SPLASH_SPEED_RANGE = 10;
  var SPLASH_FADE = 0.18;

  var LIGHTNING_NEXT_MIN = 3000;       // 首次闪电最短延迟
  var LIGHTNING_NEXT_RANGE = 6000;
  var LIGHTNING_REPEAT_MIN = 4000;     // 重复闪电间隔
  var LIGHTNING_REPEAT_RANGE = 10000;
  var LIGHTNING_INTENSITY_BASE = 0.7;
  var LIGHTNING_INTENSITY_RANGE = 0.3;
  var LIGHTNING_FADE = 2.5;            // 闪电衰减速率
  var LIGHTNING_AMBIENT_ALPHA = 0.12;  // 环境闪光强度

  var MIST_START_Y = 0.84;             // 底部水雾起始位置比
  var MIST_END_Y = 1.0;

  // 三层云视差配置
  var CLOUD_LAYERS = [
    { count: 3, speedRange: [5, 10],  opacity: 0.06, yRange: [0.02, 0.26], sizeMul: 1.35 },
    { count: 3, speedRange: [10, 18], opacity: 0.09, yRange: [0.08, 0.38], sizeMul: 1.0 },
    { count: 2, speedRange: [18, 28], opacity: 0.11, yRange: [0.14, 0.46], sizeMul: 0.72 }
  ];

  // 远山三层配置 (#14)
  var MOUNTAIN_LAYERS = [
    { yRatio: 0.62, amp: 28,  freq: 1.3, seed: 1.7, color: 'mountainFar',  alpha: 0.10 },
    { yRatio: 0.70, amp: 38,  freq: 1.0, seed: 4.2, color: 'mountainMid',  alpha: 0.15 },
    { yRatio: 0.78, amp: 48,  freq: 0.8, seed: 7.9, color: 'mountainNear', alpha: 0.22 }
  ];

  // ===== 调色板 (#12) =====
  var palette = {
    cloudCool:  [192, 205, 220],
    cloudWarm:  [205, 198, 188],
    rain:       [175, 195, 215],
    rainBright: [210, 220, 240],   // 闪电高光色
    mountainFar:  [150, 160, 172],
    mountainMid:  [120, 132, 148],
    mountainNear: [88, 100, 116],
    mist:       [188, 200, 215],
    lightning:  [230, 235, 245],
    lightningGlow: [200, 215, 240]
  };

  // ===== 预渲染云 blob sprite (#3a) =====
  var cloudSprites = null;
  var CLOUD_SPRITE_SIZE = 128;

  function ensureCloudSprites() {
    if (cloudSprites) return;
    cloudSprites = { cool: null, warm: null };
    var keys = ['cool', 'warm'];
    var colors = { cool: palette.cloudCool, warm: palette.cloudWarm };
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var rgb = colors[key];
      var off = document.createElement('canvas');
      off.width = off.height = CLOUD_SPRITE_SIZE;
      var oc = off.getContext('2d');
      var cx = CLOUD_SPRITE_SIZE / 2;
      var g = oc.createRadialGradient(cx, cx, 0, cx, cx, cx);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)');
      g.addColorStop(0.3, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.6)');
      g.addColorStop(0.6, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.2)');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      oc.fillStyle = g;
      oc.fillRect(0, 0, CLOUD_SPRITE_SIZE, CLOUD_SPRITE_SIZE);
      cloudSprites[key] = off;
    }
  }

  // ===== 辅助绘制函数 (#4) =====

  // 单朵云：sprite 叠加绘制 (#3a)
  function drawCloud(ctx, cloud, timeSec, ltBoost) {
    var wobbleY = Math.sin(timeSec * cloud.wobbleFreq + cloud.wobblePhase) * 5;
    var breathe = 1 + Math.sin(timeSec * cloud.breatheFreq + cloud.breathePhase) * 0.12;
    var op = cloud.opacity * breathe + ltBoost;
    var sprite = cloudSprites[cloud.warm ? 'warm' : 'cool'];

    for (var bi = 0; bi < cloud.blobs.length; bi++) {
      var blob = cloud.blobs[bi];
      var sizeR = Math.max(blob.rx, blob.ry) * 2 * breathe;
      ctx.globalAlpha = op;
      ctx.drawImage(sprite, cloud.x + blob.ox - sizeR / 2, cloud.y + wobbleY + blob.oy - sizeR / 2, sizeR, sizeR);
    }
    ctx.globalAlpha = 1;
  }

  // 远山剪影：正弦+噪声生成柔和山脊 (#14)
  // 预生成山脊折线，存入 layer.points，渲染时只 fill
  function buildMountainLayer(layer, w, h) {
    var baseY = h * layer.yRatio;
    var step = 24;
    var pts = [];
    for (var x = 0; x <= w + step; x += step) {
      // 多频正弦叠加，制造柔和起伏
      var n =
        Math.sin(x * 0.004 * layer.freq + layer.seed) * layer.amp +
        Math.sin(x * 0.011 * layer.freq + layer.seed * 1.7) * layer.amp * 0.4 +
        Math.sin(x * 0.023 * layer.freq + layer.seed * 2.3) * layer.amp * 0.15;
      pts.push({ x: x, y: baseY - n });
    }
    return pts;
  }

  function drawMountainLayer(ctx, pts, w, h, rgb, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      // 用二次贝塞尔平滑山脊
      var mx = (pts[i - 1].x + pts[i].x) / 2;
      var my = (pts[i - 1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 山间流动雾气 (#15)：横向漂移雾带
  function drawMountainMist(ctx, w, h, timeSec) {
    var drift = (timeSec * 8) % w;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var rgb = palette.mist;
    for (var i = 0; i < 3; i++) {
      var bandY = h * (0.6 + i * 0.08);
      var bandH = 60 + i * 20;
      var phase = timeSec * 0.2 + i * 1.3;
      var alpha = 0.025 + Math.sin(phase) * 0.012;
      if (alpha < 0.005) continue;
      var x0 = (drift * (1 + i * 0.3)) % w;
      var g = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      g.addColorStop(0.5, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      ctx.fillStyle = g;
      // 横向无缝平铺：画两段覆盖漂移缝隙
      ctx.fillRect(-x0, bandY, w, bandH);
      ctx.fillRect(w - x0, bandY, w, bandH);
    }
    ctx.restore();
  }

  // ===== 主渲染注册 =====
  window.bloomRegister('cloudRain',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13
      var safeDt = Math.min(dt, 0.05);

      // === 初始化 ===
      if (!state.initialized) {
        ensureCloudSprites(); // #3a

        state.rainDensity = state.rainDensity || 6;
        state.rainSpeed = state.rainSpeed || 300;
        state.windAngle = state.windAngle !== undefined ? state.windAngle : 0.28;
        state.lightningEnabled = state.lightningEnabled !== undefined ? state.lightningEnabled : 1;

        // --- 三层云 ---
        state.clouds = [];
        for (var li = 0; li < CLOUD_LAYERS.length; li++) {
          var layer = CLOUD_LAYERS[li];
          for (var i = 0; i < layer.count; i++) {
            var bw = (240 + Math.random() * 260) * layer.sizeMul;
            var bh = (38 + Math.random() * 42) * layer.sizeMul;

            var blobCount = 4 + Math.floor(Math.random() * 4);
            var blobs = [];
            for (var b = 0; b < blobCount; b++) {
              blobs.push({
                ox: (Math.random() - 0.5) * bw * 0.6,
                oy: (Math.random() - 0.5) * bh * 0.5,
                rx: bw * (0.2 + Math.random() * 0.2),
                ry: bh * (0.35 + Math.random() * 0.3)
              });
            }

            state.clouds.push({
              x: Math.random() * (w + bw) - bw * 0.3,
              y: h * layer.yRange[0] + Math.random() * h * (layer.yRange[1] - layer.yRange[0]),
              speed: layer.speedRange[0] + Math.random() * (layer.speedRange[1] - layer.speedRange[0]),
              opacity: layer.opacity + Math.random() * 0.015,
              warm: Math.random() < 0.4,
              blobs: blobs,
              extent: bw * 0.7,
              wobbleFreq: 0.07 + Math.random() * 0.05,
              wobblePhase: Math.random() * Math.PI * 2,
              breatheFreq: 0.1 + Math.random() * 0.06,
              breathePhase: Math.random() * Math.PI * 2
            });
          }
        }

        // --- 雨滴 ---
        state.raindrops = [];
        var dropCount = Math.min(DROP_COUNT_MAX, Math.max(DROP_COUNT_MIN, Math.floor(w / state.rainDensity)));
        for (var d = 0; d < dropCount; d++) {
          var depth = Math.random();
          state.raindrops.push({
            x: Math.random() * (w + 300) - 150,
            y: Math.random() * h * 1.2 - h * 0.2,
            speed: state.rainSpeed + depth * DROP_SPEED_RANGE + Math.random() * DROP_SPEED_JITTER,
            length: DROP_LEN_BASE + depth * DROP_LEN_DEPTH + Math.random() * DROP_LEN_JITTER,
            opacity: DROP_OPACITY_BASE + depth * DROP_OPACITY_DEPTH + Math.random() * DROP_OPACITY_JITTER,
            depth: depth
          });
        }

        // --- 远山预生成折线 (#14) ---
        state.mountains = [];
        for (var mi = 0; mi < MOUNTAIN_LAYERS.length; mi++) {
          var ml = MOUNTAIN_LAYERS[mi];
          state.mountains.push(buildMountainLayer(ml, w, h));
        }
        state._mountainW = w; // 记录宽度用于 resize 检测

        // --- 其它 ---
        state.splashes = [];
        state.lightning = {
          active: false,
          intensity: 0,
          nextTime: time + LIGHTNING_NEXT_MIN + Math.random() * LIGHTNING_NEXT_RANGE,
          bolt: null
        };
        state.windPhase = 0;

        state.initialized = true;
      }

      // 窗口尺寸变化时重建远山
      if (state._mountainW !== w) {
        state.mountains = [];
        for (var ri = 0; ri < MOUNTAIN_LAYERS.length; ri++) {
          state.mountains.push(buildMountainLayer(MOUNTAIN_LAYERS[ri], w, h));
        }
        state._mountainW = w;
      }

      // === 风向 (#11) ===
      state.windPhase += safeDt * WIND_PHASE_FREQ;
      var windAngle = state.windAngle +
        Math.sin(state.windPhase) * WIND_ANGLE_AMP1 +
        Math.sin(state.windPhase * WIND_ANGLE_FREQ2) * WIND_ANGLE_AMP2;
      var sinW = Math.sin(windAngle);
      var cosW = Math.cos(windAngle);

      // === 闪电 ===
      var lt = state.lightning;
      if (state.lightningEnabled && !lt.active && time > lt.nextTime) {
        lt.active = true;
        lt.intensity = LIGHTNING_INTENSITY_BASE + Math.random() * LIGHTNING_INTENSITY_RANGE;

        var startX = w * (0.15 + Math.random() * 0.7);
        var segments = [];
        var bx = startX, by = 0;
        var endY = h * (0.3 + Math.random() * 0.4);
        var steps = 8 + Math.floor(Math.random() * 6);
        var stepY = endY / steps;

        for (var s = 0; s <= steps; s++) {
          segments.push({ x: bx, y: by });
          bx += (Math.random() - 0.5) * 60;
          by += stepY;
        }

        var branchIdx = 2 + Math.floor(Math.random() * (steps - 3));
        var branch = [];
        var brx = segments[branchIdx].x, bry = segments[branchIdx].y;
        var branchSteps = 3 + Math.floor(Math.random() * 3);
        var branchDir = Math.random() < 0.5 ? -1 : 1;
        for (var sb = 0; sb <= branchSteps; sb++) {
          branch.push({ x: brx, y: bry });
          brx += branchDir * (15 + Math.random() * 25);
          bry += stepY * 0.7;
        }

        lt.bolt = { segments: segments, branch: branch };
        lt.nextTime = time + LIGHTNING_REPEAT_MIN + Math.random() * LIGHTNING_REPEAT_RANGE;
      }

      if (lt.active) {
        lt.intensity -= dt * LIGHTNING_FADE;
        if (lt.intensity <= 0) {
          lt.active = false;
          lt.intensity = 0;
          lt.bolt = null;
        }
      }

      // === 远山剪影 (#14) ===
      for (var mi2 = 0; mi2 < MOUNTAIN_LAYERS.length; mi2++) {
        var ml2 = MOUNTAIN_LAYERS[mi2];
        var ltBoostMountain = (lt.active && lt.intensity > 0.2) ? lt.intensity * 0.05 : 0;
        drawMountainLayer(ctx, state.mountains[mi2], w, h, palette[ml2.color], ml2.alpha + ltBoostMountain);
      }

      // === 山间流动雾气 (#15) ===
      drawMountainMist(ctx, w, h, timeSec);

      // === 云 (sprite 绘制 #3a) ===
      var ltBoostCloud = (lt.active && lt.intensity > 0.2) ? lt.intensity * 0.08 : 0;
      for (var ci = 0; ci < state.clouds.length; ci++) {
        var cloud = state.clouds[ci];
        cloud.x += cloud.speed * safeDt;
        if (cloud.x - cloud.extent > w) cloud.x = -cloud.extent;
        drawCloud(ctx, cloud, timeSec, ltBoostCloud);
      }

      // === 闪电环境闪光 + 电弧 ===
      if (lt.active && lt.intensity > 0) {
        // 环境闪光
        ctx.fillStyle = 'rgba(210, 220, 235, ' + (lt.intensity * LIGHTNING_AMBIENT_ALPHA) + ')';
        ctx.fillRect(0, 0, w, h);

        if (lt.bolt && lt.intensity > 0.15) {
          var boltAlpha = Math.min(1, lt.intensity * 1.2);
          var seg0 = lt.bolt.segments[0];

          // 外发光
          ctx.strokeStyle = 'rgba(' + palette.lightningGlow.join(',') + ',' + (boltAlpha * 0.3) + ')';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(seg0.x, seg0.y);
          for (var si1 = 1; si1 < lt.bolt.segments.length; si1++) ctx.lineTo(lt.bolt.segments[si1].x, lt.bolt.segments[si1].y);
          ctx.stroke();

          // 分支发光
          ctx.strokeStyle = 'rgba(' + palette.lightningGlow.join(',') + ',' + (boltAlpha * 0.2) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(lt.bolt.branch[0].x, lt.bolt.branch[0].y);
          for (var si2 = 1; si2 < lt.bolt.branch.length; si2++) ctx.lineTo(lt.bolt.branch[si2].x, lt.bolt.branch[si2].y);
          ctx.stroke();

          // 主线核心
          ctx.strokeStyle = 'rgba(' + palette.lightning.join(',') + ',' + (boltAlpha * 0.8) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(seg0.x, seg0.y);
          for (var si3 = 1; si3 < lt.bolt.segments.length; si3++) ctx.lineTo(lt.bolt.segments[si3].x, lt.bolt.segments[si3].y);
          ctx.stroke();

          // 分支核心
          ctx.strokeStyle = 'rgba(' + palette.lightning.join(',') + ',' + (boltAlpha * 0.6) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(lt.bolt.branch[0].x, lt.bolt.branch[0].y);
          for (var si4 = 1; si4 < lt.bolt.branch.length; si4++) ctx.lineTo(lt.bolt.branch[si4].x, lt.bolt.branch[si4].y);
          ctx.stroke();
        }
      }

      // === 雨丝：分桶批量 stroke (#3b + #16) ===
      // 先更新位置 & 生成 splash，按 depth 分到 3 个桶
      var buckets = state._rainBuckets || (state._rainBuckets = [[], [], []]);
      buckets[0].length = 0; buckets[1].length = 0; buckets[2].length = 0;

      for (var di = 0; di < state.raindrops.length; di++) {
        var drop = state.raindrops[di];
        drop.y += drop.speed * cosW * safeDt;
        drop.x += drop.speed * sinW * safeDt;

        // 落地溅起
        if (drop.y > h - 5 && Math.random() < SPLASH_CHANCE) {
          state.splashes.push({
            x: drop.x,
            y: h - 2 + Math.random() * 3,
            radius: 1,
            maxRadius: SPLASH_MAX_R_BASE + Math.random() * SPLASH_MAX_R_RANGE,
            opacity: SPLASH_OPACITY_BASE + Math.random() * SPLASH_OPACITY_RANGE,
            speed: SPLASH_SPEED_BASE + Math.random() * SPLASH_SPEED_RANGE
          });
        }

        // 回收
        if (drop.y > h + drop.length + 20) {
          drop.y = -drop.length - Math.random() * 50;
          drop.x = Math.random() * (w + 300) - 150;
        }
        if (drop.x > w + 150) {
          drop.x = -150;
          drop.y = Math.random() * h;
        }

        // 分桶（depth 0~1 → 0,1,2）
        var bi2 = drop.depth < 0.33 ? 0 : (drop.depth < 0.66 ? 1 : 2);
        buckets[bi2].push(drop);
      }

      // 逐桶批量 stroke：每桶一个 lineWidth + 单色，合并到一条 Path
      var rgbRain = palette.rain;
      for (var bk = 0; bk < RAIN_DEPTH_BUCKETS; bk++) {
        var bucket = buckets[bk];
        if (bucket.length === 0) continue;
        // 桶属性：depth 越大越近 → 线越粗、越亮 (#16)
        var tDepth = bk / (RAIN_DEPTH_BUCKETS - 1); // 0=远, 1=近
        var lineWidth = RAIN_FAR_WIDTH + (RAIN_NEAR_WIDTH - RAIN_FAR_WIDTH) * tDepth;
        // 桶内取平均 opacity 作为统一色（近似，避免每滴设色）
        var avgOp = 0;
        for (var ao = 0; ao < bucket.length; ao++) avgOp += bucket[ao].opacity;
        avgOp /= bucket.length;

        ctx.strokeStyle = 'rgba(' + rgbRain[0] + ',' + rgbRain[1] + ',' + rgbRain[2] + ',' + avgOp.toFixed(3) + ')';
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (var bi3 = 0; bi3 < bucket.length; bi3++) {
          var dr = bucket[bi3];
          var tailX = dr.x - sinW * dr.length;
          var tailY = dr.y - cosW * dr.length;
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(dr.x, dr.y);
        }
        ctx.stroke();

        // 闪电时近景雨高亮 (#17 合并)
        if (lt.active && lt.intensity > 0.3 && bk === RAIN_DEPTH_BUCKETS - 1) {
          ctx.strokeStyle = 'rgba(' + palette.rainBright.join(',') + ',' + (lt.intensity * 0.15).toFixed(3) + ')';
          ctx.lineWidth = lineWidth + 0.4;
          ctx.beginPath();
          for (var bi4 = 0; bi4 < bucket.length; bi4++) {
            var dr2 = bucket[bi4];
            var tx2 = dr2.x - sinW * dr2.length;
            var ty2 = dr2.y - cosW * dr2.length;
            ctx.moveTo(tx2, ty2);
            ctx.lineTo(dr2.x, dr2.y);
          }
          ctx.stroke();
        }
      }

      // === 溅起水花 (swap-and-pop) ===
      for (var si5 = state.splashes.length - 1; si5 >= 0; si5--) {
        var sp = state.splashes[si5];
        sp.radius += sp.speed * safeDt;
        sp.opacity -= SPLASH_FADE * safeDt;

        if (sp.opacity <= 0 || sp.radius > sp.maxRadius) {
          var last = state.splashes.length - 1;
          if (si5 !== last) state.splashes[si5] = state.splashes[last];
          state.splashes.pop();
          continue;
        }

        ctx.strokeStyle = 'rgba(' + rgbRain.join(',') + ',' + sp.opacity.toFixed(3) + ')';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.radius, Math.PI + 0.3, Math.PI * 2 - 0.3);
        ctx.stroke();
      }

      // === 底部水雾 (#17 闪电照亮) ===
      var mistBoost = (lt.active) ? lt.intensity * 0.06 : 0;
      var mistRgb = palette.mist;
      var mistGrad = ctx.createLinearGradient(0, h * MIST_START_Y, 0, h * MIST_END_Y);
      mistGrad.addColorStop(0, 'rgba(' + mistRgb.join(',') + ',0)');
      mistGrad.addColorStop(0.5, 'rgba(' + mistRgb.join(',') + ',' + (0.02 + mistBoost).toFixed(3) + ')');
      mistGrad.addColorStop(1, 'rgba(' + mistRgb.join(',') + ',' + (0.04 + mistBoost).toFixed(3) + ')');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, h * MIST_START_Y, w, h * (MIST_END_Y - MIST_START_Y));
    },
    function (state) {
      state.initialized = false;
      state.clouds = null;
      state.raindrops = null;
      state.splashes = null;
      state.lightning = null;
      state.mountains = null;
      state._rainBuckets = null;
    }
  );
})();
