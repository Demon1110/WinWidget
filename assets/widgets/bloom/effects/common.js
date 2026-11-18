window.bloomCreateSoftParticleTexture = function(size, inner) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(inner || 0.15, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
};

window.bloomCreateGradientCubeTexture = function() {
  const size = 128;
  const colors = [
    ['#050810', '#101525'], // px
    ['#050810', '#101525'], // nx
    ['#152035', '#050810'], // py
    ['#000000', '#050810'], // ny
    ['#050810', '#101525'], // pz
    ['#050810', '#101525']  // nz
  ];

  const canvases = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, colors[i][0]);
    g.addColorStop(1, colors[i][1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    for (let j = 0; j < 20; j++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    canvases.push(c);
  }

  const cubeTexture = new THREE.CubeTexture(canvases);
  cubeTexture.needsUpdate = true;
  return cubeTexture;
};

// 文字 → 粒子采样（文字类 3D 特效共享）
// 逐字符绘制并记录每个字符的包围区间，返回 cluster 归属（供字火烟花的单字爆炸定位）
// maxWorldW：文字世界宽度上限，超宽文字自动缩字号 + 压缩 spacing，保证完整落在屏幕内
window.bloomSampleGlyph = function (text, density, maxWorldW) {
  const lines = String(text).split('\n').filter(function (l) { return l.trim().length > 0; }).slice(0, 4);
  if (lines.length === 0) lines.push('玩出花');
  const lineCount = lines.length;
  const lineFactor = 1.3;
  const rows = Math.max(24, Math.round(density));
  const fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif';

  const probe = document.createElement('canvas').getContext('2d');
  let fontPx = Math.max(8, Math.floor(rows / (lineCount * lineFactor)));
  probe.font = fontPx + 'px ' + fontFamily;
  let textW = 1;
  lines.forEach(function (l) { textW = Math.max(textW, probe.measureText(l).width); });

  // 字数多导致采样画布超宽时缩字号：把画布宽度压回上限，粒子总量可控
  const W_MAX = 560;
  if (textW > W_MAX) {
    fontPx = Math.max(6, Math.floor(fontPx * W_MAX / textW));
    probe.font = fontPx + 'px ' + fontFamily;
    textW = 1;
    lines.forEach(function (l) { textW = Math.max(textW, probe.measureText(l).width); });
  }

  const W = Math.ceil(textW) + 4;
  const H = Math.ceil(fontPx * lineFactor * lineCount) + 4;

  // 逐字符绘制（textAlign left + 画笔推进），记录每字符的 x 区间与所属行
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = fontPx + 'px ' + fontFamily;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lineRanges = [];   // 每行的字符区间列表 [{x0,x1,cluster}]
  let clusterId = 0;
  lines.forEach(function (line, li) {
    const lineW = probe.measureText(line).width;
    let pen = (W - lineW) / 2;
    const cy = (li + 0.5) * fontPx * lineFactor + 2;
    const ranges = [];
    for (const ch of line) {
      const cw = probe.measureText(ch).width;
      if (ch.trim()) {
        ctx.fillText(ch, pen, cy);
        ranges.push({ x0: pen, x1: pen + cw, cluster: clusterId });
        clusterId++;
      }
      pen += cw;
    }
    lineRanges.push(ranges);
  });
  const img = ctx.getImageData(0, 0, W, H).data;

  // 缩放取"高度占视口一半"与"宽度不超视口上限"的较小者，长文字自动整体缩小
  const spacing = Math.min(8.5 / H, maxWorldW / W);
  const positions = [], scattered = [], opacities = [], rands = [], clusters = [];
  for (let y = 0; y < H; y++) {
    // 该像素行所属的文字行
    const li = Math.min(lineCount - 1, Math.max(0, Math.floor((y - 2) / (fontPx * lineFactor))));
    const ranges = lineRanges[li] || [];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114) / 255;
      if (lum <= 0.25) continue;
      // 定位字符簇（每行字符数有限，线性扫描即可）
      let cluster = -1;
      for (let r = 0; r < ranges.length; r++) {
        if (x >= ranges[r].x0 && x < ranges[r].x1) { cluster = ranges[r].cluster; break; }
      }
      if (cluster < 0) cluster = 0;
      positions.push((x - W / 2) * spacing, (H / 2 - y) * spacing, 0);
      opacities.push(0.35 + lum * 0.65);
      rands.push(Math.random());
      clusters.push(cluster);
      // 散开位置：椭球壳随机（入场前 + 汇聚的能量来源）
      const a = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const rr = 6 + Math.random() * 4;
      scattered.push(
        rr * Math.sin(ph) * Math.cos(a),
        rr * Math.sin(ph) * Math.sin(a) * 0.7,
        rr * Math.cos(ph) * 0.6
      );
    }
  }
  return {
    positions: new Float32Array(positions),
    scattered: new Float32Array(scattered),
    opacities: new Float32Array(opacities),
    rands: new Float32Array(rands),
    clusters: new Float32Array(clusters),
    clusterCount: clusterId,
    count: opacities.length
  };
};
