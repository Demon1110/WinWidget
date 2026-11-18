window.bloomRegister('fireflies',
  function(ctx, w, h, time, dt, state) {
    if (!state.flies) {
      state.count = state.count || 80;
      state.hue = state.hue !== undefined ? state.hue : 50;
      state.size = state.size || 1;
      state.blinkSpeed = state.blinkSpeed || 1;

      // 预渲染色相分档辉光 sprite（消除每帧 ~80 次 createRadialGradient）
      var SPRITE_STEPS = 8;
      var sprites = [];
      for (var ci = 0; ci < SPRITE_STEPS; ci++) {
        var hue = state.hue + ci * (40 / SPRITE_STEPS);
        var spr = document.createElement('canvas');
        spr.width = spr.height = 32;
        var sctx = spr.getContext('2d');
        var sg = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        sg.addColorStop(0, 'hsla(' + hue + ',100%,70%,1)');
        sg.addColorStop(0.4, 'hsla(' + hue + ',100%,55%,0.5)');
        sg.addColorStop(1, 'hsla(' + hue + ',100%,30%,0)');
        sctx.fillStyle = sg;
        sctx.fillRect(0, 0, 32, 32);
        sprites.push(spr);
      }
      state.sprites = sprites;

      state.flies = [];
      for (let i = 0; i < state.count; i++) {
        const fhue = Math.random() * 40 + state.hue;
        state.flies.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
          r: Math.random() * 2 + state.size,
          hue: fhue,
          ci: Math.min(SPRITE_STEPS - 1, Math.floor((fhue - state.hue) / 40 * SPRITE_STEPS)),
          blinkOffset: Math.random() * Math.PI * 2,
          blinkSpeed: Math.random() * 0.02 + 0.01
        });
      }
    }

    ctx.globalCompositeOperation = 'screen';
    state.flies.forEach(f => {
      f.vx += (Math.random() - 0.5) * 0.05; f.vy += (Math.random() - 0.5) * 0.05;
      f.vx = Math.max(-1, Math.min(1, f.vx));
      f.vy = Math.max(-1, Math.min(1, f.vy));
      f.x += f.vx; f.y += f.vy;
      if (f.x < 0) f.x = w; if (f.x > w) f.x = 0;
      if (f.y < 0) f.y = h; if (f.y > h) f.y = 0;
      const alpha = Math.sin(time * f.blinkSpeed * state.blinkSpeed + f.blinkOffset) * 0.5 + 0.5;
      const glowR = f.r * 4;
      ctx.globalAlpha = alpha;
      ctx.drawImage(state.sprites[f.ci], f.x - glowR, f.y - glowR, glowR * 2, glowR * 2);
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + f.hue + ',100%,85%,1)';
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) { state.flies = null; state.sprites = null; }
);
