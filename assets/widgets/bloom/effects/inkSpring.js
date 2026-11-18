window.bloomRegister('inkSpring',
  function(ctx, w, h, time, dt, state) {
    if (!state._init) {
      state.petalCount = state.petalCount || 45;
      state.birdCount = state.birdCount !== undefined ? state.birdCount : 11;
      state.windStrength = state.windStrength !== undefined ? state.windStrength : 1;
      var bHex = state.blossomColor || '#ffb7c5';
      bHex = bHex.replace(/^#/, '');
      var br = 255, bg = 183, bb = 197;
      if (bHex.length === 6) {
        br = parseInt(bHex.slice(0, 2), 16);
        bg = parseInt(bHex.slice(2, 4), 16);
        bb = parseInt(bHex.slice(4, 6), 16);
      }
      state.blossomRgb = [br, bg, bb];
      state._init = true;
      state.t0 = time;
      var rng = function(a, b) { return a + Math.random() * (b - a); };

      // 预渲染淡墨雾霭 sprite（消除每帧 createRadialGradient）
      const mist = document.createElement('canvas');
      mist.width = mist.height = 64;
      const mctx = mist.getContext('2d');
      const mg0 = mctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      mg0.addColorStop(0, 'rgba(220,215,210,1)');
      mg0.addColorStop(0.5, 'rgba(220,215,210,0.4)');
      mg0.addColorStop(1, 'rgba(220,215,210,0)');
      mctx.fillStyle = mg0;
      mctx.fillRect(0, 0, 64, 64);
      state.mistSprite = mist;

      function buildTree(ox, oy, angle, len, depth) {
        if (depth < 0 || len < 4) return null;
        var spread = 0.38 + depth * 0.04;
        var node = { ox: ox, oy: oy, angle: angle, len: len, depth: depth, phaseOff: rng(0, Math.PI * 2), sensitivity: rng(0.6, 1.0), children: [] };
        var ex = ox + Math.cos(angle) * len, ey = oy + Math.sin(angle) * len;
        if (depth > 0) {
          var c1 = buildTree(ex, ey, angle - spread, len * 0.62, depth - 1);
          var c2 = buildTree(ex, ey, angle + spread * 0.7, len * 0.55, depth - 1);
          if (c1) node.children.push(c1);
          if (c2) node.children.push(c2);
          if (depth > 2) { var c3 = buildTree(ex, ey, angle - spread * 0.3, len * 0.48, depth - 2); if (c3) node.children.push(c3); }
        } else {
          node.blossoms = Array.from({ length: 4 + Math.floor(Math.random() * 3) }, function() {
            return {
              dx: rng(-9, 9), dy: rng(-9, 9),
              petals: Array.from({ length: 5 }, function(_, p) {
                return {
                  pa0: (p / 5) * Math.PI * 2 + rng(0, 0.5), pr: rng(3.5, 6),
                  rx: rng(2.5, 4.5), ry: rng(1.5, 3),
                  hue: rng(340, 362), sat: rng(60, 80), lit: rng(84, 95), a: rng(0.35, 0.6)
                };
              }),
              cr: rng(1.5, 2.5)
            };
          });
        }
        return node;
      }

      state.TREE_L = buildTree(w * 0.12, h * 0.95, -Math.PI / 2 - 0.12, h * 0.38, 5);
      state.TREE_R = buildTree(w * 0.88, h * 0.95, -Math.PI / 2 + 0.10, h * 0.35, 4);

      function spawnPetal(scatter) {
        var sx = rng(0, w);
        var sy = scatter ? rng(-h * 0.5, h) : rng(-h * 0.3, -5);
        return {
          x: sx, y: sy, vx: rng(-0.2, 0.2), vy: rng(0.15, 0.5),
          rot: rng(0, Math.PI * 2), spin: rng(-0.01, 0.01),
          wt: rng(0, Math.PI * 2), ws: rng(0.002, 0.006),
          sz: rng(4, 9),
          hue: rng(340, 365), sat: rng(55, 80), lit: rng(82, 94),
          a: rng(0.35, 0.65)
        };
      }
      state.spawnPetal = spawnPetal;
      state.PETALS = Array.from({ length: state.petalCount }, function() { return spawnPetal(true); });

      state.GRASS = Array.from({ length: 66 }, function(_, i) {
        return {
          x: (i / 66) * w + rng(-4, 4), h: rng(12, 28),
          phase: rng(0, Math.PI * 2), sensitivity: rng(0.7, 1.3),
          hue: 105 + (i % 14) * 2, lw: 0.7 + Math.random() * 0.7
        };
      });

      function Bird(i) {
        this.born = i * 38; this.reset(); this.x = rng(-w * 0.3, w * 1.3);
      }
      Bird.prototype.reset = function() {
        this.dir = Math.random() > 0.5 ? 1 : -1;
        this.x = this.dir === 1 ? -60 : w + 60;
        this.baseY = rng(h * 0.08, h * 0.3);
        this.vx = this.dir * rng(0.55, 1.3);
        this.phase = rng(0, Math.PI * 2);
        this.ps = rng(0.025, 0.045);
        this.sz = rng(3.5, 8);
        this.wf = 0; this.wd = 1;
        this.op = rng(0.2, 0.45);
      };
      Bird.prototype.step = function(T) {
        if (T < this.born) return;
        this.phase += this.ps;
        this.x += this.vx;
        this.wf += 0.15 * this.wd;
        if (Math.abs(this.wf) > 0.52) this.wd *= -1;
        if ((this.dir === 1 && this.x > w + 70) || (this.dir === -1 && this.x < -70)) this.reset();
      };
      Bird.prototype.draw = function(T, cx) {
        if (T < this.born) return;
        var s = this.sz, by = this.baseY + Math.sin(this.phase) * 7;
        cx.save(); cx.globalAlpha = this.op;
        cx.translate(this.x, by);
        if (this.dir === -1) cx.scale(-1, 1);
        cx.strokeStyle = 'rgba(22,18,28,0.85)';
        cx.lineWidth = 0.9; cx.lineCap = 'round';
        cx.beginPath(); cx.moveTo(-s * 0.2, 0);
        cx.quadraticCurveTo(-s * 0.9, -s * (0.3 + this.wf * 0.55), -s * 1.6, s * 0.08); cx.stroke();
        cx.beginPath(); cx.moveTo(s * 0.2, 0);
        cx.quadraticCurveTo(s * 0.9, -s * (0.3 + this.wf * 0.55), s * 1.6, s * 0.08); cx.stroke();
        cx.beginPath(); cx.ellipse(s * 0.05, 0, s * 0.55, s * 0.2, -0.1, 0, Math.PI * 2);
        cx.fillStyle = 'rgba(22,18,28,0.8)'; cx.fill();
        cx.restore();
      };
      state.BIRDS = Array.from({ length: state.birdCount }, function(_, i) { return new Bird(i); });
    }

    var now = time - state.t0;
    var W = w, H = h;

    function wind(t) {
      return (Math.sin(t * 0.00038) * 0.5 + 0.5 + Math.sin(t * 0.00091) * 0.35 + Math.sin(t * 0.00157) * 0.15) * 0.72;
    }
    var ww = wind(now);

    // 淡墨雾霭（sprite 替代渐变，极淡不遮挡桌面）
    var mists = [[W * 0.5, H * 0.62, W * 0.7, H * 0.07, 0.04], [W * 0.3, H * 0.7, W * 0.5, H * 0.05, 0.03], [W * 0.72, H * 0.67, W * 0.4, H * 0.05, 0.025]];
    mists.forEach(function(m, i) {
      var ox = Math.sin(now * 0.00025 + i) * W * 0.04;
      var r = Math.max(m[2], m[3]);
      ctx.globalAlpha = m[4];
      ctx.drawImage(state.mistSprite, m[0] + ox - r, m[1] - r, r * 2, r * 2);
    });
    ctx.globalAlpha = 1;

    function drawTree(node, t, windVal, parentSway) {
      if (!node) return;
      var swayAmp = windVal * node.sensitivity * 0.055 * (1 + node.depth * 0.08);
      var localSway = Math.sin(t * 0.00042 + node.phaseOff) * swayAmp;
      var totalSway = (parentSway || 0) * 0.55 + localSway;
      var angle = node.angle + totalSway;
      var ex = node.ox + Math.cos(angle) * node.len, ey = node.oy + Math.sin(angle) * node.len;
      ctx.beginPath(); ctx.moveTo(node.ox, node.oy);
      ctx.bezierCurveTo(
        node.ox + Math.cos(angle - 0.18) * node.len * 0.45, node.oy + Math.sin(angle - 0.18) * node.len * 0.45,
        node.ox + Math.cos(angle + 0.12) * node.len * 0.75, node.oy + Math.sin(angle + 0.12) * node.len * 0.75,
        ex, ey
      );
      ctx.strokeStyle = 'rgba(40,28,18,' + (0.08 + node.depth * 0.015) + ')';
      ctx.lineWidth = Math.max(0.5, node.depth * 1.1 + 0.5 + (node.depth === 5 ? 2 : 0));
      ctx.lineCap = 'round'; ctx.stroke();
      if (node.blossoms) {
        node.blossoms.forEach(function(b) {
          var bx = ex + b.dx, by = ey + b.dy;
          b.petals.forEach(function(p) {
            var pa = p.pa0 + t * 0.000055;
            ctx.beginPath();
            ctx.ellipse(bx + Math.cos(pa) * p.pr * 0.9, by + Math.sin(pa) * p.pr * 0.9, p.rx, p.ry, pa, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + state.blossomRgb[0] + ',' + state.blossomRgb[1] + ',' + state.blossomRgb[2] + ',' + (p.a * 0.7) + ')'; ctx.fill();
          });
          ctx.beginPath(); ctx.arc(bx, by, b.cr, 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(48,85%,72%,0.65)'; ctx.fill();
        });
      }
      node.children.forEach(function(ch) {
        ch.ox = ex; ch.oy = ey; drawTree(ch, t, windVal, totalSway);
      });
    }

    drawTree(state.TREE_L, now, ww, 0);
    drawTree(state.TREE_R, now, ww, 0);

    // 底部草地
    var gy = H * 0.92;
    ctx.save(); ctx.globalAlpha = 0.4;
    state.GRASS.forEach(function(g) {
      var bend = Math.sin(now * 0.00042 + g.phase) * g.h * 0.38 * ww * g.sensitivity;
      ctx.strokeStyle = 'hsla(' + g.hue + ',42%,28%,0.65)';
      ctx.lineWidth = g.lw; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(g.x, gy);
      ctx.quadraticCurveTo(g.x + bend * 0.45, gy - g.h * 0.5, g.x + bend, gy - g.h);
      ctx.stroke();
    });
    ctx.restore();

    // 花瓣
    state.PETALS.forEach(function(p, i) {
      p.wt += p.ws;
      p.x += p.vx + (Math.sin(p.wt) * 0.4 + ww * 0.25) * state.windStrength;
      p.y += p.vy;
      p.rot += p.spin;
      if (p.y > H + 12) state.PETALS[i] = state.spawnPetal(false);
      ctx.save(); ctx.globalAlpha = p.a;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      var s = p.sz;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-s * 0.5, -s * 0.35, -s * 0.5, -s, 0, -s * 0.85);
      ctx.bezierCurveTo(s * 0.5, -s, s * 0.5, -s * 0.35, 0, 0);
      ctx.fillStyle = 'rgb(' + state.blossomRgb[0] + ',' + state.blossomRgb[1] + ',' + state.blossomRgb[2] + ')';
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.7);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.restore();
    });

    // 飞鸟
    state.BIRDS.forEach(function(b) { b.step(now); b.draw(now, ctx); });

    // 诗词
    ctx.save(); ctx.textAlign = 'right';
    var poemLines = [
      { text: '红杏枝头春意闹', delay: 2200 },
      { text: '', delay: 3400 },
      { text: '宋·宋祁', delay: 4400, small: true }
    ];
    poemLines.forEach(function(line, i) {
      var age = now - line.delay;
      if (age < 0) return;
      var fade = Math.min(1, age / 900);
      ctx.globalAlpha = fade * 0.4;
      if (line.small) {
        ctx.font = '300 11px serif'; ctx.fillStyle = 'rgba(80,55,40,1)';
        ctx.fillText(line.text, W - 32, H * 0.22 + i * 20);
      } else {
        ctx.font = '300 17px serif'; ctx.fillStyle = 'rgba(55,30,25,1)';
        ctx.fillText(line.text, W - 32, H * 0.18 + i * 20);
      }
    });
    ctx.restore();

    // 印章
    var sealAge = now - 5200;
    if (sealAge > 0) {
      var sealFade = Math.min(1, sealAge / 1200) * 0.3;
      ctx.save(); ctx.globalAlpha = sealFade;
      var sx = W - 28, sy = H * 0.28, sw = 18, sh = 22;
      ctx.strokeStyle = 'rgba(180,40,30,0.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);
      ctx.font = '500 7px serif'; ctx.fillStyle = 'rgba(180,40,30,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('春', sx, sy - 2);
      ctx.fillText('意', sx, sy + 8);
      ctx.restore();
    }
  },
  function(state) {
    state.TREE_L = null; state.TREE_R = null;
    state.PETALS = null; state.BIRDS = null;
    state.GRASS = null; state.spawnPetal = null;
    state.blossomRgb = null;
    state.mistSprite = null;
  }
);
