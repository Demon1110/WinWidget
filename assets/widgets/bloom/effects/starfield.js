window.bloomRegister('starfield',
  function(ctx, w, h, time, dt, state) {
    if (!state.stars) {
      state.starCount = state.starCount || 600;
      state.warpSpeed = state.warpSpeed || 200;
      state.rotationSpeed = state.rotationSpeed !== undefined ? state.rotationSpeed : 0.02;

      var starHex = state.primaryColor || '#a3e6ff';
      starHex = starHex.replace(/^#/, '');
      var sr = 163, sg = 230, sb = 255;
      if (starHex.length === 6) {
        sr = parseInt(starHex.slice(0, 2), 16);
        sg = parseInt(starHex.slice(2, 4), 16);
        sb = parseInt(starHex.slice(4, 6), 16);
      }

      state.stars = [];
      const colors = [
        sr + ',' + sg + ',' + sb,
        '255,179,255',
        '217,179,255',
        '255,255,255',
        '255,230,179'
      ];
      for (let i = 0; i < state.starCount; i++) {
        state.stars.push({
          x: (Math.random() - 0.5) * 3000,
          y: (Math.random() - 0.5) * 3000,
          z: Math.random() * 2000,
          baseZ: 2000,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 1.5 + 0.2,
          speed: Math.random() * 1.5 + 0.5,
          phase: Math.random() * Math.PI * 2
        });
      }
      state.rotAngle = 0;

      // 预渲染环境光晕 sprite（消除每帧 createRadialGradient）
      const bg = document.createElement('canvas');
      bg.width = bg.height = 256;
      const bctx = bg.getContext('2d');
      const bgGlow = bctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      bgGlow.addColorStop(0, 'rgba(40, 20, 70, 0.2)');
      bgGlow.addColorStop(0.4, 'rgba(20, 30, 60, 0.08)');
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      bctx.fillStyle = bgGlow;
      bctx.fillRect(0, 0, 256, 256);
      state.bgSprite = bg;
    }

    const speedPulse = Math.sin(time / 3000) * 0.5 + 0.5;
    const warpSpeed = 100 + speedPulse * state.warpSpeed;

    state.rotAngle += state.rotationSpeed * dt;

    const cx = w / 2;
    const cy = h / 2;

    // 环境光晕（sprite 替代渐变）
    ctx.drawImage(state.bgSprite, 0, 0, w, h);

    const cosA = Math.cos(state.rotAngle);
    const sinA = Math.sin(state.rotAngle);
    const perspective = 800;

    state.stars.forEach(s => {
      const prevZ = s.z;
      s.z -= warpSpeed * s.speed * dt;

      if (s.z <= 1) {
        s.z = s.baseZ;
        s.x = (Math.random() - 0.5) * 3000;
        s.y = (Math.random() - 0.5) * 3000;
      }

      const rx = s.x * cosA - s.y * sinA;
      const ry = s.x * sinA + s.y * cosA;

      const px = cx + (rx / s.z) * perspective;
      const py = cy + (ry / s.z) * perspective;

      const prevPx = cx + (rx / prevZ) * perspective;
      const prevPy = cy + (ry / prevZ) * perspective;

      if (px > -200 && px < w + 200 && py > -200 && py < h + 200) {
        const zFactor = Math.max(0, 1 - (s.z / s.baseZ));
        const twinkle = Math.sin(time / 500 + s.phase) * 0.2 + 0.8;
        const alpha = Math.pow(zFactor, 1.5) * twinkle;
        const currentSize = s.size * (zFactor * 3 + 0.5);
        const dx = px - prevPx, dy = py - prevPy;
        const distSq = dx * dx + dy * dy;

        if (distSq > 0.5) {
          ctx.globalAlpha = alpha * 0.4;
          ctx.beginPath();
          ctx.moveTo(prevPx, prevPy);
          ctx.lineTo(px, py);
          ctx.strokeStyle = `rgb(${s.color})`;
          ctx.lineWidth = Math.max(0.5, currentSize * 0.5);
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        ctx.globalAlpha = alpha * 0.9;
        ctx.beginPath();
        ctx.arc(px, py, currentSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${s.color})`;
        ctx.fill();

        if (zFactor > 0.5) {
          ctx.globalAlpha = alpha * 0.25;
          ctx.beginPath();
          ctx.arc(px, py, currentSize * 2.5, 0, Math.PI * 2);
          ctx.fill();

          if (zFactor > 0.8) {
            ctx.globalAlpha = alpha * 0.1;
            ctx.beginPath();
            ctx.arc(px, py, currentSize * 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });
    ctx.globalAlpha = 1;
  },
  function(state) { state.stars = null; state.bgSprite = null; }
);
