window.bloomRegister('cyberPulse',
  function(ctx, w, h, time, dt, state) {
    if (!state.initialized) {
      state.nodeCount = state.nodeCount || 40;
      state.connectionDistance = state.connectionDistance || 140;
      state.pulseInterval = state.pulseInterval || 600;
      var hex = state.primaryColor || '#00f3ff';
      hex = hex.replace(/^#/, '');
      var r = 0, g = 243, b = 255;
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }

      const COLORS = [
          [r, g, b],
          [255, 42, 143],
          [138, 43, 226],
          [0, 127, 255],
          [255, 255, 255]
      ];

      const numNodes = state.nodeCount;
      state.nodes = [];
      for (let i = 0; i < numNodes; i++) {
          state.nodes.push({
              id: i,
              baseX: Math.random() * w,
              baseY: Math.random() * h,
              vx: (Math.random() - 0.5) * 0.3,
              vy: (Math.random() - 0.5) * 0.3,
              phaseX: Math.random() * Math.PI * 2,
              phaseY: Math.random() * Math.PI * 2,
              connections: [],
              color: COLORS[Math.floor(Math.random() * COLORS.length)],
              flash: 0
          });
      }

      state.pulses = [];
      state.lastPulseTime = 0;

      state.dust = [];
      for (let i = 0; i < 40; i++) {
          state.dust.push({
              x: Math.random() * w,
              y: Math.random() * h,
              size: Math.random() * 1.5 + 0.5,
              vx: (Math.random() - 0.5) * 0.15,
              vy: (Math.random() - 0.5) * 0.15,
              opacity: Math.random() * 0.5 + 0.1,
              phase: Math.random() * Math.PI * 2
          });
      }

      state.initialized = true;
    }

    ctx.globalCompositeOperation = 'source-over';

    // 1. 网格背景
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.04)';
    const gridSize = 80;
    const offsetX = (time * 0.01) % gridSize;
    const offsetY = (time * 0.01) % gridSize;

    ctx.beginPath();
    for (let x = offsetX - gridSize; x < w; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let y = offsetY - gridSize; y < h; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    // 2. 背景尘埃
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    state.dust.forEach(d => {
        d.x += d.vx * dt * 60;
        d.y += d.vy * dt * 60;
        if (d.x < 0) d.x += w; if (d.x > w) d.x -= w;
        if (d.y < 0) d.y += h; if (d.y > h) d.y -= h;

        ctx.globalAlpha = d.opacity * (0.5 + 0.5 * Math.sin(time * 0.001 + d.phase));
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // 3. 更新节点
    state.nodes.forEach(n => {
        n.x = n.baseX + Math.sin(time * 0.0008 + n.phaseX) * 20;
        n.y = n.baseY + Math.cos(time * 0.0008 + n.phaseY) * 20;
        n.baseX += n.vx * dt * 60;
        n.baseY += n.vy * dt * 60;

        if (n.baseX < -50) n.baseX = w + 50;
        if (n.baseX > w + 50) n.baseX = -50;
        if (n.baseY < -50) n.baseY = h + 50;
        if (n.baseY > h + 50) n.baseY = -50;

        n.flash = Math.max(0, n.flash - dt * 2.5);
        n.connections = [];
    });

    // 4. 连接检测 + 网络线
    const maxDist = state.connectionDistance || 140;
    const maxDistSq = maxDist * maxDist;
    ctx.lineWidth = 1;

    for (let i = 0; i < state.nodes.length; i++) {
        let ni = state.nodes[i];
        for (let j = i + 1; j < state.nodes.length; j++) {
            let nj = state.nodes[j];
            let dx = ni.x - nj.x;
            let dy = ni.y - nj.y;
            let distSq = dx * dx + dy * dy;
            if (distSq < maxDistSq) {
                ni.connections.push(nj);
                nj.connections.push(ni);

                let alpha = (1 - Math.sqrt(distSq) / maxDist) * 0.2;
                ctx.beginPath();
                ctx.moveTo(ni.x, ni.y);
                ctx.lineTo(nj.x, nj.y);
                ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
                ctx.stroke();
            }
        }
    }

    // 5. 节点光点（screen 发光，去除 shadowBlur）
    ctx.globalCompositeOperation = 'screen';
    state.nodes.forEach(n => {
        if (n.flash > 0) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, 2 + n.flash * 6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${n.flash * 0.5})`;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${n.color[0]}, ${n.color[1]}, ${n.color[2]}, 0.8)`;
        ctx.fill();
    });

    // 6. 生成 + 更新脉冲
    if (time - state.lastPulseTime > (state.pulseInterval || 600)) {
        for (let k = 0; k < 3; k++) {
            let startNode = state.nodes[Math.floor(Math.random() * state.nodes.length)];
            if (startNode.connections.length > 0) {
                let targetNode = startNode.connections[Math.floor(Math.random() * startNode.connections.length)];
                state.pulses.push({
                    start: startNode,
                    target: targetNode,
                    progress: 0,
                    speed: 0.01 + Math.random() * 0.015,
                    color: startNode.color
                });
                break;
            }
        }
        state.lastPulseTime = time;
    }

    if (state.pulses.length > 40) {
        state.pulses.splice(0, state.pulses.length - 40);
    }

    for (let i = state.pulses.length - 1; i >= 0; i--) {
        let p = state.pulses[i];
        p.progress += p.speed * dt * 60;

        let x = p.start.x + (p.target.x - p.start.x) * p.progress;
        let y = p.start.y + (p.target.y - p.start.y) * p.progress;

        // 尾部（普通半透明 stroke，去除 createLinearGradient 与 shadowBlur）
        let tailLen = 0.3;
        let tailProgress = Math.max(0, p.progress - tailLen);
        let tailX = p.start.x + (p.target.x - p.start.x) * tailProgress;
        let tailY = p.start.y + (p.target.y - p.start.y) * tailProgress;

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(${p.color[0]}, ${p.color[1]}, ${p.color[2]}, 0.8)`;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        // 头部亮点
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        if (p.progress >= 1) {
            p.target.flash = 1;
            state.pulses.splice(i, 1);

            if (Math.random() < 0.35 && p.target.connections.length > 0) {
                let validConnections = p.target.connections.filter(n => n.id !== p.start.id);
                if (validConnections.length > 0) {
                    let target = validConnections[Math.floor(Math.random() * validConnections.length)];
                    state.pulses.push({
                        start: p.target,
                        target: target,
                        progress: 0,
                        speed: p.speed * (0.9 + Math.random() * 0.2),
                        color: p.color
                    });
                }
            }
        }
    }

    ctx.globalCompositeOperation = 'source-over';
  },
  function(state) {
    state.initialized = false;
    state.nodes = null;
    state.pulses = null;
    state.dust = null;
  }
);
