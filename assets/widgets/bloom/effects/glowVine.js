window.bloomRegister('glowVine', function(ctx, w, h, time, dt, state) {
  if (!state.initialized) {
    state.vineCount = state.vineCount || 4;
    state.growthSpeed = state.growthSpeed || 1;
    state.maxLength = state.maxLength || 25;

    let pHex = (state.primaryColor || '#a050ff').replace(/^#/, '');
    let pr = 160, pg = 80, pb = 255;
    if (pHex.length === 6) {
      pr = parseInt(pHex.slice(0, 2), 16);
      pg = parseInt(pHex.slice(2, 4), 16);
      pb = parseInt(pHex.slice(4, 6), 16);
    }
    state.primaryRgb = [pr, pg, pb];
    const C = [[pr, pg, pb], [80, 200, 255], [0, 255, 180], [255, 100, 200], [120, 220, 120]];

    // 预渲染各色花朵辉光 sprite（消除花瓣 createRadialGradient + shadowBlur）
    state.flowerSprites = C.map(function(rgb) {
      const spr = document.createElement('canvas');
      spr.width = spr.height = 32;
      const sctx = spr.getContext('2d');
      const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.8)');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 32, 32);
      return spr;
    });

    state.vines = [];
    const n = state.vineCount;
    for (let i = 0; i < n; i++) {
      const e = Math.floor(Math.random() * 4);
      let sx, sy, dx, dy;
      if (e === 0) { sx = Math.random() * w; sy = 0; dx = (Math.random() - 0.5) * 2; dy = 1; }
      else if (e === 1) { sx = w; sy = Math.random() * h; dx = -1; dy = (Math.random() - 0.5) * 2; }
      else if (e === 2) { sx = Math.random() * w; sy = h; dx = (Math.random() - 0.5) * 2; dy = -1; }
      else { sx = 0; sy = Math.random() * h; dx = 1; dy = (Math.random() - 0.5) * 2; }
      const L = Math.sqrt(dx * dx + dy * dy);
      state.vines.push({
        nodes: [{ x: sx, y: sy }],
        dirX: dx / L, dirY: dy / L,
        ci: i % C.length, color: C[i % C.length],
        gS: Math.random() * 30 + 20, nT: 0, fT: 2 + Math.random() * 4,
        flowers: [], maxN: Math.floor(Math.random() * 20 + state.maxLength),
        alive: true, age: 0, cP: Math.random() * Math.PI * 2, cF: Math.random() * 2 + 1
      });
    }
    state.initialized = true;
  }

  ctx.globalCompositeOperation = 'lighter';

  state.vines.forEach(function(v) {
    if (!v.alive) {
      if (time - (v.dieTime || 0) > 2000 + Math.random() * 2000) {
        const e = Math.floor(Math.random() * 4);
        let sx, sy, dx, dy;
        if (e === 0) { sx = Math.random() * w; sy = 0; dx = (Math.random() - 0.5) * 2; dy = 1; }
        else if (e === 1) { sx = w; sy = Math.random() * h; dx = -1; dy = (Math.random() - 0.5) * 2; }
        else if (e === 2) { sx = Math.random() * w; sy = h; dx = (Math.random() - 0.5) * 2; dy = -1; }
        else { sx = 0; sy = Math.random() * h; dx = 1; dy = (Math.random() - 0.5) * 2; }
        const L = Math.sqrt(dx * dx + dy * dy);
        v.nodes = [{ x: sx, y: sy }];
        v.dirX = dx / L; v.dirY = dy / L;
        v.flowers = [];
        v.alive = true; v.age = 0; v.cP = Math.random() * Math.PI * 2; v.nT = 0;
      }
      return;
    }

    v.age += dt;
    v.nT -= dt * state.growthSpeed;
    if (v.nT <= 0 && v.nodes.length < v.maxN) {
      const last = v.nodes[v.nodes.length - 1];
      const c = Math.sin(v.age * v.cF + v.cP) * 0.4;
      const ndx = v.dirX + c * v.dirY, ndy = v.dirY - c * v.dirX;
      const nl = Math.sqrt(ndx * ndx + ndy * ndy);
      const nx = last.x + ndx / nl * v.gS, ny = last.y + ndy / nl * v.gS;
      v.nodes.push({ x: nx, y: ny });
      v.nT = 0.15 + Math.random() * 0.1;
      if (nx < 0 || nx > w || ny < 0 || ny > h) {
        if (nx < 0) v.dirX = Math.abs(v.dirX);
        if (nx > w) v.dirX = -Math.abs(v.dirX);
        if (ny < 0) v.dirY = Math.abs(v.dirY);
        if (ny > h) v.dirY = -Math.abs(v.dirY);
      }
    }
    if (v.nodes.length >= v.maxN && v.flowers.length === 0) {
      v.alive = false; v.dieTime = time;
    }

    const r = v.color[0], g = v.color[1], b = v.color[2];

    // 藤蔓：lighter 双描边（宽光晕 + 细主线）替代 shadowBlur
    if (v.nodes.length > 1) {
      const path = new Path2D();
      path.moveTo(v.nodes[0].x, v.nodes[0].y);
      for (let i = 1; i < v.nodes.length - 1; i++) {
        const mx = (v.nodes[i].x + v.nodes[i + 1].x) / 2;
        const my = (v.nodes[i].y + v.nodes[i + 1].y) / 2;
        path.quadraticCurveTo(v.nodes[i].x, v.nodes[i].y, mx, my);
      }
      const la = v.nodes[v.nodes.length - 1];
      path.lineTo(la.x, la.y);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.18)';
      ctx.lineWidth = 6;
      ctx.stroke(path);
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.7)';
      ctx.lineWidth = 2.5;
      ctx.stroke(path);
    }

    // 节点光点
    v.nodes.forEach(function(no, idx) {
      const fa = idx / v.nodes.length;
      const pu = Math.sin(time * 0.002 + idx * 0.5) * 0.3 + 0.7;
      const si = 1.5 * pu * (0.5 + fa * 0.5);
      ctx.beginPath();
      ctx.arc(no.x, no.y, si, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.5 * fa + 0.3) + ')';
      ctx.fill();
    });

    // 生成花朵
    if (v.nodes.length >= 8 && v.flowers.length < 4) {
      v.fT -= dt;
      if (v.fT <= 0) {
        const base = Math.floor(v.nodes.length * 0.3 + Math.random() * v.nodes.length * 0.4);
        const no = v.nodes[Math.min(base, v.nodes.length - 1)];
        v.flowers.push({
          x: no.x, y: no.y, bloom: 0, mB: 1, bS: Math.random() * 0.5 + 0.3,
          petals: Math.floor(Math.random() * 3) + 5,
          ci: v.ci,
          phase: Math.random() * Math.PI * 2, size: Math.random() * 5 + 3
        });
        v.fT = 1.5 + Math.random() * 2.5;
      }
    }

    // 花朵：sprite 替代渐变 + shadowBlur
    v.flowers.forEach(function(f) {
      if (f.bloom < f.mB) f.bloom += f.bS * dt;
      const bl = Math.min(f.bloom, f.mB);
      const sw = Math.sin(time * 0.001 + f.phase) * 2;
      const spr = state.flowerSprites[f.ci];
      for (let p = 0; p < f.petals; p++) {
        const a = (p / f.petals) * Math.PI * 2 + time * 0.0005 + f.phase;
        const px = f.x + Math.cos(a) * f.size * bl + sw;
        const py = f.y + Math.sin(a) * f.size * bl;
        const rr = f.size * 0.9 * bl;
        ctx.globalAlpha = bl * 0.8;
        ctx.drawImage(spr, px - rr, py - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = bl;
      ctx.beginPath();
      ctx.arc(f.x + sw * 0.3, f.y, 1.5 * bl, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,200,1)';
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  });

  // 漂浮粒子
  if (!state.ap) {
    state.ap = [];
    for (let i = 0; i < 30; i++) {
      state.ap.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
        si: Math.random() * 1.5 + 0.5, ph: Math.random() * Math.PI * 2
      });
    }
  }
  ctx.globalAlpha = 0.6;
  state.ap.forEach(function(p) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 0) p.x += w; if (p.x > w) p.x -= w;
    if (p.y < 0) p.y += h; if (p.y > h) p.y -= h;
    const a = (Math.sin(time * 0.001 + p.ph) * 0.5 + 0.5) * 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.si, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,200,255,' + a + ')';
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  ctx.globalCompositeOperation = 'source-over';
}, function(s) {
  s.initialized = false;
  s.vines = null;
  s.ap = null;
  s.primaryRgb = null;
  s.flowerSprites = null;
});
