// 复古网格 - 80 年代赛博复古波：条纹落日悬在地平线，紫色网格向脚下一路铺开
// （官网文案里的「复古网格」，原版 38 款目录里没有它，这里按同一套绘制约定补上）
window.bloomRegister('retroGrid',
  function (ctx, w, h, time, dt, state) {
    if (!state.init) {
      state.init = true;
      state.stars = [];
      var count = Math.round((w * h) / 14000);
      for (var i = 0; i < count; i++) {
        state.stars.push({
          x: Math.random() * w,
          y: Math.random(),
          r: 0.4 + Math.random() * 1.1,
          ph: Math.random() * 6.28,
          sp: 0.6 + Math.random() * 1.4
        });
      }
    }

    var horizon = h * 0.62;
    var cx = w / 2;
    var sunR = Math.min(w, h) * 0.17;
    var sunX = cx;
    var sunY = horizon - sunR * 0.45;

    // ── 天空 ──
    // 这一页是叠在桌面上的透明画布：所有铺底都要带 alpha，否则会把桌面和图标整块盖住。
    // 保留霓虹紫的色相层次，但压低不透明度，让壁纸与图标从底色里透出来。
    var sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, 'rgba(7,2,15,0.28)');
    sky.addColorStop(0.55, 'rgba(29,7,51,0.24)');
    sky.addColorStop(1, 'rgba(74,15,77,0.20)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // ── 星光 ──
    for (var s = 0; s < state.stars.length; s++) {
      var st = state.stars[s];
      var tw = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time / 900 * st.sp + st.ph));
      ctx.fillStyle = 'rgba(255,255,255,' + tw.toFixed(3) + ')';
      ctx.fillRect(st.x, st.y * horizon * 0.92, st.r, st.r);
    }

    // ── 落日：本体 + 条纹 + 光晕 ──
    var halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 2.4);
    halo.addColorStop(0, 'rgba(255,110,160,0.20)');
    halo.addColorStop(1, 'rgba(255,110,160,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sunX - sunR * 2.4, sunY - sunR * 2.4, sunR * 4.8, sunR * 4.8);

    var body = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    body.addColorStop(0, '#ffe66b');
    body.addColorStop(0.45, '#ff9f43');
    body.addColorStop(1, '#ff2d78');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // 复古条纹：越靠下越宽，像被地平线切开的太阳。
    // 条纹裁剪进太阳圆内——否则矩形条纹会伸出圆外，形成一个突兀的黑框。
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.clip();
    for (var b = 0; b < 9; b++) {
      var t2 = b / 9;
      var gap = sunY + sunR * (-0.25 + t2 * 1.3);
      var thick = sunR * (0.04 + t2 * 0.10);
      ctx.fillStyle = 'rgba(18,3,32,' + (0.55 + t2 * 0.35).toFixed(3) + ')';
      ctx.fillRect(sunX - sunR - 2, gap, sunR * 2 + 4, thick);
    }
    ctx.restore();

    // ── 地面 ──
    var ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, 'rgba(42,3,56,0.24)');
    ground.addColorStop(1, 'rgba(8,1,13,0.18)');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    // ── 网格 ──
    var span = h - horizon;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, span);
    ctx.clip();
    ctx.lineWidth = 1;

    // 横向：从地平线往脚下加速推近
    var lanes = 14;
    var scroll = (time / 1500) % 1;
    for (var i = 0; i < lanes; i++) {
      var p = (i + scroll) / lanes;
      var y = horizon + span * (p * p);
      var a = 0.10 + 0.55 * p;
      ctx.strokeStyle = 'rgba(255,45,120,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 纵向：从消失点放射出去的线
    for (var v = -16; v <= 16; v++) {
      ctx.strokeStyle = 'rgba(150,60,255,0.38)';
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(cx + v * w * 0.085, h);
      ctx.stroke();
    }
    ctx.restore();

    // ── 地平线：一道青色光缝，把天和地焊在一起 ──
    var seam = ctx.createLinearGradient(0, horizon - 6, 0, horizon + 6);
    seam.addColorStop(0, 'rgba(0,255,238,0)');
    seam.addColorStop(0.5, 'rgba(0,255,238,0.55)');
    seam.addColorStop(1, 'rgba(0,255,238,0)');
    ctx.fillStyle = seam;
    ctx.fillRect(0, horizon - 6, w, 12);
  },
  function (state) {
    state.init = false;
    state.stars = null;
  }
);
