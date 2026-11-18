window.bloomRegister('gravityParticles',
  function(ctx, w, h, time, dt, state) {
    // 1. 初始化
    if (!state.init) {
      state.particleCount = state.particleCount || 350;
      state.hue = state.hue !== undefined ? state.hue : 200;
      state.gravityStrength = state.gravityStrength || 1;
      state.trailLength = state.trailLength || 8;
      state.init = true;
      state.particles = [];
      const count = state.particleCount;
      const trailLen = Math.max(2, state.trailLength | 0);
      for (let i = 0; i < count; i++) {
        const isCore = Math.random() > 0.82;
        state.particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: isCore ? Math.random() * 1.8 + 0.8 : Math.random() * 0.8 + 0.3,
          hue: Math.random() > 0.5 ? (state.hue - 20 + Math.random() * 40) : (state.hue + 60 + Math.random() * 40),
          isCore: isCore,
          opacity: isCore ? 0.7 : 0.4,
          friction: 0.91 + Math.random() * 0.05,
          hx: new Float32Array(trailLen),
          hy: new Float32Array(trailLen),
          hHead: 0,
          hCount: 0,
          phase: Math.random() * Math.PI * 2
        });
      }

      // 预渲染氛围光晕 sprite（消除每帧 createRadialGradient）
      const spr = document.createElement('canvas');
      spr.width = spr.height = 256;
      const sctx = spr.getContext('2d');
      const sg = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      sg.addColorStop(0, 'rgba(80, 100, 255, 1)');
      sg.addColorStop(1, 'rgba(80, 100, 255, 0)');
      sctx.fillStyle = sg;
      sctx.fillRect(0, 0, 256, 256);
      state.glowSprite = spr;
    }

    // 2. 交互中心（平滑跟随鼠标；overlay preload 为主，其余为回退）
    let point = null;
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

    let mx = null, my = null;
    if (point) {
      const lx = point.x - (window.screenX || 0);
      const ly = point.y - (window.screenY || 0);
      const onScreen = lx >= -40 && lx < w + 40 && ly >= -40 && ly < h + 40;
      if (onScreen) {
        if (state.mx === null || state.mx === undefined) { state.mx = lx; state.my = ly; }
        state.mx += (lx - state.mx) * 0.12;
        state.my += (ly - state.my) * 0.12;
        mx = state.mx; my = state.my;
      }
    }
    if (mx === null || my === null) {
      // 光标不在本屏（或不可用）：用缓慢演示轨道，避免粒子被拉向屏外
      mx = w / 2 + Math.cos(time / 1200) * w / 4;
      my = h / 2 + Math.sin(time / 1500) * h / 4;
    }

    const heartbeat = Math.sin(time / 800) * 0.5 + 0.5;
    const centerGlowRadius = 180 + heartbeat * 120;

    ctx.globalCompositeOperation = 'screen';

    // 柔和氛围光晕（sprite 替代渐变）
    ctx.globalAlpha = 0.07 + heartbeat * 0.04;
    ctx.drawImage(state.glowSprite, mx - centerGlowRadius, my - centerGlowRadius, centerGlowRadius * 2, centerGlowRadius * 2);
    ctx.globalAlpha = 1;

    // 3. 更新 + 渲染粒子
    const trailLen = state.trailLength;
    state.particles.forEach(p => {
      const dx = mx - p.x;
      const dy = my - p.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq) || 1;

      // 引力 + 漩涡 + 布朗噪声
      const strength = Math.min(1800 * state.gravityStrength / distSq, 0.6);
      p.vx += dx * strength * 0.016;
      p.vy += dy * strength * 0.016;

      const swirl = 0.15 * (140 / (dist + 50));
      p.vx -= (dy / dist) * swirl;
      p.vy += (dx / dist) * swirl;

      p.vx += (Math.random() - 0.5) * 0.18;
      p.vy += (Math.random() - 0.5) * 0.18;

      p.vx *= p.friction;
      p.vy *= p.friction;

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -100) p.x = w + 100; else if (p.x > w + 100) p.x = -100;
      if (p.y < -100) p.y = h + 100; else if (p.y > h + 100) p.y = -100;

      // 环形缓冲写入当前点（消除 shift() 的 O(n) 移动与 GC）
      p.hx[p.hHead] = p.x;
      p.hy[p.hHead] = p.y;
      p.hHead = (p.hHead + 1) % trailLen;
      if (p.hCount < trailLen) p.hCount++;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const alpha = p.opacity * (0.4 + heartbeat * 0.4) * Math.min(1, dist / 60);

      // 拖尾（环形缓冲顺序绘制，从最老到最新）
      if (p.hCount > 1) {
        const startIdx = (p.hHead - p.hCount + trailLen) % trailLen;
        ctx.beginPath();
        ctx.moveTo(p.hx[startIdx], p.hy[startIdx]);
        for (let k = 1; k < p.hCount; k++) {
          const idx = (startIdx + k) % trailLen;
          ctx.lineTo(p.hx[idx], p.hy[idx]);
        }
        ctx.strokeStyle = 'hsla(' + p.hue + ', 80%, 75%, ' + (alpha * 0.28) + ')';
        ctx.lineWidth = p.size;
        ctx.stroke();
      }

      // 粒子本体
      const brightness = 70 + speed * 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + speed * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + p.hue + ', 85%, ' + brightness + '%, ' + alpha + ')';
      ctx.fill();

      // core 粒子与鼠标的连线（普通半透明 stroke，去除每帧 createLinearGradient）
      if (p.isCore && dist < 200) {
        const linkAlpha = alpha * Math.pow(1 - dist / 200, 1.8) * 0.55;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mx, my);
        ctx.strokeStyle = 'hsla(' + p.hue + ', 80%, 75%, ' + linkAlpha + ')';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
    });

    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) {
    state.init = false;
    state.particles = null;
    state.mx = null;
    state.my = null;
    state.glowSprite = null;
  }
);
