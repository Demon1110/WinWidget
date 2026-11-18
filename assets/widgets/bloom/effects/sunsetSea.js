window.bloomRegister('sunsetSea',
  function(ctx, w, h, time, dt, state) {
    const baseHorizon = h * 0.55;
    const vpx = w / 2;
    const t = time * 0.001;

    if (!state.init || state.lastW !== w || state.lastH !== h) {
      state.sunSize = state.sunSize || 0.12;
      state.cycleSpeed = state.cycleSpeed || 0.003;

      var sunHex = state.sunColor || '#fff0c8';
      sunHex = sunHex.replace(/^#/, '');
      var sunCr = 255, sunCg = 240, sunCb = 200;
      if (sunHex.length === 6) {
        sunCr = parseInt(sunHex.slice(0, 2), 16);
        sunCg = parseInt(sunHex.slice(2, 4), 16);
        sunCb = parseInt(sunHex.slice(4, 6), 16);
      }
      state._sunRgb = [sunCr, sunCg, sunCb];

      var glowHex = state.glowColor || '#ffdc64';
      glowHex = glowHex.replace(/^#/, '');
      var glowCr = 255, glowCg = 220, glowCb = 100;
      if (glowHex.length === 6) {
        glowCr = parseInt(glowHex.slice(0, 2), 16);
        glowCg = parseInt(glowHex.slice(2, 4), 16);
        glowCb = parseInt(glowHex.slice(4, 6), 16);
      }
      state._glowRgb = [glowCr, glowCg, glowCb];

      state.gridOffset = 0;

      // --- 1. Textures ---
      const starCanvas = document.createElement('canvas');
      starCanvas.width = 16; starCanvas.height = 16;
      const sctx0 = starCanvas.getContext('2d');
      const sg = sctx0.createRadialGradient(8, 8, 0, 8, 8, 8);
      sg.addColorStop(0, 'rgba(255, 255, 255, 1)');
      sg.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
      sg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      sctx0.fillStyle = sg; sctx0.fillRect(0, 0, 16, 16);
      state.starTexture = starCanvas;

      const sparkleCanvas = document.createElement('canvas');
      sparkleCanvas.width = 32; sparkleCanvas.height = 32;
      const spctx = sparkleCanvas.getContext('2d');
      const spg = spctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      spg.addColorStop(0, 'rgba(255, 250, 220, 1)');
      spg.addColorStop(0.3, 'rgba(255, 220, 120, 0.4)');
      spg.addColorStop(1, 'rgba(255, 150, 50, 0)');
      spctx.fillStyle = spg; spctx.fillRect(0, 0, 32, 32);
      state.sparkleTexture = sparkleCanvas;

      // 天空渐变缓存（颜色固定，仅随尺寸变化重建）
      const skyCanvas = document.createElement('canvas');
      skyCanvas.width = w; skyCanvas.height = baseHorizon;
      const skyCtx = skyCanvas.getContext('2d');
      const skyGrad = skyCtx.createLinearGradient(0, 0, 0, baseHorizon);
      skyGrad.addColorStop(0, 'rgba(10, 10, 40, 0.12)');
      skyGrad.addColorStop(0.5, 'rgba(26, 15, 53, 0.1)');
      skyGrad.addColorStop(0.8, 'rgba(74, 37, 69, 0.08)');
      skyGrad.addColorStop(1, 'rgba(117, 58, 64, 0.06)');
      skyCtx.fillStyle = skyGrad;
      skyCtx.fillRect(0, 0, w, baseHorizon);
      state.skyCanvas = skyCanvas;

      // 云 blob sprite（灰紫暖色，消除每帧 ~30 次 createRadialGradient）
      const cloudSpr = document.createElement('canvas');
      cloudSpr.width = cloudSpr.height = 64;
      const cloudCtx = cloudSpr.getContext('2d');
      const cloudGrad = cloudCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
      cloudGrad.addColorStop(0, 'rgba(180,120,160,1)');
      cloudGrad.addColorStop(1, 'rgba(180,120,160,0)');
      cloudCtx.fillStyle = cloudGrad;
      cloudCtx.fillRect(0, 0, 64, 64);
      state.cloudSprite = cloudSpr;

      // 波光 shimmer sprite（暖色，消除每帧 ~6 次 createRadialGradient）
      const shSpr = document.createElement('canvas');
      shSpr.width = shSpr.height = 64;
      const shCtx = shSpr.getContext('2d');
      const shGrad = shCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
      shGrad.addColorStop(0, 'rgba(255,240,180,1)');
      shGrad.addColorStop(1, 'rgba(255,100,50,0)');
      shCtx.fillStyle = shGrad;
      shCtx.fillRect(0, 0, 64, 64);
      state.shimmerSprite = shSpr;

      // 山雾 sprite（灰紫竖向渐变）
      const hzSpr = document.createElement('canvas');
      hzSpr.width = 4; hzSpr.height = 64;
      const hzCtx = hzSpr.getContext('2d');
      const hzGrad = hzCtx.createLinearGradient(0, 0, 0, 64);
      hzGrad.addColorStop(0, 'rgba(80,50,90,0)');
      hzGrad.addColorStop(1, 'rgba(60,40,70,1)');
      hzCtx.fillStyle = hzGrad;
      hzCtx.fillRect(0, 0, 4, 64);
      state.hazeSprite = hzSpr;

      // --- 2. Stars ---
      state.stars = Array.from({ length: 120 }, () => ({
        x: Math.random() * w,
        y: Math.random() * baseHorizon * 0.95,
        size: 0.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.0
      }));

      // --- 3. Mountains ---
      function genMountain(points, roughness) {
        const heights = new Array(points).fill(0);
        for (let i = 0; i < points; i++) {
          const x = i / (points - 1);
          heights[i] = Math.pow(Math.sin(x * Math.PI), 1.5) * 0.3;
        }
        let amp = roughness, freq = 2.0;
        const seed = Math.random() * 1000;
        for (let o = 0; o < 5; o++) {
          for (let i = 0; i < points; i++) {
            heights[i] += (Math.sin((i / (points - 1)) * freq * Math.PI + seed + o * 7) * 0.5 + 0.5) * amp;
          }
          amp *= 0.45; freq *= 2.2;
        }
        return heights;
      }

      state.mountainLayers = [
        { pts: genMountain(120, 0.40), color: [90, 85, 125], h: 220, op: 0.15, yOff: -35 },
        { pts: genMountain(110, 0.38), color: [65, 62, 100], h: 170, op: 0.22, yOff: -15 },
        { pts: genMountain(100, 0.35), color: [45, 48, 78], h: 130, op: 0.30, yOff: 5 },
        { pts: genMountain(90, 0.32), color: [28, 32, 58], h: 90, op: 0.38, yOff: 25 },
        { pts: genMountain(80, 0.28), color: [15, 18, 38], h: 65, op: 0.45, yOff: 45 }
      ];

      state.mountainPaths = state.mountainLayers.map(layer => {
        const path = new Path2D();
        const step = w / (layer.pts.length - 1);
        path.moveTo(0, 1000);
        for (let i = 0; i < layer.pts.length; i++) {
          path.lineTo(i * step, -layer.pts[i] * layer.h);
        }
        path.lineTo(w, 1000);
        path.closePath();
        return path;
      });

      // --- 4. Clouds ---
      state.clouds = Array.from({ length: 6 }, () => ({
        x: Math.random() * w,
        y: baseHorizon * (0.1 + Math.random() * 0.4),
        w: 120 + Math.random() * 200,
        h: 12 + Math.random() * 20,
        speed: 0.2 + Math.random() * 0.4,
        op: 0.04 + Math.random() * 0.06,
        blobs: Array.from({ length: 5 }, () => ({
          ox: (Math.random() - 0.5) * 0.7, oy: (Math.random() - 0.5) * 0.5, r: 0.4 + Math.random() * 0.6
        }))
      }));

      // --- 5. Sea ---
      state.waveSeeds = Array.from({ length: 30 }, (_, i) => ({
        speed: 1.5 + Math.random() * 2.0,
        freq: 0.003 + Math.random() * 0.005,
        phase: Math.random() * Math.PI * 2, amp: 0.8 + Math.random() * 0.8
      }));
      state.sparkleSeeds = Array.from({ length: 45 }, () => ({
        xRel: (Math.random() - 0.5) * 2, yRel: Math.random(), speed: 2.0 + Math.random() * 3.0, phase: Math.random() * Math.PI * 2
      }));

      state.lastW = w; state.lastH = h; state.init = true;
    }

    const sunsetProgress = (t * state.cycleSpeed) % 1.0;
    const redShift = Math.pow(sunsetProgress, 2.2);
    const sunVis = sunsetProgress < 0.65 ? 1 : Math.max(0, 1 - Math.pow((sunsetProgress - 0.65) / 0.35, 1.5));
    const sunR = Math.min(w, h) * state.sunSize;
    const sunY = (baseHorizon - sunR * 3) + (sunR * 4) * sunsetProgress;
    const refStr = sunsetProgress < 0.55 ? sunsetProgress / 0.55 : Math.max(0, 1 - (sunsetProgress - 0.55) / 0.45);

    // 1. SKY（预渲染缓存）
    ctx.drawImage(state.skyCanvas, 0, 0);

    // Stars
    ctx.globalCompositeOperation = 'screen';
    state.stars.forEach(s => {
      const flicker = Math.sin(t * s.speed + s.phase) * 0.5 + 0.5;
      const alpha = (0.05 + 0.3 * flicker) * (1 - redShift * 0.8);
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      const size = s.size * (0.8 + 0.4 * flicker);
      ctx.drawImage(state.starTexture, s.x - size, s.y - size, size * 2, size * 2);
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    // Clouds（sprite 替代渐变）
    state.clouds.forEach(c => {
      c.x += c.speed * dt * 20; if (c.x > w + c.w) c.x = -c.w;
      const op = c.op * (1 - redShift * 0.5);
      c.blobs.forEach(b => {
        const bx = c.x + b.ox * c.w, by = c.y + b.oy * c.h, br = b.r * c.h * 1.5;
        ctx.globalAlpha = op;
        ctx.drawImage(state.cloudSprite, bx - br, by - br, br * 2, br * 2);
      });
    });
    ctx.globalAlpha = 1;

    // 2. SUN（离屏合成，含山体遮挡）
    if (!state.sunCanvas || state.lastW !== w) {
      state.sunCanvas = document.createElement('canvas');
    }
    state.sunCanvas.width = w;
    state.sunCanvas.height = baseHorizon;
    const sctx = state.sunCanvas.getContext('2d');
    sctx.clearRect(0, 0, w, baseHorizon);

    const glowR = sunR * 3;
    const atmosphericGlow = sctx.createRadialGradient(vpx, sunY, sunR, vpx, sunY, glowR);
    atmosphericGlow.addColorStop(0, `rgba(255, 100, 30, ${0.1 * sunVis})`);
    atmosphericGlow.addColorStop(1, 'rgba(60, 20, 60, 0)');
    sctx.fillStyle = atmosphericGlow;
    sctx.beginPath(); sctx.arc(vpx, sunY, glowR, 0, Math.PI * 2); sctx.fill();

    const rayCount = 8;
    for (let i = 0; i < rayCount; i++) {
      const angle = -0.7 + (i / (rayCount - 1)) * 1.4;
      const pulse = Math.sin(t * 1.0 + i) * 0.5 + 0.5;
      const rAlpha = (0.005 + pulse * 0.005) * sunVis;
      sctx.save();
      sctx.translate(vpx, sunY); sctx.rotate(angle);
      const rg = sctx.createLinearGradient(0, 0, 0, -h);
      rg.addColorStop(0, `rgba(255, 180, 100, ${rAlpha})`); rg.addColorStop(1, 'rgba(255, 50, 50, 0)');
      sctx.fillStyle = rg; sctx.beginPath(); sctx.moveTo(0, 0); sctx.lineTo(-sunR * 0.2, -h); sctx.lineTo(sunR * 0.2, -h); sctx.fill();
      sctx.restore();
    }

    const sunGrad = sctx.createRadialGradient(vpx, sunY, 0, vpx, sunY, sunR);
    const sunCoreAlpha = 0.5 * sunVis;
    sunGrad.addColorStop(0, `rgba(${state._sunRgb[0]}, ${state._sunRgb[1] - redShift * 150}, ${state._sunRgb[2] - redShift * 180}, ${sunCoreAlpha})`);
    sunGrad.addColorStop(1, `rgba(255, ${100 - redShift * 80}, 20, 0)`);
    sctx.fillStyle = sunGrad; sctx.beginPath(); sctx.arc(vpx, sunY, sunR, 0, Math.PI * 2); sctx.fill();

    sctx.globalCompositeOperation = 'destination-out';
    state.mountainLayers.forEach((layer, idx) => {
      sctx.save();
      sctx.translate(0, baseHorizon + layer.yOff);
      sctx.fill(state.mountainPaths[idx]);
      sctx.restore();
    });

    ctx.drawImage(state.sunCanvas, 0, 0);

    // 3. MOUNTAINS
    state.mountainLayers.forEach((layer, idx) => {
      const actualY = baseHorizon + layer.yOff;
      const depth = idx / (state.mountainLayers.length - 1);
      const path = state.mountainPaths[idx];

      ctx.save();
      ctx.translate(0, actualY);
      ctx.globalAlpha = layer.op * (0.8 + depth * 0.2);
      ctx.fillStyle = `rgb(${layer.color.join(',')})`;
      ctx.fill(path);

      const gold = Math.max(0, Math.sin(Math.min(redShift * 1.2, 0.9) * Math.PI)) * sunVis * (0.4 + (1 - depth) * 0.6);
      if (gold > 0.05) {
        ctx.globalCompositeOperation = 'screen';
        const gGrad = ctx.createLinearGradient(0, -layer.h, 0, 0);
        gGrad.addColorStop(0, `rgba(255, 230, 150, ${gold})`);
        gGrad.addColorStop(0.4, `rgba(255, 140, 40, ${gold * 0.5})`);
        gGrad.addColorStop(1, 'rgba(100, 40, 20, 0)');
        ctx.fillStyle = gGrad;
        ctx.fill(path);
      }
      ctx.restore();

      // 山雾（sprite 替代渐变）
      ctx.globalAlpha = 0.12 * (1 - depth);
      ctx.drawImage(state.hazeSprite, 0, actualY - 30, w, 40);
      ctx.globalAlpha = 1;
    });

    // 4. SEA
    const seaH = h - baseHorizon;
    const seaGrad = ctx.createLinearGradient(0, baseHorizon, 0, h);
    seaGrad.addColorStop(0, `rgba(${35 + redShift * 40}, ${18 + redShift * 18}, ${50 - redShift * 10}, 0.15)`);
    seaGrad.addColorStop(1, 'rgba(5, 3, 15, 0.1)');
    ctx.fillStyle = seaGrad; ctx.fillRect(0, baseHorizon, w, seaH);

    // 落日余晖反射
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const topW = sunR * 0.8;
    const bottomW = sunR * 6;
    ctx.beginPath();
    ctx.moveTo(vpx - topW, baseHorizon);
    ctx.lineTo(vpx + topW, baseHorizon);
    ctx.lineTo(vpx + bottomW, h);
    ctx.lineTo(vpx - bottomW, h);
    ctx.closePath();
    ctx.clip();

    const glowG = ctx.createLinearGradient(vpx, baseHorizon, vpx, h);
    const pulse = Math.sin(t * 0.5) * 0.1 + 0.9;
    const baseAlpha = 0.25 * refStr * pulse;

    glowG.addColorStop(0, `rgba(${state._glowRgb[0]}, ${state._glowRgb[1]}, ${state._glowRgb[2]}, ${baseAlpha})`);
    glowG.addColorStop(0.3, `rgba(255, 150, 50, ${baseAlpha * 0.7})`);
    glowG.addColorStop(1, `rgba(255, 80, 20, 0)`);

    ctx.fillStyle = glowG;
    ctx.fill();

    // 横向波光（sprite 替代渐变）
    for (let i = 0; i < 6; i++) {
      const py = 0.1 + (i / 5) * 0.8;
      const y = baseHorizon + py * seaH;
      const sw = bottomW * py * 1.5;
      const drift = Math.sin(t * 0.3 + i) * 10;
      ctx.globalAlpha = baseAlpha * 0.4;
      ctx.drawImage(state.shimmerSprite, vpx + drift - sw, y - 20, sw * 2, 40);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Sparkles
    ctx.globalCompositeOperation = 'screen';
    state.sparkleSeeds.forEach(s => {
      const val = Math.pow(Math.max(0, Math.sin(t * s.speed + s.phase)), 12) * refStr;
      if (val < 0.2) return;
      const sy = baseHorizon + s.yRel * seaH, sx = vpx + s.xRel * (sunR * (2 + s.yRel * 6)) + Math.sin(t * 0.5 + sy) * 15;
      const sz = (1 + val * 3) * (0.4 + (1 - s.yRel) * 0.6);
      ctx.globalAlpha = val * 0.5; ctx.drawImage(state.sparkleTexture, sx - sz, sy - sz, sz * 2, sz * 2);
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  },
  function(state) {
    state.init = false;
    state._sunRgb = null;
    state._glowRgb = null;
    state.skyCanvas = null;
    state.cloudSprite = null;
    state.shimmerSprite = null;
    state.hazeSprite = null;
  }
);
