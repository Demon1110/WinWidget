window.bloomRegister('deepSea',
  function(ctx, w, h, time, dt, state) {
    if (!state.initialized) {
      state.jellyCount = state.jellyCount || 15;
      state.beamCount = state.beamCount || 4;
      state.driftSpeed = state.driftSpeed || 1;
      var hex = state.jellyColor || '#64b4ff';
      hex = hex.replace(/^#/, '');
      var jr = 100, jg = 180, jb = 255;
      if (hex.length === 6) {
        jr = parseInt(hex.slice(0, 2), 16);
        jg = parseInt(hex.slice(2, 4), 16);
        jb = parseInt(hex.slice(4, 6), 16);
      }
      var darkColor = jr + ', ' + jg + ', ' + jb;
      var lightColor = Math.min(255, jr + 80) + ', ' + Math.min(255, jg + 80) + ', ' + Math.min(255, jb + 80);

      // 预渲染水母辉光 sprite（消除每帧 createRadialGradient）
      function makeGlow(rgb) {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(' + rgb + ',0.8)');
        grad.addColorStop(0.7, 'rgba(' + rgb + ',0.3)');
        grad.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return c;
      }
      state.jellySprites = [makeGlow(darkColor), makeGlow(lightColor)];

      // 预渲染光柱 sprite（横向渐变，白蓝）
      const beamC = document.createElement('canvas');
      beamC.width = 256; beamC.height = 4;
      const bctx = beamC.getContext('2d');
      const beamGrad = bctx.createLinearGradient(0, 0, 256, 0);
      beamGrad.addColorStop(0, 'rgba(120,210,255,0)');
      beamGrad.addColorStop(0.5, 'rgba(120,210,255,1)');
      beamGrad.addColorStop(1, 'rgba(120,210,255,0)');
      bctx.fillStyle = beamGrad;
      bctx.fillRect(0, 0, 256, 4);
      state.beamSprite = beamC;

      state.initialized = true;
      state.jellies = [];
      state.bg = null; state.bgW = 0; state.bgH = 0;
      state.vig = null; state.vigW = 0; state.vigH = 0;

      const count = state.jellyCount;
      for (let i = 0; i < count; i++) {
        const z = Math.random();
        state.jellies.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: z,
          size: z * 30 + 15,
          angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.5,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.8 + Math.random() * 0.5,
          ci: z > 0.7 ? 1 : 0,
          color: z > 0.7 ? lightColor : darkColor,
          opacity: z * 0.4 + 0.1,
          tentacles: Array.from({ length: 5 }, () => ({
            length: Math.random() * 2 + 1.5,
            offset: (Math.random() - 0.5) * 0.8
          }))
        });
      }

      state.beams = [];
      for (let i = 0; i < state.beamCount; i++) {
        state.beams.push({
          x: Math.random() * w,
          width: Math.random() * 300 + 150,
          angle: (Math.random() - 0.5) * 0.2,
          opacity: Math.random() * 0.04 + 0.01,
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
    }

    // 1. 深海背景（预渲染缓存，消除每帧 createLinearGradient）
    if (!state.bg || state.bgW !== w || state.bgH !== h) {
      const bg = document.createElement('canvas');
      bg.width = w; bg.height = h;
      const bctx = bg.getContext('2d');
      const bgGrad = bctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, 'rgba(0, 10, 26, 0.3)');
      bgGrad.addColorStop(0.5, 'rgba(0, 5, 13, 0.5)');
      bgGrad.addColorStop(1, 'rgba(0, 1, 5, 0.7)');
      bctx.fillStyle = bgGrad;
      bctx.fillRect(0, 0, w, h);
      state.bg = bg; state.bgW = w; state.bgH = h;
    }
    ctx.drawImage(state.bg, 0, 0);

    // 2. 体积光柱（sprite 替代渐变）
    ctx.globalCompositeOperation = 'screen';
    state.beams.forEach(beam => {
      const pulse = 0.6 + Math.sin(time * 0.0006 + beam.pulsePhase) * 0.4;
      ctx.save();
      ctx.translate(beam.x + Math.sin(time * 0.0002) * 50, 0);
      ctx.rotate(beam.angle + Math.sin(time * 0.0001) * 0.1);
      ctx.globalAlpha = beam.opacity * pulse;
      ctx.drawImage(state.beamSprite, -beam.width / 2, -h, beam.width, h * 3);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // 3. 水母
    state.jellies.forEach(j => {
      const pulse = Math.sin(time * 0.001 * j.pulseSpeed + j.pulsePhase);
      const isContracting = pulse > 0.5;
      const moveSpeed = isContracting ? j.size * 0.5 : j.size * 0.1;

      j.x += Math.cos(j.angle) * moveSpeed * dt;
      j.y += Math.sin(j.angle) * moveSpeed * dt;
      j.y -= 5 * state.driftSpeed * dt;
      j.x += Math.sin(time * 0.0005 + j.pulsePhase) * 10 * state.driftSpeed * dt;

      if (j.y < -100) { j.y = h + 100; j.x = Math.random() * w; }
      if (j.y > h + 100) j.y = -100;
      if (j.x < -100) j.x = w + 100;
      if (j.x > w + 100) j.x = -100;

      ctx.save();
      ctx.translate(j.x, j.y);
      ctx.rotate(j.angle + Math.PI / 2 + Math.sin(time * 0.001 * j.pulseSpeed) * 0.1);

      const stretch = 1 - pulse * 0.2;
      const squash = 1 + pulse * 0.2;
      const alpha = j.opacity;

      // 触手
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      j.tentacles.forEach(t => {
        ctx.moveTo(t.offset * j.size * 0.5, 0);
        const controlX = t.offset * j.size + Math.sin(time * 0.002 + j.pulsePhase) * 10;
        const endX = t.offset * j.size * 0.8 + Math.sin(time * 0.001 + j.pulsePhase) * 20;
        ctx.quadraticCurveTo(controlX, j.size * t.length * 0.5, endX, j.size * t.length);
      });
      ctx.strokeStyle = `rgba(${j.color}, ${alpha * 0.4})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // 钟体（sprite 替代渐变）
      ctx.globalAlpha = alpha;
      ctx.drawImage(state.jellySprites[j.ci], -j.size * squash, -j.size * 0.7 * stretch, j.size * squash * 2, j.size * 0.7 * stretch * 2);
      ctx.globalAlpha = 1;

      // 内核
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
      ctx.ellipse(0, -j.size * 0.1, j.size * 0.3 * squash, j.size * 0.2 * stretch, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });

    // 4. 海洋雪
    if (!state.snow) {
      state.snow = Array.from({ length: 50 }, () => ({
        x: Math.random() * w, y: Math.random() * h, s: Math.random() * 2, op: Math.random() * 0.3
      }));
    }
    ctx.fillStyle = 'rgba(200, 240, 255, 0.2)';
    state.snow.forEach(p => {
      p.y -= (0.1 + p.s * 0.1) * 100 * dt;
      if (p.y < 0) p.y = h;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. 暗角（预渲染缓存）
    if (!state.vig || state.vigW !== w || state.vigH !== h) {
      const vc = document.createElement('canvas');
      vc.width = w; vc.height = h;
      const vctx = vc.getContext('2d');
      const vGrad = vctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, h * 1.2);
      vGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vGrad.addColorStop(1, 'rgba(0,0,0,0.6)');
      vctx.fillStyle = vGrad;
      vctx.fillRect(0, 0, w, h);
      state.vig = vc; state.vigW = w; state.vigH = h;
    }
    ctx.drawImage(state.vig, 0, 0);

    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) {
    state.initialized = false;
    state.jellies = null;
    state.beams = null;
    state.snow = null;
    state.jellySprites = null;
    state.beamSprite = null;
    state.bg = null;
    state.vig = null;
  }
);
