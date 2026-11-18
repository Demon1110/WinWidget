window.bloomRegister('sakura',
  function(ctx, w, h, time, dt, state) {
    if (!state.petals) {
      state.petalCount = state.petalCount || 45;
      state.fallSpeed = state.fallSpeed || 1;
      state.petalSize = state.petalSize || 1;

      var hex = state.petalColor || '#ffb7cd';
      hex = hex.replace(/^#/, '');
      var pr = 255, pg = 183, pb = 205;
      if (hex.length === 6) {
        pr = parseInt(hex.slice(0, 2), 16);
        pg = parseInt(hex.slice(2, 4), 16);
        pb = parseInt(hex.slice(4, 6), 16);
      }
      state._petalRgb = [pr, pg, pb];
      state._petalRgbLight = [Math.min(255, pr), Math.min(255, pg + 37), Math.min(255, pb + 25)];

      // 预渲染花瓣 sprite（含渐变填充 + 白描边 + 叶脉，消除每帧 ~45 次 createLinearGradient）
      const S = 30;
      const spr = document.createElement('canvas');
      spr.width = spr.height = S;
      const g = spr.getContext('2d');
      g.translate(S / 2, S); // 花瓣原点移到画布底部中心
      const grad = g.createLinearGradient(0, -30, 0, 0);
      grad.addColorStop(0, 'rgba(' + pr + ',' + pg + ',' + pb + ',0.9)');
      grad.addColorStop(1, 'rgba(' + state._petalRgbLight[0] + ',' + state._petalRgbLight[1] + ',' + state._petalRgbLight[2] + ',0.6)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-15, -10, -15, -25, 0, -25);
      g.bezierCurveTo(15, -25, 15, -10, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -15); g.stroke();
      state.petalSprite = spr;

      state.petals = [];
      for (let i = 0; i < state.petalCount; i++) {
        state.petals.push({
          x: Math.random() * w, y: Math.random() * h - h,
          s: Math.random() * 0.6 + 0.3, r: Math.random() * 360,
          dr: Math.random() * 1.5 - 0.75, dx: Math.random() - 0.5,
          dy: Math.random() * 1.5 + 0.5, flip: Math.random() * Math.PI * 2,
          dflip: Math.random() * 0.05 + 0.01
        });
      }
    }
    state.petals.forEach(p => {
      p.y += p.dy * state.fallSpeed; p.x += Math.sin(time / 1500 + p.dx) * 1.5;
      p.r += p.dr; p.flip += p.dflip;
      if (p.y > h + 30) { p.y = -30; p.x = Math.random() * w; }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r * Math.PI / 180);
      ctx.scale(p.s * state.petalSize * Math.abs(Math.cos(p.flip)), p.s * state.petalSize);
      // sprite 原点在 (15,30)，绘制到 (-15,-30) 使花瓣原点对齐当前坐标原点
      ctx.drawImage(state.petalSprite, -15, -30, 30, 30);
      ctx.restore();
    });
  },
  function(state) { state.petals = null; state._petalRgb = null; state._petalRgbLight = null; state.petalSprite = null; }
);
