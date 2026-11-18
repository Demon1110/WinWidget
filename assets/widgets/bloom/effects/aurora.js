window.bloomRegister('aurora',
  function(ctx, w, h, time, dt, state) {
    if (!state.layers) {
      state.layers = [];
      state.speed = state.speed || 1;
      var ampCfg = state.amplitude || 80;
      var layerCount = state.layerCount || 5;
      var primaryHex = state.primaryColor || '#00ff78';
      var pr = 0, pg = 255, pb = 120;
      primaryHex = primaryHex.replace(/^#/, '');
      if (primaryHex.length === 6) {
        pr = parseInt(primaryHex.slice(0, 2), 16);
        pg = parseInt(primaryHex.slice(2, 4), 16);
        pb = parseInt(primaryHex.slice(4, 6), 16);
      }
      var colors = [[pr, pg, pb], [0, 200, 255], [120, 0, 255], [0, 255, 200], [80, 120, 255], [pr, pg, pb], [100, 200, 255], [200, 100, 255]];
      for (let i = 0; i < layerCount; i++) state.layers.push({
        offset: Math.random() * 100, speed: Math.random() * 0.3 + 0.1, amplitude: Math.random() * ampCfg + ampCfg * 0.5,
        yBase: h * (0.15 + i * 0.12), thickness: Math.random() * 60 + 40, color: colors[i % colors.length], freq: Math.random() * 0.003 + 0.001
      });

      // 预渲染竖向下垂光线 sprite（消除每帧 30 次 createLinearGradient）
      const ray = document.createElement('canvas');
      ray.width = 4; ray.height = 64;
      const rctx = ray.getContext('2d');
      const rg0 = rctx.createLinearGradient(0, 0, 0, 64);
      rg0.addColorStop(0, 'rgba(0,255,180,1)');
      rg0.addColorStop(1, 'rgba(0,255,180,0)');
      rctx.fillStyle = rg0;
      rctx.fillRect(0, 0, 4, 64);
      state.raySprite = ray;
    }

    ctx.globalCompositeOperation = 'screen';
    var speedMul = state.speed;
    state.layers.forEach(layer => {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        const w1 = Math.sin(x * layer.freq + time * 0.0005 * layer.speed * speedMul + layer.offset) * layer.amplitude;
        const w2 = Math.sin(x * layer.freq * 1.8 + time * 0.0003 * speedMul + layer.offset * 2) * layer.amplitude * 0.5;
        ctx.lineTo(x, layer.yBase + w1 + w2);
      }
      ctx.lineTo(w, h); ctx.closePath();
      const grad = ctx.createLinearGradient(0, layer.yBase - layer.thickness, 0, layer.yBase + layer.thickness * 2);
      const r = layer.color[0], g = layer.color[1], b = layer.color[2];
      const pulse = Math.sin(time * 0.001 + layer.offset) * 0.1 + 0.2;
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},${pulse})`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${pulse * 1.5})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad; ctx.fill();
    });

    // 竖向下垂光线（sprite 替代渐变）
    for (let i = 0; i < 30; i++) {
      const x = (i / 30) * w + Math.sin(time * 0.0004 * speedMul + i) * 60;
      const a = (Math.sin(time * 0.002 * speedMul + i * 0.7) * 0.5 + 0.5) * 0.08;
      const rH = h * 0.3 + Math.sin(time * 0.001 * speedMul + i * 1.3) * h * 0.1;
      ctx.globalAlpha = a;
      ctx.drawImage(state.raySprite, x - 20, 0, 40, rH);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) { state.layers = null; state.raySprite = null; }
);
