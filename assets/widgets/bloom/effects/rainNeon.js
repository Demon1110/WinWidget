window.bloomRegister('rainNeon',
  function(ctx, w, h, time, dt, state) {
    if (!state.initialized) {
      state.rainDensity = state.rainDensity || 4;
      state.neonCount = state.neonCount || 6;
      state.rainSpeed = state.rainSpeed || 1;

      let hex = (state.neonColor || '#ff1493').replace(/^#/, '');
      let nr = 255, ng = 20, nb = 147;
      if (hex.length === 6) {
        nr = parseInt(hex.slice(0, 2), 16);
        ng = parseInt(hex.slice(2, 4), 16);
        nb = parseInt(hex.slice(4, 6), 16);
      }
      state.neonRGB = [nr, ng, nb];

      // 雨滴
      state.raindrops = [];
      const dropCount = Math.min(300, Math.max(80, Math.floor(w / state.rainDensity)));
      for (let i = 0; i < dropCount; i++) {
        state.raindrops.push({
          x: Math.random() * w,
          y: Math.random() * h,
          speed: Math.random() * 400 + 300,
          length: Math.random() * 15 + 8,
          opacity: Math.random() * 0.4 + 0.2
        });
      }

      // 霓虹灯光 + 预渲染光晕 sprite
      const neonColors = [state.neonRGB, [0, 255, 255], [255, 140, 0], [138, 43, 226], [0, 255, 127]];
      state.neonSprites = neonColors.map(function(rgb) {
        const spr = document.createElement('canvas');
        spr.width = spr.height = 64;
        const sctx = spr.getContext('2d');
        const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.28)');
        g.addColorStop(0.3, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.09)');
        g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, 64, 64);
        return spr;
      });

      state.neons = [];
      for (let i = 0; i < state.neonCount; i++) {
        state.neons.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.6,
          radius: Math.random() * 120 + 80,
          ci: i % neonColors.length,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: Math.random() * 0.8 + 0.3,
          driftVx: (Math.random() - 0.5) * 10,
          driftVy: (Math.random() - 0.5) * 5
        });
      }

      // 闪电
      state.lightning = { active: false, intensity: 0, nextTime: time + 2000 + Math.random() * 5000 };
      // 窗玻璃反光
      state.reflections = [];
      for (let i = 0; i < 3; i++) {
        state.reflections.push({
          x: Math.random() * w,
          y: Math.random() * h,
          width: Math.random() * 200 + 100,
          angle: Math.random() * 0.3 - 0.15
        });
      }
      state.bg = null; state.bgW = 0; state.bgH = 0;
      state.initialized = true;
    }

    // 背景：预渲染渐变到底层 canvas，仅在尺寸变化时重建（消除每帧 createLinearGradient + fillRect）
    if (!state.bg || state.bgW !== w || state.bgH !== h) {
      const bg = document.createElement('canvas');
      bg.width = w; bg.height = h;
      const bctx = bg.getContext('2d');
      const bgGrad = bctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, 'rgba(8, 8, 24, 0.15)');
      bgGrad.addColorStop(0.5, 'rgba(12, 12, 32, 0.18)');
      bgGrad.addColorStop(1, 'rgba(5, 5, 18, 0.15)');
      bctx.fillStyle = bgGrad;
      bctx.fillRect(0, 0, w, h);
      state.bg = bg; state.bgW = w; state.bgH = h;
    }
    ctx.drawImage(state.bg, 0, 0);

    // 闪电
    const lightning = state.lightning;
    if (!lightning.active && time > lightning.nextTime) {
      lightning.active = true;
      lightning.intensity = 1;
      lightning.nextTime = time + 2000 + Math.random() * 8000;
    }
    if (lightning.active) {
      lightning.intensity -= dt * 3.5;
      if (lightning.intensity <= 0) {
        lightning.active = false;
        lightning.intensity = 0;
      }
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (lightning.intensity * 0.15) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // 霓虹灯光晕（sprite 替代 createRadialGradient）
    ctx.globalCompositeOperation = 'screen';
    state.neons.forEach(neon => {
      neon.x += neon.driftVx * dt;
      neon.y += neon.driftVy * dt;
      if (neon.x < -neon.radius) neon.x = w + neon.radius;
      if (neon.x > w + neon.radius) neon.x = -neon.radius;
      if (neon.y < -neon.radius) neon.y = h + neon.radius;
      if (neon.y > h + neon.radius) neon.y = -neon.radius;

      const pulse = Math.sin(time * 0.001 * neon.pulseSpeed + neon.pulsePhase) * 0.3 + 0.7;
      const r = neon.radius * 2;
      ctx.globalAlpha = pulse;
      ctx.drawImage(state.neonSprites[neon.ci], neon.x - r, neon.y - r, r * 2, r * 2);
    });
    ctx.globalAlpha = 1;

    // 窗玻璃反光（仅 3 条，保留）
    state.reflections.forEach(ref => {
      ctx.save();
      ctx.translate(ref.x, ref.y);
      ctx.rotate(ref.angle);
      const refGrad = ctx.createLinearGradient(-ref.width / 2, 0, ref.width / 2, 0);
      refGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      refGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.02)');
      refGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
      refGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.02)');
      refGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = refGrad;
      ctx.fillRect(-ref.width / 2, -h, ref.width, h * 2);
      ctx.restore();
    });

    // 雨滴：按透明度分 3 桶批量 stroke（消除每帧 ~300 次 createLinearGradient）
    ctx.globalCompositeOperation = 'source-over';
    const windOffset = Math.sin(time * 0.0003) * 15;
    const buckets = [[], [], []];
    state.raindrops.forEach(drop => {
      drop.y += drop.speed * dt * state.rainSpeed;
      drop.x += windOffset * dt * 0.5;
      if (drop.y > h + drop.length) {
        drop.y = -drop.length;
        drop.x = Math.random() * w;
      }
      if (drop.x > w + 20) drop.x = -20;
      if (drop.x < -20) drop.x = w + 20;
      const bi = drop.opacity > 0.45 ? 2 : (drop.opacity > 0.3 ? 1 : 0);
      buckets[bi].push(drop);
    });
    const BUCKET_ALPHA = [0.27, 0.4, 0.53];
    ctx.lineWidth = 1;
    for (let bi = 0; bi < 3; bi++) {
      const list = buckets[bi];
      if (!list.length) continue;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const drop = list[i];
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + windOffset * 0.3, drop.y + drop.length);
      }
      ctx.strokeStyle = 'rgba(200, 220, 255, ' + BUCKET_ALPHA[bi] + ')';
      ctx.stroke();
    }

    // 地面水渍反光
    ctx.globalCompositeOperation = 'screen';
    const waterGrad = ctx.createLinearGradient(0, h * 0.85, 0, h);
    waterGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    waterGrad.addColorStop(1, 'rgba(60, 80, 120, 0.3)');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, h * 0.85, w, h * 0.15);

    // 闪电时雨丝高光
    if (lightning.active && lightning.intensity > 0.3) {
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (lightning.intensity * 0.08) + ')';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < Math.min(50, state.raindrops.length); i++) {
        const drop = state.raindrops[i];
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + windOffset * 0.3, drop.y + drop.length);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) {
    state.initialized = false;
    state.raindrops = null;
    state.neons = null;
    state.neonSprites = null;
    state.lightning = null;
    state.reflections = null;
    state.bg = null;
  }
);
