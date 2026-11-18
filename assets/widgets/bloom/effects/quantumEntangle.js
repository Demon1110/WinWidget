window.bloomRegister('quantumEntangle', function(ctx, w, h, time, dt, state) {
  if (!state.initialized) {
    state.pairCount = state.pairCount || 8;
    state.entangleDistance = state.entangleDistance || 80;
    state.speed = state.speed || 1;

    var hex = (state.primaryColor || '#00ffc8').replace(/^#/, '');
    var pcR = 0, pcG = 255, pcB = 200;
    if (hex.length === 6) {
      pcR = parseInt(hex.slice(0, 2), 16);
      pcG = parseInt(hex.slice(2, 4), 16);
      pcB = parseInt(hex.slice(4, 6), 16);
    }
    state.primaryRGB = [pcR, pcG, pcB];
    const C = [state.primaryRGB, [255, 80, 180], [100, 180, 255], [255, 220, 80], [200, 100, 255]];

    // 预渲染各色辉光 sprite（消除逐粒子 shadowBlur）
    state.sprites = C.map(function(rgb) {
      const spr = document.createElement('canvas');
      spr.width = spr.height = 32;
      const sctx = spr.getContext('2d');
      const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)');
      g.addColorStop(0.3, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.5)');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 32, 32);
      return spr;
    });

    state.pairs = [];
    const np = state.pairCount;
    for (let i = 0; i < np; i++) {
      state.pairs.push({
        p1: { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, si: Math.random() * 2 + 2 },
        p2: { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, si: Math.random() * 2 + 2 },
        ci: i % C.length,
        color: C[i % C.length],
        phase: Math.random() * Math.PI * 2,
        entangleGlow: 0
      });
    }
    state.ripples = [];
    state.rT = 0;
    state.initialized = true;
  }

  ctx.globalCompositeOperation = 'lighter';

  state.pairs.forEach(function(pr) {
    [pr.p1, pr.p2].forEach(function(p) {
      p.x += p.vx * dt * state.speed;
      p.y += p.vy * dt * state.speed;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    });

    const dx = pr.p1.x - pr.p2.x, dy = pr.p1.y - pr.p2.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    pr.entangleGlow = Math.max(0, pr.entangleGlow - dt * 2);
    if (d < state.entangleDistance) pr.entangleGlow = Math.min(1, pr.entangleGlow + dt * 4);

    const r = pr.color[0], g = pr.color[1], b = pr.color[2];

    // 纠缠连线（普通半透明 stroke，去除 shadowBlur）
    const ga = Math.max(0.15, 1 - d / 600) * (0.5 + pr.entangleGlow * 0.5);
    ctx.beginPath();
    ctx.moveTo(pr.p1.x, pr.p1.y);
    ctx.lineTo(pr.p2.x, pr.p2.y);
    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (ga * 0.7) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 粒子（sprite 发光 + 白色核心）
    [pr.p1, pr.p2].forEach(function(p) {
      const pa = 0.6 + Math.sin(time * 0.003 + pr.phase) * 0.3;
      const rr = p.si * 4;
      ctx.globalAlpha = pa;
      ctx.drawImage(state.sprites[pr.ci], p.x - rr, p.y - rr, rr * 2, rr * 2);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.si * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
    });
  });

  // 碰撞涟漪
  state.rT -= dt;
  if (state.rT <= 0) {
    state.rT = 0.3 + Math.random() * 0.5;
    for (let i = 0; i < state.pairs.length; i++) {
      for (let j = i + 1; j < state.pairs.length; j++) {
        const a = [state.pairs[i].p1, state.pairs[i].p2];
        const b = [state.pairs[j].p1, state.pairs[j].p2];
        a.forEach(function(pa) {
          b.forEach(function(pb) {
            const dx = pa.x - pb.x, dy = pa.y - pb.y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) {
              state.ripples.push({
                x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2,
                r: 0, mR: 80 + Math.random() * 60, sp: 150 + Math.random() * 100,
                hue: Math.random() * 360, life: 1
              });
            }
          });
        });
      }
    }
  }

  state.ripples = state.ripples.filter(function(rp) {
    rp.r += rp.sp * dt;
    rp.life -= dt * 0.8;
    if (rp.life <= 0) return false;
    const p = rp.r / rp.mR;
    const a = rp.life * (1 - p) * 0.6;
    for (let i = 0; i < 3; i++) {
      const rr = rp.r - i * 10;
      if (rr < 0) continue;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'hsla(' + (rp.hue + i * 30) + ',80%,70%,' + a + ')';
      ctx.lineWidth = 2 * (1 - p) + 0.5;
      ctx.stroke();
    }
    return true;
  });

  ctx.globalCompositeOperation = 'source-over';
}, function(s) {
  s.initialized = false;
  s.pairs = null;
  s.ripples = null;
  s.rT = null;
  s.sprites = null;
  s.primaryRGB = null;
});
