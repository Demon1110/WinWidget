// ============================================================
// 拾星成图 (Constellation)
// ============================================================
// 交互：
//   慢速划动 -> 沿途撒下星点；每约 34px 留一颗更亮的锚星
//   停住约 0.55s -> 锚星在 connectDistance 内做最近邻连线，形成星座
//   快速甩动 -> 旧星座被吹散，锚星化作流星
//   长时间空闲 -> 星座缓慢淡出
// 视觉：全部为预渲染柔光 sprite + 细线，透明背景，不遮挡桌面。
// 性能：最多 260 颗星、6 张星座、14 颗流星；每帧只有 drawImage 和少量线段。
// ============================================================
(function () {
  'use strict';

  var MAX_STARS = 260;
  var MAX_METEORS = 14;
  var MAX_CONSTELLATIONS = 6;
  var MAX_ANCHORS_PER_CONSTELLATION = 18;
  var ANCHOR_SPACING = 34;
  var STILL_SPEED = 110;        // px/s 以下视为停顿
  var STILL_TIME = 0.55;        // 停顿时长
  var FAST_SPEED = 1100;        // px/s 以上撒流星
  var SCATTER_SPEED = 1600;     // px/s 以上吹散星座
  var METEOR_COOLDOWN = 0.12;
  var CONSTELLATION_LIFE = 11;

  var LABEL_NAMES = ['拾光座', '晚风座', '渡月座', '归途座', '星屑座', '静水座', '长夜座', '微光座', '远山座', '流萤座'];

  function rand (a, b) { return a + Math.random() * (b - a); }

  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hexToRgb (hex) {
    var s = String(hex || '#cfe6ff').replace(/^#/, '');
    if (s.length === 3) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return [207, 230, 255];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  // 一颗星的柔光 sprite；flare 为锚星的四芒星
  function makeStarSprite (size, rgb, flare) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    var base = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.14, 'rgba(' + base + ',0.95)');
    grad.addColorStop(0.42, 'rgba(' + base + ',0.22)');
    grad.addColorStop(1, 'rgba(' + base + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    if (flare) {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = Math.max(1, size / 80);
      g.beginPath();
      g.moveTo(r, r * 0.14);
      g.lineTo(r, r * 1.86);
      g.moveTo(r * 0.14, r);
      g.lineTo(r * 1.86, r);
      g.stroke();
      g.strokeStyle = 'rgba(' + base + ',0.5)';
      g.lineWidth = Math.max(1, size / 55);
      g.beginPath();
      g.moveTo(r * 0.3, r * 0.3);
      g.lineTo(r * 1.7, r * 1.7);
      g.moveTo(r * 1.7, r * 0.3);
      g.lineTo(r * 0.3, r * 1.7);
      g.stroke();
    }
    return c;
  }

  function makeNebulaSprite (rgb) {
    var size = 256;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var base = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(' + base + ',0.16)');
    grad.addColorStop(0.45, 'rgba(' + base + ',0.05)');
    grad.addColorStop(1, 'rgba(' + base + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function setup (state) {
    state.starColor = state.starColor || '#cfe6ff';
    state.density = state.density !== undefined ? state.density : 55;
    state.connectDistance = state.connectDistance !== undefined ? state.connectDistance : 180;
    state.twinkleSpeed = state.twinkleSpeed !== undefined ? state.twinkleSpeed : 1;
    state.shootingStars = state.shootingStars !== undefined ? state.shootingStars : 1;
    state.showLabel = state.showLabel !== undefined ? state.showLabel : 1;

    var rgb = hexToRgb(state.starColor);
    state.sprites = {
      main: makeStarSprite(64, rgb, false),
      anchor: makeStarSprite(64, rgb, true),
      blue: makeStarSprite(64, [150, 196, 255], false),
      warm: makeStarSprite(64, [255, 214, 160], false),
      meteor: makeStarSprite(64, [255, 246, 224], true),
      nebula: makeNebulaSprite(rgb)
    };
    state.rgb = rgb;
    state.stars = [];
    state.meteors = [];
    state.constellations = [];
    state.prevX = null;
    state.prevY = null;
    state.prevOn = false;
    state.speed = 0;
    state.stillTime = 0;
    state.dustAccum = 0;
    state.anchorAccum = 0;
    // 密度越大，星点间距越小：density 20 -> 22px，100 -> 8px
    state.dustSpacing = clamp(26 - state.density * 0.18, 8, 24);
    state.anchorsDirty = false;
    state.meteorCd = 0;
    state.scattered = false;
    state.labelSeq = 0;
    state.ready = true;
  }

  function initFn (state) {
    state.ready = false;
    state.sprites = null;
    state.stars = null;
    state.meteors = null;
    state.constellations = null;
    state.prevX = null;
    state.prevY = null;
    state.prevOn = false;
    state.speed = 0;
    state.stillTime = 0;
    state.dustAccum = 0;
    state.anchorAccum = 0;
    state.anchorsDirty = false;
    state.meteorCd = 0;
    state.scattered = false;
    state.labelSeq = 0;
  }

  function readCursor (w, h, time) {
    var point = null;
    if (window.__bloomCursorService && window.__bloomCursorService.getCursorScreenPoint) {
      try { point = window.__bloomCursorService.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.utools && window.utools.getCursorScreenPoint) {
      try { point = window.utools.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.bloomCursor) point = window.bloomCursor;
    if (!point && window.services && window.services.getCursorScreenPoint) {
      try { point = window.services.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (point) {
      var lx = point.x - (window.screenX || 0);
      var ly = point.y - (window.screenY || 0);
      return {
        x: lx,
        y: ly,
        on: lx >= -40 && lx < w + 40 && ly >= -40 && ly < h + 40,
        real: true
      };
    }
    // 兜底：没有光标服务时用缓慢的 Lissajous 轨迹，保证画面不会空白
    return {
      x: w / 2 + Math.cos(time * 0.00012) * w * 0.28,
      y: h / 2 + Math.sin(time * 0.00018) * h * 0.24,
      on: true,
      real: false
    };
  }

  function addStar (state, x, y, anchor) {
    if (state.stars.length >= MAX_STARS) state.stars.shift();
    var life = anchor ? rand(28, 42) : rand(9, 17);
    var sprite = anchor
      ? state.sprites.anchor
      : (Math.random() < 0.16 ? state.sprites.warm : (Math.random() < 0.24 ? state.sprites.blue : state.sprites.main));
    state.stars.push({
      x: x,
      y: y,
      vx: anchor ? rand(-1.4, 1.4) : rand(-5, 5),
      vy: anchor ? rand(-1.4, 1.4) : rand(-5, 5),
      size: anchor ? rand(16, 26) : rand(4, 10),
      life: life,
      maxLife: life,
      phase: Math.random() * Math.PI * 2,
      tw: rand(0.7, 1.4),
      anchor: !!anchor,
      used: false,
      sprite: sprite
    });
    if (anchor) state.anchorsDirty = true;
  }

  function spawnMeteor (state, x, y, dx, dy, speed) {
    if (state.meteors.length >= MAX_METEORS) state.meteors.shift();
    var ang = Math.atan2(dy, dx) + rand(-0.22, 0.22);
    var sp = rand(480, 900) + Math.min(speed, 2600) * 0.12;
    var life = rand(0.45, 0.9);
    state.meteors.push({
      x: x,
      y: y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: life,
      maxLife: life,
      size: rand(10, 18),
      phase: Math.random() * Math.PI * 2
    });
  }

  function scatterConstellations (state) {
    if (!state.constellations.length) return;
    var spawned = 0;
    for (var i = 0; i < state.constellations.length; i++) {
      var c = state.constellations[i];
      c.life = Math.min(c.life, 1.2);
      for (var j = 0; j < c.anchors.length && spawned < 5; j++) {
        if (Math.random() < 0.35) {
          var s = c.anchors[j];
          spawnMeteor(state, s.x, s.y, rand(-1, 1), rand(-1, 1), 1600);
          spawned++;
        }
      }
    }
  }

  function buildConstellation (state) {
    if (!state.anchorsDirty) return;
    state.anchorsDirty = false;

    var anchors = [];
    for (var i = 0; i < state.stars.length; i++) {
      var s = state.stars[i];
      if (s.anchor && !s.used && s.life > 2) anchors.push(s);
    }
    if (anchors.length < 3) return;

    if (anchors.length > MAX_ANCHORS_PER_CONSTELLATION) {
      anchors = anchors.slice(anchors.length - MAX_ANCHORS_PER_CONSTELLATION);
    }

    // 每颗锚星连到最近的一颗（距离上限内），去重后形成一张无向星图
    var pairs = [];
    var seen = {};
    for (var a = 0; a < anchors.length; a++) {
      var best = -1;
      var bestD = state.connectDistance;
      for (var b = 0; b < anchors.length; b++) {
        if (a === b) continue;
        var dx = anchors[a].x - anchors[b].x;
        var dy = anchors[a].y - anchors[b].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best >= 0) {
        var lo = Math.min(a, best);
        var hi = Math.max(a, best);
        var key = lo + '-' + hi;
        if (!seen[key]) {
          seen[key] = 1;
          pairs.push([lo, hi]);
        }
      }
    }
    if (!pairs.length) return;

    var cx = 0;
    var cy = 0;
    for (var k = 0; k < anchors.length; k++) {
      anchors[k].used = true;
      cx += anchors[k].x;
      cy += anchors[k].y;
    }
    cx /= anchors.length;
    cy /= anchors.length;

    var label = '';
    if (state.showLabel) {
      state.labelSeq++;
      var name = LABEL_NAMES[(state.labelSeq - 1) % LABEL_NAMES.length];
      label = name + ' · ' + ('0' + state.labelSeq).slice(-2);
    }

    state.constellations.push({
      anchors: anchors,
      pairs: pairs,
      cx: cx,
      cy: cy,
      life: CONSTELLATION_LIFE,
      maxLife: CONSTELLATION_LIFE,
      label: label
    });
    if (state.constellations.length > MAX_CONSTELLATIONS) state.constellations.shift();
  }

  function drawConstellations (ctx, state) {
    var rgb = state.rgb;
    var base = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    for (var i = 0; i < state.constellations.length; i++) {
      var c = state.constellations[i];
      var alpha = clamp(c.life / c.maxLife, 0, 1);
      if (alpha <= 0) continue;

      // 星云底光
      ctx.globalAlpha = alpha * 0.055;
      ctx.drawImage(state.sprites.nebula, c.cx - 180, c.cy - 180, 360, 360);
      ctx.globalAlpha = 1;

      // 连线：一条宽而淡的辉光 + 一条细而亮的星线
      ctx.beginPath();
      for (var p = 0; p < c.pairs.length; p++) {
        var a = c.anchors[c.pairs[p][0]];
        var b = c.anchors[c.pairs[p][1]];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = 'rgba(' + base + ',' + (alpha * 0.18) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + base + ',' + (alpha * 0.55) + ')';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  function drawStars (ctx, state, time) {
    for (var i = 0; i < state.stars.length; i++) {
      var s = state.stars[i];
      var fade = clamp(s.life / 3, 0, 1);
      var twinkle = 0.68 + 0.32 * Math.sin(time * 0.002 * state.twinkleSpeed * s.tw + s.phase);
      ctx.globalAlpha = clamp(fade * twinkle, 0, 1);
      ctx.drawImage(s.sprite, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
  }

  function drawCursor (ctx, state, time) {
    if (!state.cursorOn) return;
    var pulse = 0.42 + 0.14 * Math.sin(time * 0.004);
    ctx.globalAlpha = pulse;
    ctx.drawImage(state.sprites.anchor, state.cursorX - 10, state.cursorY - 10, 20, 20);
  }

  function drawMeteors (ctx, state) {
    for (var i = 0; i < state.meteors.length; i++) {
      var m = state.meteors[i];
      var alpha = clamp(m.life / m.maxLife, 0, 1);
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = 'rgba(255,246,224,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(m.x - m.vx * 0.045, m.y - m.vy * 0.045);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.drawImage(state.sprites.meteor, m.x - m.size / 2, m.y - m.size / 2, m.size, m.size);
    }
  }

  function drawLabels (ctx, state) {
    if (!state.showLabel) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '11px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < state.constellations.length; i++) {
      var c = state.constellations[i];
      if (!c.label) continue;
      var alpha = clamp(c.life / c.maxLife, 0, 1) * 0.42;
      if (alpha <= 0.01) continue;
      ctx.fillStyle = 'rgba(208,225,255,' + alpha + ')';
      ctx.fillText(c.label, c.cx, c.cy - 16);
    }
    ctx.restore();
  }

  window.bloomRegister('constellation',
    function (ctx, w, h, time, dt, state) {
      if (!state.ready) setup(state);
      var safeDt = Math.min(dt || 0.016, 0.05);
      var cur = readCursor(w, h, time);
      var speed = 0;

      if (state.prevX !== null && state.prevY !== null) {
        var dx = cur.x - state.prevX;
        var dy = cur.y - state.prevY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (cur.on && state.prevOn) {
          // 跨屏/光标瞬移：重置累计距离，避免沿一条长线爆出大量星点
          if (dist > Math.max(w, h) * 0.6) {
            dist = 0;
            state.dustAccum = 0;
            state.anchorAccum = 0;
          } else if (dist > 0.1) {
            speed = dist / Math.max(safeDt, 0.001);

            var dustSteps = Math.min(10, Math.floor((state.dustAccum + dist) / state.dustSpacing));
            if (dustSteps > 0) {
              var dustBefore = state.dustAccum;
              for (var i = 0; i < dustSteps; i++) {
                var dd = state.dustSpacing - dustBefore + i * state.dustSpacing;
                var td = clamp(dd / dist, 0, 1);
                addStar(state, state.prevX + dx * td, state.prevY + dy * td, false);
              }
              state.dustAccum = (state.dustAccum + dist) - dustSteps * state.dustSpacing;
            } else {
              state.dustAccum += dist;
            }

            var anchorSteps = Math.min(2, Math.floor((state.anchorAccum + dist) / ANCHOR_SPACING));
            if (anchorSteps > 0) {
              var anchorBefore = state.anchorAccum;
              for (var j = 0; j < anchorSteps; j++) {
                var ad = ANCHOR_SPACING - anchorBefore + j * ANCHOR_SPACING;
                var ta = clamp(ad / dist, 0, 1);
                addStar(state, state.prevX + dx * ta, state.prevY + dy * ta, true);
              }
              state.anchorAccum = (state.anchorAccum + dist) - anchorSteps * ANCHOR_SPACING;
            } else {
              state.anchorAccum += dist;
            }

            if (state.shootingStars && speed > FAST_SPEED) {
              if (state.meteorCd <= 0) {
                spawnMeteor(state, cur.x, cur.y, dx, dy, speed);
                state.meteorCd = METEOR_COOLDOWN;
              }
            }
          }
        } else {
          state.dustAccum = 0;
          state.anchorAccum = 0;
        }
      }

      state.speed = speed;
      state.meteorCd = Math.max(0, state.meteorCd - safeDt);

      if (speed < STILL_SPEED) {
        state.stillTime += safeDt;
      } else {
        state.stillTime = 0;
      }
      if (state.stillTime >= STILL_TIME) buildConstellation(state);

      if (speed > SCATTER_SPEED && !state.scattered) {
        state.scattered = true;
        scatterConstellations(state);
      } else if (speed < 500) {
        state.scattered = false;
      }

      var i;
      for (i = state.stars.length - 1; i >= 0; i--) {
        var s = state.stars[i];
        s.life -= safeDt;
        if (s.life <= 0) {
          state.stars[i] = state.stars[state.stars.length - 1];
          state.stars.pop();
          continue;
        }
        s.x += s.vx * safeDt;
        s.y += s.vy * safeDt;
        s.vx *= 0.995;
        s.vy *= 0.995;
      }

      for (i = state.meteors.length - 1; i >= 0; i--) {
        var m = state.meteors[i];
        m.life -= safeDt;
        if (m.life <= 0) {
          state.meteors[i] = state.meteors[state.meteors.length - 1];
          state.meteors.pop();
          continue;
        }
        m.x += m.vx * safeDt;
        m.y += m.vy * safeDt;
        m.vx *= 0.988;
        m.vy *= 0.988;
      }

      var fadeMul = state.scattered ? 4 : 1;
      for (i = state.constellations.length - 1; i >= 0; i--) {
        var c = state.constellations[i];
        c.life -= safeDt * fadeMul;
        if (c.life <= 0) {
          state.constellations[i] = state.constellations[state.constellations.length - 1];
          state.constellations.pop();
        }
      }

      state.prevX = cur.x;
      state.prevY = cur.y;
      state.prevOn = cur.on;
      state.cursorX = cur.x;
      state.cursorY = cur.y;
      state.cursorOn = cur.on;

      // ---- 绘制 ----
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawConstellations(ctx, state);
      drawStars(ctx, state, time);
      drawMeteors(ctx, state);
      drawCursor(ctx, state, time);
      ctx.restore();

      drawLabels(ctx, state);
    },
    initFn
  );
})();
