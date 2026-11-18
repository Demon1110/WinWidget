window.bloomRegister('fireworks',
  function(ctx, w, h, time, dt, state) {
    if (!state.rockets) {
      state.launchInterval = state.launchInterval || 400;
      state.sparkCount = state.sparkCount || 80;
      state.hueRange = state.hueRange !== undefined ? state.hueRange : 360;
      state.gravity = state.gravity !== undefined ? state.gravity : 0.06;
      state.rockets = [];
      state.sparks = [];
      state.lastLaunch = 0;

      // 预渲染白色辉光 sprite（消除逐粒子 shadowBlur）
      var spr = document.createElement('canvas');
      spr.width = spr.height = 32;
      var sctx = spr.getContext('2d');
      var sg = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      sg.addColorStop(0, 'rgba(255,255,255,1)');
      sg.addColorStop(0.3, 'rgba(255,255,255,0.6)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = sg;
      sctx.fillRect(0, 0, 32, 32);
      state.glow = spr;
    }

    if (time - state.lastLaunch > state.launchInterval + Math.random() * 600) {
      state.lastLaunch = time;
      state.rockets.push({
        x: Math.random() * w * 0.8 + w * 0.1, y: h,
        vy: -(Math.random() * 4 + 6),
        targetY: Math.random() * h * 0.4 + h * 0.1,
        hue: Math.random() * state.hueRange,
        trail: []
      });
    }

    state.rockets = state.rockets.filter(r => {
      r.y += r.vy;
      r.trail.push({ x: r.x, y: r.y, alpha: 1 });
      if (r.trail.length > 12) r.trail.shift();
      r.trail.forEach(t => t.alpha *= 0.85);
      r.trail.forEach(t => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + r.hue + ',100%,80%,' + t.alpha + ')';
        ctx.fill();
      });
      if (r.y <= r.targetY) {
        const n = state.sparkCount + Math.floor(Math.random() * 40);
        for (let i = 0; i < n; i++) {
          const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
          const speed = Math.random() * 4 + 2;
          state.sparks.push({
            x: r.x, y: r.y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            hue: r.hue + Math.random() * 30 - 15,
            life: 1,
            decay: Math.random() * 0.015 + 0.01,
            size: Math.random() * 2 + 1
          });
        }
        return false;
      }
      return true;
    });

    ctx.globalCompositeOperation = 'screen';
    state.sparks = state.sparks.filter(s => {
      s.x += s.vx; s.y += s.vy;
      s.vy += state.gravity; s.vx *= 0.98; s.vy *= 0.98;
      s.life -= s.decay;
      if (s.life <= 0) return false;

      // 辉光 sprite 替代 shadowBlur
      const r = s.size * s.life * 4;
      ctx.globalAlpha = s.life * 0.9;
      ctx.drawImage(state.glow, s.x - r, s.y - r, r * 2, r * 2);

      // 彩色核心
      ctx.globalAlpha = s.life;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + s.hue + ',100%,70%,1)';
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) { state.rockets = null; state.sparks = null; state.lastLaunch = null; state.glow = null; }
);
