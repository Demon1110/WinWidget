// 光迹藤蔓 - 鼠标轨迹上生长发光藤蔓，沿途绽放光之花，静止后凋零消散
// 与星尘光标的离散粒子不同，藤蔓是连续有机线条 + 花朵生命周期
window.bloomRegister('lightVine',
  function (ctx, w, h, time, dt, state) {
    // -- 懒初始化 / 配置读取 --
    if (!state.init) {
      state.growSpeed = state.growSpeed || 1;
      state.flowerRate = state.flowerRate !== undefined ? state.flowerRate : 0.3;
      state.maxVines = state.maxVines || 8;
      // 解析主色调为 HSL 色相基准
      var hex = state.primaryColor || '#4ade80';
      hex = hex.replace(/^#/, '');
      var r = 74, g = 222, b = 128;
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
      state.hueBase = rgbToHue(r, g, b);

      state.init = true;
      state.vines = [];
      state.mx = null; state.my = null;
      state.prevX = null; state.prevY = null;
      state.speed = 0;
      state.stillTime = 0;
    }

    var MAX_VINES = state.maxVines;
    var GROW_SPEED = state.growSpeed;
    var FLOWER_RATE = state.flowerRate;
    var HUE_BASE = state.hueBase;
    var MIN_DIST = 4;           // 鼠标移动超过此距离才生长
    var STILL_THRESHOLD = 1.0;  // 低于此速度视为静止
    var POINT_LIFE = 3.5;       // 每个藤蔓节点的寿命(秒)
    var FLOWER_LIFE = 4.0;      // 花朵寿命(秒)

    // -- 获取鼠标位置 --
    // 优先：overlay preload 自行轮询（__bloomCursorService），不受主窗口节流影响。
    // 回退：utools / 主窗口注入 bloomCursor / services / 正弦模拟。
    var mx, my, onScreen;
    var point = null;
    if (window.__bloomCursorService && window.__bloomCursorService.getCursorScreenPoint) {
      try { point = window.__bloomCursorService.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.utools && window.utools.getCursorScreenPoint) {
      try { point = window.utools.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.bloomCursor) {
      point = window.bloomCursor;
    }
    if (!point && window.services && window.services.getCursorScreenPoint) {
      try { point = window.services.getCursorScreenPoint(); } catch (e) { point = null; }
    }

    if (point) {
      var ox = window.screenX;
      var oy = window.screenY;
      mx = point.x - ox;
      my = point.y - oy;
      onScreen = (mx >= -30 && mx < w + 30 && my >= -30 && my < h + 30);
    } else {
      // 回退：正弦曲线模拟
      mx = w / 2 + Math.cos(time / 700) * w * 0.3;
      my = h / 2 + Math.sin(time / 550) * h * 0.25;
      onScreen = true;
    }

    // -- 计算鼠标速度 --
    var speed = 0;
    if (state.prevX !== null) {
      var sdx = mx - state.prevX;
      var sdy = my - state.prevY;
      speed = Math.sqrt(sdx * sdx + sdy * sdy);
    }
    state.speed = state.speed * 0.7 + speed * 0.3;
    var spd = state.speed;
    state.prevX = mx; state.prevY = my;

    // -- 静止计时 --
    if (spd < STILL_THRESHOLD) {
      state.stillTime += dt;
    } else {
      state.stillTime = 0;
    }

    // -- 生长藤蔓（移动时）--
    if (onScreen && spd > STILL_THRESHOLD) {
      // 当前活跃藤蔓：vines 数组最后一条
      var currentVine = state.vines.length > 0 ? state.vines[state.vines.length - 1] : null;

      // 需要新建藤蔓的情况：没有活跃藤蔓 / 距离上次生长点太远 / 藤蔓已枯萎
      var needNewVine = !currentVine || currentVine.dead;

      if (!needNewVine) {
        // 检查距离最后一个点的距离
        var lastPt = currentVine.points[currentVine.points.length - 1];
        var dist = Math.sqrt((mx - lastPt.x) * (mx - lastPt.x) + (my - lastPt.y) * (my - lastPt.y));
        if (dist > 80) needNewVine = true; // 鼠标跳跃太远，断开旧藤蔓开新的
      }

      if (needNewVine) {
        // 控制藤蔓总数
        if (state.vines.length >= MAX_VINES) {
          // 移除最老的已死藤蔓，或杀掉最老的活藤蔓
          state.vines.shift();
        }
        currentVine = {
          points: [],
          flowers: [],
          hue: HUE_BASE + (Math.random() - 0.5) * 40,
          age: 0,
          dead: false,
          growTime: time
        };
        state.vines.push(currentVine);
      }

      // 生长：追加新点
      var cv = currentVine;
      var lastP = cv.points.length > 0 ? cv.points[cv.points.length - 1] : null;
      var stepDist = lastP ? Math.sqrt((mx - lastP.x) * (mx - lastP.x) + (my - lastP.y) * (my - lastP.y)) : MIN_DIST + 1;

      if (stepDist >= MIN_DIST) {
        // 粗细由速度决定：越快越粗
        var thickness = Math.min(1.5 + spd * 0.08, 5);
        cv.points.push({
          x: mx + (Math.random() - 0.5) * 2,
          y: my + (Math.random() - 0.5) * 2,
          age: 0,
          thickness: thickness
        });

        // 随机生花
        if (Math.random() < FLOWER_RATE * 0.15 && cv.points.length > 2) {
          var fp = cv.points[cv.points.length - 1];
          cv.flowers.push({
            x: fp.x,
            y: fp.y,
            hue: cv.hue + (Math.random() - 0.5) * 60,
            bloom: 0,
            life: FLOWER_LIFE,
            maxLife: FLOWER_LIFE,
            size: 2 + Math.random() * 3
          });
        }

        // 限制单条藤蔓的点数（防止内存爆炸）
        if (cv.points.length > 120) {
          cv.points.splice(0, cv.points.length - 120);
        }
      }
    }

    // -- 更新藤蔓老化 --
    for (var vi = state.vines.length - 1; vi >= 0; vi--) {
      var vine = state.vines[vi];
      vine.age += dt;

      // 老化每个点
      for (var pi = 0; pi < vine.points.length; pi++) {
        vine.points[pi].age += dt;
      }

      // 移除过老的点（从头部开始）
      while (vine.points.length > 0 && vine.points[0].age > POINT_LIFE) {
        vine.points.shift();
      }

      // 更新花朵
      for (var fi = vine.flowers.length - 1; fi >= 0; fi--) {
        var fl = vine.flowers[fi];
        fl.life -= dt;
        // 花朵生命周期：前 30% 含苞，30-60% 盛开，60-100% 凋零
        var lifeRatio = 1 - fl.life / fl.maxLife;
        if (lifeRatio < 0.3) {
          fl.bloom = lifeRatio / 0.3 * 0.5; // 含苞期
        } else if (lifeRatio < 0.6) {
          fl.bloom = 0.5 + (lifeRatio - 0.3) / 0.3 * 0.5; // 盛开
        } else {
          fl.bloom = 1 - (lifeRatio - 0.6) / 0.4; // 凋零
        }
        if (fl.life <= 0) {
          vine.flowers.splice(fi, 1);
        }
      }

      // 静止时加速花朵凋零（花朵更快盛开然后枯萎）
      if (state.stillTime > 0.5) {
        for (var fi2 = 0; fi2 < vine.flowers.length; fi2++) {
          vine.flowers[fi2].life -= dt * 0.8;
        }
      }

      // 藤蔓死亡：没有点也没有花了
      if (vine.points.length === 0 && vine.flowers.length === 0) {
        vine.dead = true;
        state.vines.splice(vi, 1);
      }
    }

    // -- 渲染 --
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 绘制藤蔓线条
    for (var vi2 = 0; vi2 < state.vines.length; vi2++) {
      var v = state.vines[vi2];
      var pts = v.points;
      if (pts.length < 2) continue;

      // 分段绘制以实现粗细和颜色渐变
      for (var si = 1; si < pts.length; si++) {
        var p1 = pts[si - 1];
        var p2 = pts[si];
        var ageRatio = Math.max(0, 1 - p2.age / POINT_LIFE);
        var alpha = ageRatio * 0.7;
        var thick = p2.thickness * ageRatio;

        // 色相沿藤蔓流转
        var segHue = v.hue + si * 1.5;

        ctx.strokeStyle = 'hsla(' + segHue + ', 75%, 60%, ' + alpha + ')';
        ctx.lineWidth = thick;
        ctx.beginPath();

        // 用二次贝塞尔平滑：取相邻点中点作为控制点
        if (si < pts.length - 1) {
          var p3 = pts[si + 1];
          var mx2 = (p2.x + p3.x) / 2;
          var my2 = (p2.y + p3.y) / 2;
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(p2.x, p2.y, mx2, my2);
        } else {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
      }

      // 藤蔓发光层（更宽更透明，营造辉光）
      for (var si2 = 1; si2 < pts.length; si2++) {
        var gp1 = pts[si2 - 1];
        var gp2 = pts[si2];
        var gAge = Math.max(0, 1 - gp2.age / POINT_LIFE);
        var gAlpha = gAge * 0.15;
        var gThick = gp2.thickness * gAge * 3;

        ctx.strokeStyle = 'hsla(' + (v.hue + si2 * 1.5) + ', 80%, 65%, ' + gAlpha + ')';
        ctx.lineWidth = gThick;
        ctx.beginPath();
        ctx.moveTo(gp1.x, gp1.y);
        ctx.lineTo(gp2.x, gp2.y);
        ctx.stroke();
      }
    }

    // 2. 绘制花朵
    for (var vi3 = 0; vi3 < state.vines.length; vi3++) {
      var vd = state.vines[vi3];
      for (var fi3 = 0; fi3 < vd.flowers.length; fi3++) {
        var f = vd.flowers[fi3];
        if (f.bloom <= 0.01) continue;

        var fSize = f.size * f.bloom;
        var fAlpha = f.bloom * 0.8;

        // 花瓣辐射（5 瓣）
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.hue * 0.1);

        for (var pet = 0; pet < 5; pet++) {
          var angle = (pet / 5) * Math.PI * 2;
          var px = Math.cos(angle) * fSize * 0.6;
          var py = Math.sin(angle) * fSize * 0.6;

          ctx.beginPath();
          ctx.arc(px, py, fSize * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(' + f.hue + ', 85%, 70%, ' + (fAlpha * 0.4) + ')';
          ctx.fill();
        }
        ctx.restore();

        // 花心（两层 hsla 圆替代渐变，消除每帧 createRadialGradient）
        ctx.beginPath();
        ctx.arc(f.x, f.y, fSize * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + f.hue + ', 80%, 65%, ' + (fAlpha * 0.5) + ')';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(f.x, f.y, fSize * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + f.hue + ', 90%, 85%, ' + fAlpha + ')';
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    // -- 辅助函数：RGB 转 HSL 色相 --
    function rgbToHue(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var h = 0;
      var d = max - min;
      if (d === 0) return 0;
      if (max === r) {
        h = ((g - b) / d) % 6;
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
      return h;
    }
  },
  function (state) {
    state.init = false;
    state.vines = null;
    state.mx = null;
    state.my = null;
    state.prevX = null;
    state.prevY = null;
    state.speed = 0;
    state.stillTime = 0;
  }
);
