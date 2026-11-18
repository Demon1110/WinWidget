// ============================================================
// 墨韵晕染 (Ink Bloom) — 墨滴入水的动态分形晕染
// ============================================================
// 原理：墨滴从随机位置落下，每一滴以"随机游走"方式向外生长出
//       树状分形枝蔓（每条枝又可分叉），墨色随距离与时间淡去，
//       最终消散在宣纸底色中。多滴交替生长，呈现禅意东方美学。
//
// 优化点:
//  #2  枝蔓粒子用 swap-and-pop 删除
//  #3  墨晕用预渲染 sprite（径向软斑）
//  #4  辅助绘制函数提取
//  #11 魔法数字提取为常量
//  #12 调色板复用（墨色 + 宣纸色）
//  #13 时间统一为秒
//  #14 墨滴生命周期：落下 → 扩散 → 分叉 → 消散
// ============================================================

(function () {
  'use strict';

  // ===== 常量 (#11) =====
  var MAX_BRANCHES = 600;             // 同时存活枝蔓上限
  var DROP_INTERVAL = 1.2;            // 新墨滴生成间隔 (秒)
  var BRANCH_LIFE_MIN = 4;            // 单条枝蔓寿命
  var BRANCH_LIFE_MAX = 7;
  var BRANCH_SPEED_MIN = 25;          // 生长速度
  var BRANCH_SPEED_MAX = 55;
  var FORK_CHANCE = 0.025;            // 每帧分叉概率
  var FORK_MAX_DEPTH = 4;             // 最大分叉代数
  var ANGLE_JITTER = 0.35;            // 游走角度抖动
  var WIDTH_BASE = 2.4;               // 起始线宽
  var WIDTH_DECAY = 0.72;             // 每代线宽衰减
  var HALO_R_MIN = 30;                // 墨晕最小半径
  var HALO_R_MAX = 70;
  var HALO_LIFE = 2.5;                // 墨晕寿命
  var INK_ALPHA = 0.38;               // 墨线最高不透明度（淡墨，不遮挡桌面）
  var HALO_ALPHA = 0.28;              // 墨晕最高不透明度

  // ===== 调色板 (#12) =====
  var palette = {
    ink: [38, 36, 40],                // 墨色
    inkLight: [90, 86, 92]
  };

  // ===== 预渲染墨晕 sprite (#3) =====
  var haloSprite = null;
  var HALO_SPRITE_SIZE = 128;

  function ensureHaloSprite(rgb) {
    haloSprite = document.createElement('canvas');
    haloSprite.width = haloSprite.height = HALO_SPRITE_SIZE;
    var hc = haloSprite.getContext('2d');
    var cx = HALO_SPRITE_SIZE / 2;
    var g = hc.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(' + rgb.join(',') + ',' + HALO_ALPHA + ')');
    g.addColorStop(0.3, 'rgba(' + rgb.join(',') + ',' + (HALO_ALPHA * 0.45) + ')');
    g.addColorStop(0.7, 'rgba(' + rgb.join(',') + ',' + (HALO_ALPHA * 0.12) + ')');
    g.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    hc.fillStyle = g;
    hc.fillRect(0, 0, HALO_SPRITE_SIZE, HALO_SPRITE_SIZE);
  }

  // ===== 主渲染 =====
  window.bloomRegister('inkBloom',
    function (ctx, w, h, time, dt, state) {
      var timeSec = time / 1000; // #13
      var safeDt = Math.min(dt, 0.05);

      if (!state.initialized) {
        state.dropInterval = state.dropInterval || 1.2;
        state.maxBranches = state.maxBranches || 600;
        state.inkAlpha = state.inkAlpha || 0.38;
        var iHex = state.inkColor || '#262428';
        iHex = iHex.replace(/^#/, '');
        var ir = 38, ig = 36, ib = 40;
        if (iHex.length === 6) {
          ir = parseInt(iHex.slice(0, 2), 16);
          ig = parseInt(iHex.slice(2, 4), 16);
          ib = parseInt(iHex.slice(4, 6), 16);
        }
        state.inkRgb = [ir, ig, ib];
        ensureHaloSprite(state.inkRgb);
        state.branches = [];    // 生长中的枝蔓
        state.halos = [];       // 墨滴晕染
        state.dropTimer = 0;
        state.initialized = true;
      }

      // 无全屏底色：保持 overlay 透明，墨色半透明叠加其上，不遮挡用户工作画面
      // （原全屏宣纸底会导致完全遮挡桌面，违背透明 overlay 设计）

      // === 2. 生成新墨滴 ===
      state.dropTimer -= safeDt;
      if (state.dropTimer <= 0) {
        state.dropTimer = state.dropInterval * (0.6 + Math.random() * 0.8);
        var dx = w * (0.15 + Math.random() * 0.7);
        var dy = h * (0.15 + Math.random() * 0.7);

        // 墨晕
        state.halos.push({
          x: dx, y: dy,
          r: HALO_R_MIN + Math.random() * (HALO_R_MAX - HALO_R_MIN),
          life: HALO_LIFE,
          maxLife: HALO_LIFE
        });

        // 初始枝蔓：从墨滴向多个方向生长
        var initCount = 3 + Math.floor(Math.random() * 3);
        for (var ic = 0; ic < initCount; ic++) {
          var ang = Math.random() * Math.PI * 2;
          state.branches.push({
            x: dx, y: dy,
            px: dx, py: dy,
            angle: ang,
            speed: BRANCH_SPEED_MIN + Math.random() * (BRANCH_SPEED_MAX - BRANCH_SPEED_MIN),
            life: BRANCH_LIFE_MIN + Math.random() * (BRANCH_LIFE_MAX - BRANCH_LIFE_MIN),
            maxLife: BRANCH_LIFE_MAX,
            depth: 0,
            width: WIDTH_BASE
          });
        }
      }

      // === 3. 更新 + 绘制枝蔓 (swap-and-pop #2) ===
      var inkRgb = state.inkRgb;
      for (var bi = state.branches.length - 1; bi >= 0; bi--) {
        var br = state.branches[bi];
        // 随机游走：角度抖动
        br.angle += (Math.random() - 0.5) * ANGLE_JITTER;
        br.px = br.x;
        br.py = br.y;
        br.x += Math.cos(br.angle) * br.speed * safeDt;
        br.y += Math.sin(br.angle) * br.speed * safeDt;
        br.life -= safeDt;

        // 出界或寿命到 → 移除
        if (br.life <= 0 || br.x < -20 || br.x > w + 20 || br.y < -20 || br.y > h + 20) {
          var last = state.branches.length - 1;
          if (bi !== last) state.branches[bi] = state.branches[last];
          state.branches.pop();
          continue;
        }

        // 限制总数
        if (state.branches.length > state.maxBranches) continue;

        // 绘制墨线（alpha 随寿命衰减，最高 INK_ALPHA 保持淡墨感）
        var lifeRatio = br.life / br.maxLife;
        var alpha = Math.min(state.inkAlpha, lifeRatio * state.inkAlpha + state.inkAlpha * 0.15);
        ctx.strokeStyle = 'rgba(' + inkRgb.join(',') + ',' + alpha.toFixed(3) + ')';
        ctx.lineWidth = br.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(br.px, br.py);
        ctx.lineTo(br.x, br.y);
        ctx.stroke();

        // 分叉：生成新枝
        if (br.depth < FORK_MAX_DEPTH && Math.random() < FORK_CHANCE) {
          var forkAngle = br.angle + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5);
          state.branches.push({
            x: br.x, y: br.y,
            px: br.x, py: br.y,
            angle: forkAngle,
            speed: br.speed * 0.85,
            life: br.life * 0.7,
            maxLife: br.life * 0.7,
            depth: br.depth + 1,
            width: br.width * WIDTH_DECAY
          });
        }
      }

      // === 4. 墨晕 (sprite + swap-and-pop #3) ===
      // 用 source-over 半透明深墨色叠加（multiply 在透明背景上不可见）
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      for (var hi = state.halos.length - 1; hi >= 0; hi--) {
        var hl = state.halos[hi];
        hl.life -= safeDt;
        if (hl.life <= 0) {
          var hLast = state.halos.length - 1;
          if (hi !== hLast) state.halos[hi] = state.halos[hLast];
          state.halos.pop();
          continue;
        }
        var expand = 1 + (1 - hl.life / hl.maxLife) * 1.2; // 晕染扩散
        var haloAlpha = (hl.life / hl.maxLife) * 0.9;
        var sz = hl.r * expand * 2;
        ctx.globalAlpha = haloAlpha;
        ctx.drawImage(haloSprite, hl.x - sz / 2, hl.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    function (state) {
      state.initialized = false;
      state.branches = null;
      state.halos = null;
      state.inkRgb = null;
    }
  );
})();
