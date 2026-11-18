window.bloomRegister('snowfield',
  function(ctx, w, h, time, dt, state) {
    if (!state.snowflakes) {
      state.snowflakes = [];
      state.flakeCount = state.flakeCount || 140;
      state.windStrength = state.windStrength !== undefined ? state.windStrength : 1;
      state.flakeSize = state.flakeSize || 1;
      state.fallSpeed = state.fallSpeed || 1;

      // 预渲染 3 种雪花 sprite（消除每帧 save/translate/rotate + 6 次 lineTo）
      function buildSnowflake(type) {
        const S = 64;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.translate(S / 2, S / 2);
        g.strokeStyle = 'rgba(255,255,255,1)';
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3);
          g.moveTo(0, 0);
          g.lineTo(0, -S / 2);
          if (type === 0) {
            g.moveTo(0, -S * 0.225); g.lineTo(S * 0.175, -S * 0.325);
            g.moveTo(0, -S * 0.225); g.lineTo(-S * 0.175, -S * 0.325);
          } else if (type === 1) {
            const wing = S * 0.15;
            g.moveTo(0, -S * 0.15); g.lineTo(wing, -S * 0.25);
            g.moveTo(0, -S * 0.15); g.lineTo(-wing, -S * 0.25);
            g.moveTo(0, -S * 0.32); g.lineTo(wing * 0.7, -S * 0.4);
            g.moveTo(0, -S * 0.32); g.lineTo(-wing * 0.7, -S * 0.4);
          } else {
            g.moveTo(0, -S * 0.15); g.lineTo(S * 0.125, -S * 0.275);
            g.lineTo(0, -S * 0.4); g.lineTo(-S * 0.125, -S * 0.275);
            g.closePath();
          }
        }
        g.stroke();
        return c;
      }
      state.flakeSprites = [buildSnowflake(0), buildSnowflake(1), buildSnowflake(2)];

      // 预渲染大气雪团 sprite（消除每帧 createRadialGradient）
      const puff = document.createElement('canvas');
      puff.width = puff.height = 64;
      const pctx = puff.getContext('2d');
      const pg = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      pg.addColorStop(0, 'rgba(255,255,255,0.6)');
      pg.addColorStop(0.4, 'rgba(235,245,255,0.18)');
      pg.addColorStop(1, 'rgba(255,255,255,0)');
      pctx.fillStyle = pg;
      pctx.fillRect(0, 0, 64, 64);
      state.puffSprite = puff;

      const count = state.flakeCount;
      for (let i = 0; i < count; i++) {
        const depth = Math.pow(Math.random(), 2);
        const isForeground = depth > 0.75;

        let baseR;
        if (depth > 0.9) {
          baseR = Math.random() * 15 + 10;
        } else if (depth > 0.7) {
          baseR = Math.random() * 8 + 6;
        } else if (depth > 0.3) {
          baseR = Math.random() * 4 + 2.5;
        } else {
          baseR = Math.random() * 1.5 + 0.5;
        }

        state.snowflakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          depth: depth,
          r: baseR,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() * 0.8 + 0.4) * (1 + depth * 1.5),
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.04,
          opacity: isForeground ? (Math.random() * 0.12 + 0.04) : (Math.random() * 0.5 + 0.2),
          wobbleSpeed: Math.random() * 1.0 + 0.4,
          wobbleAmp: Math.random() * 3 + 1 + depth * 5,
          phase: Math.random() * Math.PI * 2,
          shimmerSpeed: Math.random() * 2.5 + 1,
          type: Math.floor(Math.random() * 3)
        });
      }
      state.globalWind = 0;
      state.targetWind = 0;
      state.windPhase = 0;
    }

    const timeScale = dt * 60;
    state.windPhase += dt * 0.12;
    state.targetWind = Math.sin(state.windPhase) * 1.8 + Math.sin(state.windPhase * 2.1) * 0.7;
    state.globalWind += (state.targetWind - state.globalWind) * 0.012 * timeScale;

    state.snowflakes.forEach(f => {
      const windEffect = state.globalWind * (0.2 + f.depth * 0.8) * state.windStrength;
      const wobble = Math.sin(time * 0.001 * f.wobbleSpeed + f.phase) * f.wobbleAmp;

      f.x += (f.vx + windEffect + wobble * 0.05) * timeScale;
      f.y += f.vy * state.fallSpeed * timeScale;
      f.rotation += f.rotationSpeed * timeScale;

      const shimmer = Math.sin(time * 0.001 * f.shimmerSpeed + f.phase) * 0.15;
      let currentOpacity = Math.max(0, Math.min(1, f.opacity + shimmer));

      if (f.y > h + f.r * 2) {
        f.y = -f.r * 2;
        f.x = Math.random() * (w + 100) - 50;
      }
      if (f.x > w + f.r * 2) f.x = -f.r * 2;
      else if (f.x < -f.r * 2) f.x = w + f.r * 2;

      if (f.depth > 0.8) {
        // 前景大气雪团：预渲染 sprite
        const blurRadius = f.r * 2.2 * state.flakeSize;
        ctx.globalAlpha = currentOpacity * 0.5;
        ctx.drawImage(state.puffSprite, f.x - blurRadius, f.y - blurRadius, blurRadius * 2, blurRadius * 2);
        ctx.globalAlpha = 1;
      } else if (f.depth > 0.25) {
        // 细节雪花：预渲染 sprite + 旋转缩放
        const size = f.r * state.flakeSize;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);
        ctx.globalAlpha = currentOpacity;
        ctx.drawImage(state.flakeSprites[f.type], -size, -size, size * 2, size * 2);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        // 远景细雪尘
        ctx.beginPath();
        ctx.fillStyle = 'rgba(240, 250, 255, ' + (currentOpacity * 0.7) + ')';
        ctx.arc(f.x, f.y, f.r * state.flakeSize, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },
  function(state) {
    state.snowflakes = null;
    state.globalWind = null;
    state.targetWind = null;
    state.windPhase = null;
    state.flakeSprites = null;
    state.puffSprite = null;
  }
);
