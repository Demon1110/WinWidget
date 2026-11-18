// ============================================================
// 流光丝带 (Ribbon) — 柔顺飘逸的发光丝带
// ============================================================
// 原理：多条丝带沿正弦曲线飘动，每条用"中轴线 + 法线偏移厚度"
//       构建有实体厚度的带状 path 填充，配 screen 混合发光与
//       色相缓慢流转，呈现彩带舞/丝绸般的飘逸质感。
//
// 优化点:
//  #4  丝带 path 构建与绘制提取为辅助函数
//  #11 魔法数字提取为常量
//  #12 调色板复用（多色相丝带）
//  #13 时间统一为秒
//  #14 中轴线多频正弦叠加（自然飘动）；厚度沿长度渐变（两端尖）
//  #16 多层深度：远丝带细而暗、近丝带宽而亮
// ============================================================

(function () {
  'use strict';

  // ===== 常量 (#11) =====
  var RIBBON_COUNT = 5;               // 丝带数量
  var SEGMENTS = 48;                  // 丝带分段数（平滑度）
  var AMP_MIN = 60;                   // 飘动幅度
  var AMP_MAX = 140;
  var FREQ_MIN = 0.6;                 // 飘动频率
  var FREQ_MAX = 1.4;
  var DRIFT_SPEED_MIN = 8;            // 横向漂移速度
  var DRIFT_SPEED_MAX = 22;
  var THICKNESS_MIN = 14;             // 丝带厚度
  var THICKNESS_MAX = 38;
  var HUE_SHIFT_SPEED = 8;            // 色相流转速度 (度/s)
  var GLOW_WIDTH = 3;                 // 发光描边倍数

  // 色相起始值（每条丝带一个基准色相，再随时间整体流转）
  var HUE_BASES = [340, 200, 280, 30, 160]; // 粉/蓝/紫/橙/青

  // ===== 主渲染 =====
  window.bloomRegister('ribbon',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13
      var safeDt = Math.min(dt, 0.05);

      if (!state.initialized) {
        state.ribbonCount = state.ribbonCount || 5;
        state.hueShiftSpeed = state.hueShiftSpeed !== undefined ? state.hueShiftSpeed : 8;
        state.thickness = state.thickness || 14;
        state.amplitude = state.amplitude || 100;

        var ampMin = state.amplitude - 40;
        var ampMax = state.amplitude + 40;
        var thicknessMin = state.thickness;
        var thicknessMax = state.thickness + 24;

        state.ribbons = [];
        for (var i = 0; i < state.ribbonCount; i++) {
          var depth = i / (state.ribbonCount - 1); // 0=远, 1=近
          state.ribbons.push({
            yBase: h * (0.2 + Math.random() * 0.6),
            amp: ampMin + Math.random() * (ampMax - ampMin),
            freq: FREQ_MIN + Math.random() * (FREQ_MAX - FREQ_MIN),
            freq2: FREQ_MIN * 1.8 + Math.random() * 0.8,
            phase: Math.random() * Math.PI * 2,
            phase2: Math.random() * Math.PI * 2,
            drift: (DRIFT_SPEED_MIN + Math.random() * (DRIFT_SPEED_MAX - DRIFT_SPEED_MIN)),
            thickness: (thicknessMin + depth * (thicknessMax - thicknessMin)),
            hueBase: HUE_BASES[i % HUE_BASES.length],
            depth: depth,
            offset: Math.random() * 1000 // 横向相位偏移
          });
        }
        state.hueShift = 0;
        state.initialized = true;
      }

      // 无全屏底色：保持 overlay 透明，丝带用 screen 发光混合直接叠加
      // （原 rgb(6,4,14) 全屏深色底会完全遮挡桌面）

      state.hueShift = (state.hueShift + state.hueShiftSpeed * safeDt) % 360;

      // === 2. 远→近依次绘制丝带 (screen 发光叠加) ===
      ctx.globalCompositeOperation = 'screen';

      for (var ri = 0; ri < state.ribbons.length; ri++) {
        var rb = state.ribbons[ri];
        var hue = (rb.hueBase + state.hueShift) % 360;
        var t = timeSec;
        var driftOff = rb.offset + t * rb.drift;

        // 构建中轴线点 + 法线点（厚度沿长度两端尖、中间宽）
        // left/right 为带状 path 的两条边
        var midX = [];
        var midY = [];
        var thickArr = [];
        for (var s = 0; s <= SEGMENTS; s++) {
          var u = s / SEGMENTS;
          var px = u * w * 1.3 - w * 0.15; // 略宽于屏幕，飘出感
          // 多频正弦叠加：主波 + 次波
          var wave = Math.sin(px * 0.005 * rb.freq + t * rb.freq + rb.phase) * rb.amp;
          wave += Math.sin(px * 0.012 * rb.freq2 + t * rb.freq2 * 0.7 + rb.phase2) * rb.amp * 0.35;
          var py = rb.yBase + wave;

          // 厚度：中间宽两端尖（正弦包络）
          var env = Math.sin(u * Math.PI); // 0→1→0
          var tk = rb.thickness * (0.3 + env * 0.7);

          midX.push(px);
          midY.push(py);
          thickArr.push(tk);
        }

        // 绘制带状 path：上边正序 + 下边倒序
        ctx.beginPath();
        // 上边（法线负方向）
        for (var s1 = 0; s1 <= SEGMENTS; s1++) {
          // 法线方向用相邻点差分近似
          var nx1, ny1;
          if (s1 < SEGMENTS) {
            nx1 = midX[s1 + 1] - midX[s1];
            ny1 = midY[s1 + 1] - midY[s1];
          } else {
            nx1 = midX[s1] - midX[s1 - 1];
            ny1 = midY[s1] - midY[s1 - 1];
          }
          var len1 = Math.sqrt(nx1 * nx1 + ny1 * ny1) || 1;
          nx1 /= len1; ny1 /= len1;
          // 法线 = 切线旋转 90°
          var ox1 = -ny1 * thickArr[s1] * 0.5;
          var oy1 = nx1 * thickArr[s1] * 0.5;
          if (s1 === 0) ctx.moveTo(midX[s1] + ox1, midY[s1] + oy1);
          else ctx.lineTo(midX[s1] + ox1, midY[s1] + oy1);
        }
        // 下边（法线正方向，倒序）
        for (var s2 = SEGMENTS; s2 >= 0; s2--) {
          var nx2, ny2;
          if (s2 < SEGMENTS) {
            nx2 = midX[s2 + 1] - midX[s2];
            ny2 = midY[s2 + 1] - midY[s2];
          } else {
            nx2 = midX[s2] - midX[s2 - 1];
            ny2 = midY[s2] - midY[s2 - 1];
          }
          var len2 = Math.sqrt(nx2 * nx2 + ny2 * ny2) || 1;
          nx2 /= len2; ny2 /= len2;
          var ox2 = ny2 * thickArr[s2] * 0.5;
          var oy2 = -nx2 * thickArr[s2] * 0.5;
          ctx.lineTo(midX[s2] + ox2, midY[s2] + oy2);
        }
        ctx.closePath();

        // 深度影响透明度与亮度 (#16)
        // 丝带是发光带：填充保持低 alpha（透出桌面），靠发光描边体现存在
        var depthAlpha = 0.12 + rb.depth * 0.18;  // 0.12~0.30
        var lit = 55 + rb.depth * 20;

        // 沿丝带长度的渐变填充（两端淡入淡出）
        var fillGrad = ctx.createLinearGradient(0, 0, w, 0);
        fillGrad.addColorStop(0, 'hsla(' + hue + ',90%,' + lit + '%,0)');
        fillGrad.addColorStop(0.2, 'hsla(' + hue + ',90%,' + lit + '%,' + depthAlpha.toFixed(3) + ')');
        fillGrad.addColorStop(0.8, 'hsla(' + hue + ',90%,' + lit + '%,' + depthAlpha.toFixed(3) + ')');
        fillGrad.addColorStop(1, 'hsla(' + hue + ',90%,' + lit + '%,0)');
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // 发光描边（同色更亮）
        ctx.strokeStyle = 'hsla(' + hue + ',100%,' + (lit + 20) + '%,' + (depthAlpha * 0.6).toFixed(3) + ')';
        ctx.lineWidth = GLOW_WIDTH;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
    },
    function (state) {
      state.initialized = false;
      state.ribbons = null;
    }
  );
})();
