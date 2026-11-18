// ============================================================
// 万华镜 (Kaleidoscope) — 动态对称几何
// ============================================================
// 原理：离屏 canvas 绘制一个"动态源"（流动的彩色团块+光带），
//       再通过 rotate + scale(-1,1) 镜像，切成 N 段扇形拼成圆，
//       形成永不重复的曼陀罗图案。
//
// 优化点:
//  #3  动态源在离屏 canvas 绘制（小尺寸，开销低）
//  #4  扇形镜像绘制用 ctx 变换矩阵，复用同一段源图
//  #11 魔法数字提取为常量
//  #12 调色板复用（色相缓慢流转）
//  #13 时间统一为秒
//  #14 N 段数可配置，整体缓慢旋转 + 呼吸缩放
// ============================================================

(function () {
  'use strict';

  // ===== 常量 (#11) =====
  var SEGMENTS = 8;                  // 对称段数（偶数，便于镜像）
  var SLICE_ANGLE = (Math.PI * 2) / SEGMENTS;
  var SOURCE_SIZE = 256;             // 离屏源 canvas 尺寸（正方形）
  var SOURCE_BLOBS = 5;              // 动态源彩色团块数
  var SOURCE_RIBBONS = 3;            // 动态源光带数
  var ROTATE_SPEED = 0.015;          // 降低旋转速度 (rad/s)，避免视觉晃眼
  var BREATHE_FREQ = 0.08;           // 呼吸频率减半
  var BREATHE_AMP = 0.02;            // 降低呼吸幅度，减弱动态扩张感
  var HUE_SHIFT_SPEED = 3;           // 减慢色相转变，使其温和渐变
  var TRAIL_ALPHA = 0.06;            // 源画面拖尾（残影）系数
  var RADIUS_RATIO = 0.28;           // 曼陀罗半径占短边比例从 0.36 缩小到 0.28，减小屏幕占用，避开主工作区

  // ===== 动态源：离屏 canvas 绘制 =====
  // 用闭包持有离屏 ctx，避免每帧创建
  var srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcCanvas.height = SOURCE_SIZE;
  var srcCtx = srcCanvas.getContext('2d');

  function initSource(state) {
    state.blobs = [];
    for (var i = 0; i < SOURCE_BLOBS; i++) {
      state.blobs.push({
        x: Math.random() * SOURCE_SIZE,
        y: Math.random() * SOURCE_SIZE,
        vx: (Math.random() - 0.5) * 12, // 减慢内部粒子的漂移速度
        vy: (Math.random() - 0.5) * 12,
        r: 30 + Math.random() * 50,
        hue: Math.random() * 360,
        hueDrift: (Math.random() - 0.5) * 20
      });
    }
    state.ribbons = [];
    for (var ri = 0; ri < SOURCE_RIBBONS; ri++) {
      state.ribbons.push({
        phase: Math.random() * Math.PI * 2,
        freq: 0.3 + Math.random() * 0.4,
        hue: Math.random() * 360,
        y: Math.random() * SOURCE_SIZE,
        amp: 20 + Math.random() * 40
      });
    }
    // 清空源画面
    srcCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    state.hueShift = 0;
  }

  // 更新并绘制动态源到离屏 canvas
  function updateSource(state, timeSec, safeDt) {
    // 残影淡出：用 destination-out 擦除少量 alpha（保持透明背景，
    // 不能用黑色 source-over，否则源图会积累成不透明黑底）
    srcCtx.globalCompositeOperation = 'destination-out';
    srcCtx.fillStyle = 'rgba(0,0,0,' + TRAIL_ALPHA + ')';
    srcCtx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    srcCtx.globalCompositeOperation = 'source-over';

    state.hueShift = (state.hueShift + state.hueShiftSpeed * safeDt) % 360;

    // 团块（screen 混合，越叠越亮）
    srcCtx.globalCompositeOperation = 'screen';
    for (var i = 0; i < state.blobs.length; i++) {
      var b = state.blobs[i];
      b.x += b.vx * safeDt;
      b.y += b.vy * safeDt;
      // 边界反弹
      if (b.x < 0 || b.x > SOURCE_SIZE) b.vx *= -1;
      if (b.y < 0 || b.y > SOURCE_SIZE) b.vy *= -1;
      b.x = Math.max(0, Math.min(SOURCE_SIZE, b.x));
      b.y = Math.max(0, Math.min(SOURCE_SIZE, b.y));

      var hue = (b.hue + state.hueShift) % 360;
      var g = srcCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      // 提升色彩饱和度，加深中等亮度，保证在深色/浅色背景下都有充足的色彩饱和度与辨识度
      g.addColorStop(0, 'hsla(' + hue + ',100%,68%,0.95)');
      g.addColorStop(0.3, 'hsla(' + hue + ',95%,55%,0.6)');
      g.addColorStop(0.7, 'hsla(' + hue + ',90%,45%,0.2)');
      g.addColorStop(1, 'hsla(' + hue + ',85%,35%,0)');
      srcCtx.fillStyle = g;
      srcCtx.beginPath();
      srcCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      srcCtx.fill();
    }

    // 光带（正弦曲线）
    for (var r2 = 0; r2 < state.ribbons.length; r2++) {
      var rb = state.ribbons[r2];
      var hue2 = (rb.hue + state.hueShift) % 360;
      // 增强光带的亮度和宽度，提升几何线段的清晰度
      srcCtx.strokeStyle = 'hsla(' + hue2 + ',100%,60%,0.7)';
      srcCtx.lineWidth = 3 + Math.sin(timeSec * rb.freq + rb.phase) * 1.8;
      srcCtx.beginPath();
      for (var x = 0; x <= SOURCE_SIZE; x += 6) {
        var y = rb.y + Math.sin(x * 0.03 + timeSec * rb.freq + rb.phase) * rb.amp;
        if (x === 0) srcCtx.moveTo(x, y);
        else srcCtx.lineTo(x, y);
      }
      srcCtx.stroke();
    }
    srcCtx.globalCompositeOperation = 'source-over';
  }

  // ===== 主渲染 =====
  window.bloomRegister('kaleido',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13
      var safeDt = Math.min(dt, 0.05);

      if (!state.initialized) {
        // 读取配置参数（无配置时走默认值，行为与原版一致）
        state.segments = state.segments || SEGMENTS;
        state.sliceAngle = (Math.PI * 2) / state.segments;
        state.radius = state.radius || RADIUS_RATIO;
        state.rotateSpeed = state.rotateSpeed !== undefined ? state.rotateSpeed : ROTATE_SPEED;
        state.hueShiftSpeed = state.hueShiftSpeed !== undefined ? state.hueShiftSpeed : HUE_SHIFT_SPEED;

        initSource(state);
        state.rotation = 0;
        state.initialized = true;
      }

      // 1. 更新动态源
      updateSource(state, timeSec, safeDt);
      state.rotation += state.rotateSpeed * safeDt;

      // 2. 对称镜像绘制（中心圆盘，screen 发光模式：深色背景加亮醒目，
      //    浅色背景自然融合不遮挡，两头都能看清）
      var cx = w / 2;
      var cy = h / 2;
      var radius = Math.min(w, h) * state.radius;
      var breathe = 1 + Math.sin(timeSec * BREATHE_FREQ) * BREATHE_AMP;

      // 底光晕：曼陀罗整体一圈柔和发光，保证在任何背景下都有"光感"
      ctx.save();
      
      // 整体半透明度设置（重点优化）：将整体不透明度设为 0.38，使特效呈现为半透明“水印级”视觉效果，
      // 避免干扰文字阅读和用户操作注意力
      ctx.globalAlpha = 0.38;

      // 1. 绘制暗色背板光晕（调低对比度与不透明度，减弱黑晕干扰）
      ctx.globalCompositeOperation = 'source-over';
      var baseGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.15);
      baseGlow.addColorStop(0, 'rgba(10, 6, 20, 0.18)');
      baseGlow.addColorStop(0.6, 'rgba(8, 5, 15, 0.10)');
      baseGlow.addColorStop(0.9, 'rgba(5, 4, 10, 0.03)');
      baseGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = baseGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // 2. 扇形对称绘制（使用 source-over 混合模式，确保在任何背景下色彩饱满清晰）
      ctx.globalCompositeOperation = 'source-over';

      // 弱化投影（阴影不透明度从 0.45 降至 0.22，模糊度降为 12），减少线条的沉重感，更加轻盈
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(state.rotation);
      ctx.scale(breathe, breathe);

      // 绘制 SEGMENTS 段：奇数段正常，偶数段水平镜像，拼出无缝对称
      for (var i = 0; i < state.segments; i++) {
        ctx.save();
        ctx.rotate(i * state.sliceAngle);
        if (i % 2 === 1) ctx.scale(1, -1); // 镜像翻转，保证相邻段连续

        // 用 clip 限制到当前扇形区域
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, 0, state.sliceAngle);
        ctx.closePath();
        ctx.clip();

        // 修复 bug：源图应在扇形所在象限绘制 (0, 0)，原代码绘制于 (0, -radius) 导致与 clip 区域不重叠而被完全遮挡
        ctx.drawImage(srcCanvas, 0, 0, radius, radius);

        ctx.restore();
      }

      ctx.restore();

      // 重置阴影设置，避免影响后续绘制
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // 3. 中心暖光高亮（适度增加中心局部对比度，使视觉焦点内收）
      ctx.globalAlpha = 0.50; // 中心高亮稍明显一点点
      ctx.globalCompositeOperation = 'source-over';
      var centerR = radius * 0.12;
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerR);
      cg.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      cg.addColorStop(0.3, 'rgba(255, 250, 230, 0.5)');
      cg.addColorStop(1, 'rgba(255, 250, 230, 0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore(); // 完美恢复 Canvas 初始的 globalAlpha, shadowColor 等，不会残留对其他特效的干扰
    },
    function (state) {
      state.initialized = false;
      state.blobs = null;
      state.ribbons = null;
    }
  );
})();
