window.bloomRegister('galaxy',
  function(ctx, w, h, time, dt, state) {
    if (!state.stars) {
      state.starCount = state.starCount || 200;
      state.armCount = state.armCount || 3;
      state.hue = state.hue !== undefined ? state.hue : 200;
      state.rotationSpeed = state.rotationSpeed || 1;
      state.stars = [];
      for (let a = 0; a < state.armCount; a++) for (let i = 0; i < state.starCount; i++) {
        const dist = Math.random() * Math.min(w, h) * 0.4;
        const ba = (a / state.armCount) * Math.PI * 2;
        const sp = (dist / (Math.min(w, h) * 0.4)) * 0.8;
        state.stars.push({
          dist, angle: ba + dist * 0.008 + (Math.random() - 0.5) * sp, size: Math.random() * 2 + 0.5,
          brightness: Math.random() * 0.5 + 0.5, hue: Math.random() * 60 + state.hue, twinkleSpeed: Math.random() * 0.005 + 0.001,
          twinkleOffset: Math.random() * Math.PI * 2
        });
      }
      for (let i = 0; i < 100; i++) state.stars.push({
        dist: Math.random() * 40, angle: Math.random() * Math.PI * 2,
        size: Math.random() * 1.5 + 0.5, brightness: Math.random() * 0.3 + 0.7, hue: Math.random() * 40 + 30,
        twinkleSpeed: Math.random() * 0.003 + 0.001, twinkleOffset: Math.random() * Math.PI * 2
      });

      // 预渲染星系核心辉光 sprite（消除每帧 createRadialGradient）
      const core = document.createElement('canvas');
      core.width = core.height = 120;
      const cctx = core.getContext('2d');
      const cg = cctx.createRadialGradient(60, 60, 0, 60, 60, 60);
      cg.addColorStop(0, 'rgba(255,230,180,0.25)');
      cg.addColorStop(0.5, 'rgba(200,180,255,0.08)');
      cg.addColorStop(1, 'rgba(100,100,255,0)');
      cctx.fillStyle = cg;
      cctx.fillRect(0, 0, 120, 120);
      state.coreSprite = core;
    }

    const cx = w / 2, cy = h / 2, rot = time * 0.00008 * state.rotationSpeed;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(state.coreSprite, cx - 60, cy - 60, 120, 120);
    state.stars.forEach(s => {
      const a = s.angle + rot;
      const x = cx + Math.cos(a) * s.dist;
      const y = cy + Math.sin(a) * s.dist * 0.55;
      const tw = Math.sin(time * s.twinkleSpeed + s.twinkleOffset) * 0.3 + 0.7;
      ctx.beginPath(); ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue},60%,75%,${s.brightness * tw})`; ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) { state.stars = null; state.coreSprite = null; }
);
