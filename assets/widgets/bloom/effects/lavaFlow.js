// ============================================================
// 熔岩流 (Lava Flow) — 黏稠蜡团融合美学
// ============================================================
// 原理：多个炽热蜡团缓慢升降、漂移，每个蜡团用熔岩色阶径向梯度
//       （白热核→橙→暗红→透明）绘制，lighter 混合叠加实现 metaball
//       式融合。透明背景，不遮挡用户工作画面。
//
// 优化点:
//  #4  蜡团粒子更新与绘制分离
//  #11 魔法数字提取为常量
//  #13 时间统一为秒
//  #14 蜡团冷热周期：温度随正弦升降，影响亮度与半径（模拟对流）
// ============================================================

(function () {
  'use strict';

  // ===== 常量 (#11) =====
  var BLOB_COUNT = 9;                 // 蜡团数量
  var BLOB_R_MIN = 40;
  var BLOB_R_MAX = 90;
  var FLOAT_SPEED_MIN = 8;            // 升降速度
  var FLOAT_SPEED_MAX = 20;
  var DRIFT_SPEED = 6;                // 横向漂移
  var TEMP_FREQ_MIN = 0.08;           // 温度脉动频率
  var TEMP_FREQ_MAX = 0.18;
  var HEAT_ALPHA = 0.55;              // 单团热度叠加强度（screen 模式，避免亮桌面过曝）

  // 将 rgb 按指定度数旋转色相（用于 hueShift 配置；hueShift=0 时保持原色不变）
  function shiftHue(rgb, deg) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h, s;
    if (max === min) { h = 0; s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (((h * 360) + deg) % 360 + 360) % 360 / 360;
    var r2, g2, b2;
    if (s === 0) { r2 = g2 = b2 = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      r2 = hue2rgb(p, q, h + 1 / 3);
      g2 = hue2rgb(p, q, h);
      b2 = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r2 * 255), Math.round(g2 * 255), Math.round(b2 * 255)];
  }

  // ===== 主渲染 =====
  window.bloomRegister('lavaFlow',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13
      var safeDt = Math.min(dt, 0.05);

      if (!state.initialized) {
        // 读取配置参数（无配置时走默认值，行为与原版一致）
        state.blobCount = state.blobCount || BLOB_COUNT;
        state.blobSize = state.blobSize || 65;
        state.heatIntensity = state.heatIntensity || HEAT_ALPHA;
        state.hueShift = state.hueShift || 0;

        var rMin = state.blobSize - 25;
        var rMax = state.blobSize + 25;

        // 蜡团（直接在主 canvas 绘制，无需离屏场）
        state.blobs = [];
        for (var i = 0; i < state.blobCount; i++) {
          state.blobs.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * DRIFT_SPEED,
            vy: -(FLOAT_SPEED_MIN + Math.random() * (FLOAT_SPEED_MAX - FLOAT_SPEED_MIN)),
            r: (rMin + Math.random() * (rMax - rMin)),
            tempPhase: Math.random() * Math.PI * 2,
            tempFreq: TEMP_FREQ_MIN + Math.random() * (TEMP_FREQ_MAX - TEMP_FREQ_MIN)
          });
        }

        // 色阶梯度：按 hueShift 旋转色相（0=默认熔岩橙红，与原版完全一致）
        var baseStops = [[255, 235, 160], [255, 150, 30], [210, 55, 15], [90, 12, 10]];
        var hs = state.hueShift;
        state.lavaStops = hs === 0 ? baseStops : baseStops.map(function (c) { return shiftHue(c, hs); });

        state.initialized = true;
      }

      // 无全屏底色：保持 overlay 透明，蜡团亮度场直接叠加其上
      // （原全屏暗渐变底会完全遮挡桌面，违背透明 overlay 设计）

      // === 2. 蜡团绘制：逐团熔岩色阶径向梯度 + lighter 叠加融合 ===
      // 直接在主 canvas 上画（团数少，无需离屏场）。
      // screen 叠加 → 相邻蜡团亮度自然融合（metaball 效果），
      // 比 lighter 克制，避免在亮桌面（白底文档）上过曝成白斑。
      ctx.globalCompositeOperation = 'screen';

      for (var i = 0; i < state.blobs.length; i++) {
        var b = state.blobs[i];
        // 温度：0~1 周期变化，影响半径与亮度（对流胀缩）
        var temp = 0.5 + 0.5 * Math.sin(timeSec * b.tempFreq + b.tempPhase);
        var r = b.r * (0.75 + temp * 0.5);
        var alpha = state.heatIntensity * (0.6 + temp * 0.4);

        // 更新位置
        b.x += b.vx * safeDt;
        b.y += b.vy * safeDt;
        // 上下循环（熔岩灯：到顶从底重生）
        if (b.y < -r) { b.y = h + r; b.x = Math.random() * w; }
        if (b.y > h + r) { b.y = -r; b.x = Math.random() * w; }
        if (b.x < -r) b.x = w + r;
        if (b.x > w + r) b.x = -r;

        // 熔岩色阶径向梯度：白热核 → 橙黄 → 橙红 → 暗红 → 透明
        var ls = state.lavaStops;
        var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g.addColorStop(0, 'rgba(' + ls[0][0] + ',' + ls[0][1] + ',' + ls[0][2] + ',' + alpha + ')');
        g.addColorStop(0.35, 'rgba(' + ls[1][0] + ',' + ls[1][1] + ',' + ls[1][2] + ',' + (alpha * 0.7) + ')');
        g.addColorStop(0.65, 'rgba(' + ls[2][0] + ',' + ls[2][1] + ',' + ls[2][2] + ',' + (alpha * 0.4) + ')');
        g.addColorStop(1, 'rgba(' + ls[3][0] + ',' + ls[3][1] + ',' + ls[3][2] + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    function (state) {
      state.initialized = false;
      state.blobs = null;
    }
  );
})();
