window.bloomRegister('fireVortex',
  function(ctx, w, h, time, dt, state) {
    const cx = w * 0.5, cy = h * 0.48, t = time * 0.001, S = Math.min(w, h);

    if (!state.initialized) {
      state.ribbonCount = state.ribbonCount || 6;
      state.emberCount = state.emberCount || 50;
      state.hueBase = state.hueBase !== undefined ? state.hueBase : 2;
      state.intensity = state.intensity || 1;
      state.ribbons = [];
      for (let i = 0; i < state.ribbonCount; i++) state.ribbons.push({
        baseAngle: (i / state.ribbonCount) * Math.PI * 2,
        turns: 1.0 + Math.random() * 0.8,
        width: 0.055 + Math.random() * 0.035,
        length: 0.65 + Math.random() * 0.35,
        speed: 0.22 + Math.random() * 0.18,
        hueShift: Math.random() * 12 - 6,
        phase: Math.random() * Math.PI * 2,
        breathPh: Math.random() * Math.PI * 2,
        rise: 0.15 + Math.random() * 0.12
      });
      state.mkEmber = () => {
        const a = Math.random() * Math.PI * 2, r = Math.random() * S * 0.15;
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.6,
          vx: (Math.random() - 0.5) * 4, vy: -(Math.random() * 10 + 4),
          life: Math.random() * 0.7 + 0.3, maxLife: 1,
          size: Math.random() * 1.6 + 0.4, hue: Math.random() * 28 + 18,
          ph: Math.random() * Math.PI * 2 };
      };
      
      // 优化点 1: 增加火星粒子数量（从 30 增加到 50），配合性能优化让画面更华丽、细节更丰富
      state.embers = Array.from({ length: state.emberCount }, state.mkEmber);

      // 优化点 2: 预渲染 12 个不同色相的火焰发光粒子 Sprite。
      // 彻底消除在渲染循环中动态创建 radialGradient 的高昂 CPU 开销。
      state.glowSprites = [];
      const spriteCount = 12;
      for (let j = 0; j < spriteCount; j++) {
        // 色相映射范围：2 (红) 到 85 (金黄)
        const hue = state.hueBase + (j / (spriteCount - 1)) * 83;
        const canvas = document.createElement('canvas');
        const sz = 64;
        canvas.width = canvas.height = sz;
        const sCtx = canvas.getContext('2d');
        const grad = sCtx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
        
        grad.addColorStop(0, `hsla(${hue}, 100%, 75%, 1)`);
        grad.addColorStop(0.2, `hsla(${hue}, 95%, 55%, 0.6)`);
        grad.addColorStop(0.55, `hsla(${Math.max(state.hueBase, hue - 5)}, 85%, 40%, 0.18)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        
        sCtx.fillStyle = grad;
        sCtx.fillRect(0, 0, sz, sz);
        state.glowSprites.push(canvas);
      }

      state.initialized = true;
    }

    const breath = Math.sin(t * 0.35) * 0.5 + 0.5;
    const bS = 0.88 + breath * 0.12;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(3, 1, 5, ${0.085 + breath * 0.015})`;
    ctx.fillRect(0, 0, w, h);

    // Ambient halo
    ctx.globalCompositeOperation = 'screen';
    const aP = 0.55 + Math.sin(t * 0.5) * 0.25, aR = S * 0.48 * bS;
    const amb = ctx.createRadialGradient(cx, cy, 0, cx, cy, aR);
    amb.addColorStop(0, `rgba(100,30,12,${0.055*state.intensity*aP})`);
    amb.addColorStop(0.3, `rgba(60,15,6,${0.025*state.intensity*aP})`);
    amb.addColorStop(0.65, `rgba(30,8,3,${0.008*state.intensity*aP})`);
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amb;
    ctx.beginPath(); ctx.arc(cx, cy, aR, 0, Math.PI * 2); ctx.fill();

    // Core — beating heart
    const cR = S * 0.055 * bS, cP = 0.6 + Math.sin(t * 0.7) * 0.4;
    const cOut = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR * 4);
    cOut.addColorStop(0, `rgba(255,170,70,${0.18*state.intensity*cP})`);
    cOut.addColorStop(0.25, `rgba(200,80,25,${0.07*state.intensity*cP})`);
    cOut.addColorStop(0.6, `rgba(100,25,8,${0.02*state.intensity*cP})`);
    cOut.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cOut;
    ctx.beginPath(); ctx.arc(cx, cy, cR * 4, 0, Math.PI * 2); ctx.fill();
    const cIn = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
    cIn.addColorStop(0, `rgba(255,235,190,${0.55*state.intensity*cP})`);
    cIn.addColorStop(0.35, `rgba(255,170,65,${0.35*state.intensity*cP})`);
    cIn.addColorStop(0.7, `rgba(210,80,25,${0.12*state.intensity*cP})`);
    cIn.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cIn;
    ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();

    // Spiral flame ribbons
    ctx.globalCompositeOperation = 'lighter';
    const maxR = S * 0.34;
    state.ribbons.forEach(rb => {
      const rA = rb.baseAngle + t * rb.speed;
      const rB = 0.88 + Math.sin(t * 0.35 + rb.breathPh) * 0.12;
      
      // 优化点 3: 适当降低插值分段数（从 55 降至 40），在重叠绘制下视觉上完全无缝，但可减少 27% 循环开销
      const segs = 40, pts = [];
      for (let i = 0; i <= segs; i++) {
        const f = i / segs;
        const sA = rA + f * Math.PI * 2 * rb.turns;
        const r = f * maxR * rb.length * rB;
        const wave = Math.sin(f * 7 + t * 1.6 + rb.phase) * (1.5 + f * 5);
        const waveY = Math.cos(f * 5.5 + t * 1.3 + rb.phase) * (1 + f * 3.5);
        pts.push({ x: cx + Math.cos(sA) * r + wave,
                    y: cy + Math.sin(sA) * r * 0.45 - f * S * rb.rise + waveY, f });
      }
      
      // 优化点 4: 使用 drawImage 绘制预渲染的火焰微粒 Sprite 代替 createRadialGradient()
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i], f = p.f;
        const wF = Math.pow(1 - f, 0.55);
        const lW = rb.width * S * wF * rB;
        let hue;
        if (f < 0.55) { const lf = f / 0.55; hue = state.hueBase + rb.hueShift + lf * 38; }
        else if (f < 0.85) { const lf = (f - 0.55) / 0.3; hue = state.hueBase + 38 + rb.hueShift + lf * 15; }
        else { const lf = (f - 0.85) / 0.15; hue = state.hueBase + 53 + rb.hueShift + lf * 30; }
        
        const alpha = Math.pow(1 - f, 0.75) * 0.45 * state.intensity;
        const fl = 0.82 + Math.sin(t * 2.2 + f * 9 + rb.phase) * 0.18;
        const mx = (p.x + pts[i-1].x) * 0.5, my = (p.y + pts[i-1].y) * 0.5;

        // 根据计算出的色相映射到最接近的预渲染 Sprite
        const targetHue = Math.min(state.hueBase + 83, Math.max(state.hueBase, hue));
        const spriteIdx = Math.floor(((targetHue - state.hueBase) / 83) * (state.glowSprites.length - 1));
        const sprite = state.glowSprites[spriteIdx];

        ctx.globalAlpha = alpha * fl;
        ctx.drawImage(sprite, mx - lW, my - lW, lW * 2, lW * 2);
      }
      ctx.globalAlpha = 1.0;

      // Bright spine thread
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i += 2) {
        ctx.quadraticCurveTo(pts[i].x, pts[i].y,
          (pts[i].x + pts[Math.min(i+1, pts.length-1)].x) * 0.5,
          (pts[i].y + pts[Math.min(i+1, pts.length-1)].y) * 0.5);
      }
      ctx.strokeStyle = `hsla(${38+rb.hueShift},75%,72%,${0.1*rB})`;
      ctx.lineWidth = 1.2 * rB; ctx.stroke();
    });

    // Petal embers — delicate drifting warmth
    ctx.globalCompositeOperation = 'screen';
    state.embers.forEach(e => {
      e.life -= dt * 0.18;
      if (e.life <= 0) { Object.assign(e, state.mkEmber()); return; }
      const dx = e.x - cx, dy = e.y - cy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const swirl = 0.25 * (1 - Math.min(1, dist / (S * 0.4)));
      e.vx += (-Math.sin(angle) * swirl * 6) * dt;
      e.vy += (-2.5 - Math.random() * 1.5) * dt;
      e.vx *= 0.97; e.vy *= 0.97;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const lifeR = e.life / e.maxLife;
      const flicker = 0.45 + Math.sin(t * 3.5 + e.ph) * 0.55;
      const alpha = lifeR * flicker * 0.55;
      const sz = e.size * (0.5 + lifeR * 0.5);

      // 优化点 5: 火星粒子同样使用预渲染的 Sprite 绘制，极大释放 CPU 绘图压力
      const targetHue = Math.min(state.hueBase + 83, Math.max(state.hueBase, e.hue));
      const spriteIdx = Math.floor(((targetHue - state.hueBase) / 83) * (state.glowSprites.length - 1));
      const sprite = state.glowSprites[spriteIdx];

      ctx.globalAlpha = alpha * state.intensity;
      ctx.drawImage(sprite, e.x - sz * 5, e.y - sz * 5, sz * 10, sz * 10);
    });
    ctx.globalAlpha = 1.0;

    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) {
    state.initialized = false;
    state.ribbons = null;
    state.embers = null;
    state.glowSprites = null;
  }
);
