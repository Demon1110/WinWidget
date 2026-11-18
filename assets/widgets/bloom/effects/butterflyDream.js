window.bloomRegister('butterflyDream',
  function(ctx, w, h, time, dt, state) {
    // 1. 初始化状态
    if (!state.initialized) {
      var paletteIdx = state.palette || 0;
      var countCfg = state.count || 6;
      var sizeCfg = state.butterflySize || 18;
      state.speed = state.speed || 1;

      state.butterflies = [];
      state.trailParticles = [];
      state.ambientParticles = [];
      state.initialized = true;

      const colorPalettes = [
        { primary: 'rgba(255, 99, 219, 0.9)', secondary: 'rgba(157, 78, 221, 0.5)', glow: 'rgba(255, 99, 219, 0.8)', rgb: [255, 99, 219] },
        { primary: 'rgba(0, 245, 255, 0.9)', secondary: 'rgba(0, 150, 255, 0.5)', glow: 'rgba(0, 245, 255, 0.8)', rgb: [0, 245, 255] },
        { primary: 'rgba(255, 186, 8, 0.9)', secondary: 'rgba(232, 93, 4, 0.5)', glow: 'rgba(255, 186, 8, 0.8)', rgb: [255, 186, 8] },
        { primary: 'rgba(0, 255, 180, 0.9)', secondary: 'rgba(0, 180, 120, 0.5)', glow: 'rgba(0, 255, 180, 0.8)', rgb: [0, 255, 180] },
        { primary: 'rgba(255, 75, 75, 0.9)', secondary: 'rgba(255, 0, 120, 0.5)', glow: 'rgba(255, 75, 75, 0.8)', rgb: [255, 75, 75] }
      ];

      // 预渲染各调色板光晕 sprite（替代 shadowBlur）
      colorPalettes.forEach((p, i) => { p.ci = i; });
      state.glowSprites = colorPalettes.map(function(p) {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(' + p.rgb[0] + ',' + p.rgb[1] + ',' + p.rgb[2] + ',0.8)');
        grad.addColorStop(1, 'rgba(' + p.rgb[0] + ',' + p.rgb[1] + ',' + p.rgb[2] + ',0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return c;
      });

      const count = countCfg;
      for (let i = 0; i < count; i++) {
        const palette = colorPalettes[(paletteIdx + i) % colorPalettes.length];
        state.butterflies.push({
          x: Math.random() * w,
          y: Math.random() * h,
          angle: Math.random() * Math.PI * 2,
          speed: (Math.random() * 80 + 80) * state.speed,
          targetX: Math.random() * w,
          targetY: Math.random() * h,
          targetTimer: Math.random() * 4 + 2,
          flapPhase: Math.random() * Math.PI * 2,
          flapSpeed: Math.random() * 12 + 15,
          size: Math.random() * 6 + sizeCfg,
          flutterOffset: Math.random() * 100,
          palette: palette
        });
      }

      for (let i = 0; i < 60; i++) {
        const pal = colorPalettes[Math.floor(Math.random() * colorPalettes.length)];
        state.ambientParticles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 15,
          vy: -(Math.random() * 15 + 10),
          size: Math.random() * 2 + 1,
          alpha: Math.random() * 0.4 + 0.2,
          pulseSpeed: Math.random() * 2 + 1,
          pulsePhase: Math.random() * Math.PI * 2,
          rgb: pal.rgb
        });
      }
    }

    const safeDt = Math.min(dt, 0.05);

    // 2. 背景仙灵粒子
    state.ambientParticles.forEach(p => {
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.pulsePhase += p.pulseSpeed * safeDt;

      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;

      const a = p.alpha * (0.6 + 0.4 * Math.sin(p.pulsePhase));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]}, ${a})`;
      ctx.fill();
    });

    // 3. 尾迹粒子
    for (let i = state.trailParticles.length - 1; i >= 0; i--) {
      const p = state.trailParticles[i];
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.alpha -= p.decay * safeDt;

      if (p.alpha <= 0) {
        state.trailParticles.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.3 + 0.7 * p.alpha), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]}, ${p.alpha * 0.8})`;
      ctx.fill();
    }

    // 4. 蝴蝶
    state.butterflies.forEach(b => {
      b.targetTimer -= safeDt;
      const dx = b.targetX - b.x;
      const dy = b.targetY - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (b.targetTimer <= 0 || dist < 40) {
        b.targetX = Math.random() * w;
        b.targetY = Math.random() * h;
        b.targetTimer = Math.random() * 4 + 3;
      }

      const targetAngle = Math.atan2(dy, dx);
      let angleDiff = targetAngle - b.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      b.angle += angleDiff * 2.2 * safeDt;

      b.x += Math.cos(b.angle) * b.speed * safeDt;
      b.y += Math.sin(b.angle) * b.speed * safeDt;

      const border = 50;
      if (b.x < border) { b.targetX = w * 0.7; b.targetTimer = 2; }
      if (b.x > w - border) { b.targetX = w * 0.3; b.targetTimer = 2; }
      if (b.y < border) { b.targetY = h * 0.7; b.targetTimer = 2; }
      if (b.y > h - border) { b.targetY = h * 0.3; b.targetTimer = 2; }

      b.flapPhase += b.flapSpeed * safeDt;

      const flutterX = Math.sin(time * 0.015 + b.flutterOffset) * 3;
      const flutterY = Math.cos(time * 0.022 + b.flutterOffset) * 2;
      const renderX = b.x + flutterX;
      const renderY = b.y + flutterY;

      if (Math.random() < 0.35) {
        state.trailParticles.push({
          x: renderX,
          y: renderY,
          vx: (Math.random() - 0.5) * 20 - Math.cos(b.angle) * 15,
          vy: (Math.random() - 0.5) * 20 - Math.sin(b.angle) * 15 + 10,
          size: Math.random() * 2.2 + 1.2,
          alpha: 1.0,
          decay: Math.random() * 0.6 + 0.5,
          rgb: b.palette.rgb
        });
      }

      ctx.save();
      ctx.translate(renderX, renderY);
      ctx.rotate(b.angle + Math.PI / 2);

      // 光晕（sprite 替代 shadowBlur）
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7;
      const gr = b.size * 2.2;
      ctx.drawImage(state.glowSprites[b.palette.ci], -gr, -gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      const wingScaleX = 0.15 + 0.85 * Math.abs(Math.sin(b.flapPhase));

      ctx.save();
      ctx.scale(-wingScaleX, 1);
      drawButterflyWing(ctx, b.size, b.palette);
      ctx.restore();

      ctx.save();
      ctx.scale(wingScaleX, 1);
      drawButterflyWing(ctx, b.size, b.palette);
      ctx.restore();

      drawButterflyBody(ctx, b.size, b.palette);

      ctx.restore();
    });

    function drawButterflyWing(ctx, size, palette) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(size * 0.8, -size * 0.8, size * 1.5, -size * 0.4, size * 1.3, size * 0.3);
      ctx.bezierCurveTo(size * 1.0, size * 0.7, size * 0.5, size * 0.2, 0, 0);
      ctx.closePath();

      const gradFore = ctx.createRadialGradient(0, 0, size * 0.1, size * 0.8, -size * 0.3, size * 1.2);
      gradFore.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      gradFore.addColorStop(0.3, palette.primary);
      gradFore.addColorStop(1, palette.secondary);
      ctx.fillStyle = gradFore;
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.bezierCurveTo(size * 0.7, size * 0.2, size * 1.0, size * 1.0, size * 0.6, size * 1.3);
      ctx.bezierCurveTo(size * 0.3, size * 1.4, size * 0.1, size * 0.7, 0, 2);
      ctx.closePath();

      const gradHind = ctx.createLinearGradient(0, 0, size * 0.5, size * 1.0);
      gradHind.addColorStop(0, palette.primary);
      gradHind.addColorStop(1, palette.secondary);
      ctx.fillStyle = gradHind;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(2, -2);
      ctx.lineTo(size * 0.8, -size * 0.4);
      ctx.moveTo(2, 0);
      ctx.lineTo(size * 0.9, size * 0.1);
      ctx.moveTo(1, 2);
      ctx.lineTo(size * 0.4, size * 0.7);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    function drawButterflyBody(ctx, size, palette) {
      ctx.beginPath();
      ctx.arc(0, -size * 0.3, size * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-1, -size * 0.3);
      ctx.quadraticCurveTo(-size * 0.2, -size * 0.6, -size * 0.25, -size * 0.7);
      ctx.moveTo(1, -size * 0.3);
      ctx.quadraticCurveTo(size * 0.2, -size * 0.6, size * 0.25, -size * 0.7);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -size * 0.25);
      ctx.quadraticCurveTo(-size * 0.05, 0, 0, size * 0.4);
      ctx.quadraticCurveTo(size * 0.05, 0, 0, -size * 0.25);
      ctx.closePath();

      const bodyGrad = ctx.createLinearGradient(0, -size * 0.25, 0, size * 0.4);
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.5, palette.primary);
      bodyGrad.addColorStop(1, '#000000');
      ctx.fillStyle = bodyGrad;
      ctx.fill();
    }
  },
  function(state) {
    state.initialized = false;
    state.butterflies = null;
    state.trailParticles = null;
    state.ambientParticles = null;
    state.glowSprites = null;
  }
);
