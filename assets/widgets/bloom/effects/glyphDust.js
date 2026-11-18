// 星尘成字 - DeepSeek 官网 harness 页同款 GPU 粒子方案的移植与改造：
// 把用户配置的文字采样成粒子星阵，入场从散落球壳汇聚成字，静则成字、动则成尘。
// 鼠标交互三层：斥力场（立方衰减 + 噪声旋转的推挤方向）、跟随光斑（亮度按光距衰减）、
// 快速移动激发整体扰动（波纹增强、字形 loosening），停下后归于平静。
//
// 性能要点（与 nebula 的 GPU 化同一套路）：
// - 全部动画在顶点着色器完成，CPU 每帧只更新十几个 uniform
// - 随机量（散开位置、相位）在 init 时 CPU 预计算进 attribute，
//   规避 mediump 渲染器下 fract(sin(大数)) GPU hash 的精度退化
// - InstancedMesh 单 draw call；fps 锁 30（慢速氛围动画足够）
(function () {

window.bloomRegister3D('glyphDust', {
  fps: 30,
  init(scene, camera, state) {
    state.text = state.text || '玩出花';
    state.glyphColor = state.glyphColor || '#7fd4ff';
    state.density = state.density || 70;        // 采样网格行数
    state.mouseRadius = state.mouseRadius || 4;
    state.mouseStrength = state.mouseStrength !== undefined ? state.mouseStrength : 0.9;
    state.waveAmount = state.waveAmount !== undefined ? state.waveAmount : 0.06;

    camera.position.set(0, 0, 18);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    state._start = performance.now();
    state._smx = null; state._smy = null;      // 平滑后的鼠标世界坐标
    state._prevX = null; state._prevY = null;
    state._disturb = 0;                        // 鼠标速度激发的扰动能量
    state._mStrength = 0;                      // 斥力强度（指数平滑，离屏淡出）

    // ---- 文字采样：离屏 canvas 逐像素取亮度 → 粒子（共享采样器） ----
    // 世界宽度上限 = z=0 平面可视宽度的 92%（fov50、z=18 时视口高约 16.8，宽 = 高 × aspect）
    const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
    const data = window.bloomSampleGlyph(state.text, state.density, viewH * camera.aspect * 0.92);
    state._count = data.count;

    // 粒子尺寸略小于采样间距（spacing ≈ 0.12），笔画呈连贯的点阵而非离散圆点
    const geo = new THREE.BoxGeometry(0.085, 0.085, 0.03);
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(data.positions, 3));
    geo.setAttribute('aScattered', new THREE.InstancedBufferAttribute(data.scattered, 3));
    geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(data.opacities, 1));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(data.rands, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAssembly: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uMouseRadius: { value: state.mouseRadius },
        uMouseStrength: { value: 0 },
        uDisturb: { value: 0 },
        uWaveAmount: { value: state.waveAmount },
        uLightPos: { value: new THREE.Vector3(0, 1.2, 6) },
        uLightRange: { value: 12 },
        uColor: { value: new THREE.Color(state.glyphColor) }
      },
      vertexShader: `
        attribute vec3 aCenter;
        attribute vec3 aScattered;
        attribute float aOpacity;
        attribute float aRand;

        uniform float uTime;
        uniform float uAssembly;
        uniform vec2 uMouse;
        uniform float uMouseRadius;
        uniform float uMouseStrength;
        uniform float uDisturb;
        uniform float uWaveAmount;
        uniform vec3 uLightPos;
        uniform float uLightRange;

        varying float vOpacity;
        varying float vLight;
        varying vec3 vWorldPos;

        void main() {
          vOpacity = aOpacity;

          // 入场：从散落球壳位置汇聚到文字网格（group 无变换，local 即 world）
          vec3 center = mix(aScattered, aCenter, uAssembly);

          // 入场未完成时自由漂浮
          float free = 1.0 - uAssembly;
          center += vec3(
            sin(uTime * 0.6 + aRand * 21.0),
            cos(uTime * 0.5 + aRand * 17.0),
            sin(uTime * 0.7 + aRand * 9.0)
          ) * 0.5 * free;

          // 闲置微扰：鼠标扰动越大粒子越"躁"，静止后归于平整易读
          float loose = 0.35 + uDisturb * 0.8;
          center.x += sin(uTime * 0.5 + aRand * 6.28) * 0.05 * loose;
          center.y += cos(uTime * 0.42 + aRand * 12.6) * 0.05 * loose;
          center.z += sin(uTime * 0.36 + aRand * 3.1) * 0.06 * loose;

          // 同心波纹（z 向涟漪，字心淡出避免"隆起"畸变）
          float dCtr = length(aCenter.xy);
          float waveFade = smoothstep(0.0, 3.0, dCtr);
          center.z += sin(dCtr * 3.0 - uTime * 1.5)
            * uWaveAmount * (1.0 + uDisturb * 2.5) * waveFade * uAssembly;

          // 鼠标斥力场：立方衰减软边 + 每粒子噪声旋转的推挤方向（漩涡感）
          vec2 toMouse = center.xy - uMouse;
          float md = length(toMouse);
          if (md < uMouseRadius && md > 0.001) {
            float t = 1.0 - md / uMouseRadius;
            float force = t * t * t * uMouseStrength * uAssembly;
            vec2 dir = toMouse / md;
            float ang = sin(aRand * 6.28 + uTime * 0.5) * 0.8;
            float ca = cos(ang);
            float sa = sin(ang);
            vec2 push = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca);
            center.xy += push * force * 2.0;
            center.z += sin(aRand * 40.0 + uTime) * force * 0.8;
          }

          // 整体呼吸浮动（量级极小，不影响鼠标场对位）
          center.y += sin(uTime * 0.4) * 0.12;

          // 跟随光斑：世界空间虚拟灯，亮度按距离平方衰减（shadeMin/shadeMax 烘焙进 shader）
          vWorldPos = center;
          float lightDist = distance(center, uLightPos);
          float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
          vLight = mix(0.3, 2.6, lit * lit);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        varying float vLight;
        varying vec3 vWorldPos;

        uniform float uTime;
        uniform vec3 uColor;

        void main() {
          float dist = length(vWorldPos.xy);
          float glow = smoothstep(8.0, 0.0, dist) * 0.3;

          float alpha = vOpacity * (0.55 + glow);
          float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
          alpha *= shimmer * min(vLight, 1.0);

          vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
          // 受光面带一点暖色偏移
          color = mix(color, color * vec3(1.07, 1.02, 0.94), clamp(vLight - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const mesh = new THREE.InstancedMesh(geo, mat, data.count);
    // 着色器直接读 aCenter，instanceMatrix 仅作为占位（全部置单位矩阵）
    const identity = new THREE.Matrix4();
    for (let i = 0; i < data.count; i++) mesh.setMatrixAt(i, identity);
    mesh.frustumCulled = false; // 顶点着色器会大位移散开，交给 GPU
    scene.add(mesh);
    state._mesh = mesh;
    state._mat = mat;
  },

  update(scene, camera, time, dt, state) {
    const t = (time - state._start) / 1000;
    // uTime 周期回绕（约 100 分钟）：防长时间运行后大参数正弦精度劣化；
    // 回绕瞬间各相位项会有一次极轻微跳变，可接受
    state._mat.uniforms.uTime.value = t % 6000;
    const asm = Math.min(1, t / 2.5);
    state._mat.uniforms.uAssembly.value = 1 - Math.pow(1 - asm, 3);

    // -- 鼠标坐标多级回退（与星尘光标/光迹藤蔓同一链路） --
    let point = null;
    if (window.__bloomCursorService && window.__bloomCursorService.getCursorScreenPoint) {
      try { point = window.__bloomCursorService.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.utools && window.utools.getCursorScreenPoint) {
      try { point = window.utools.getCursorScreenPoint(); } catch (e) { point = null; }
    }
    if (!point && window.bloomCursor) {
      point = window.bloomCursor;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    // 相机在 z=18、fov 50 处看向原点，z=0 平面的可视世界范围
    const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
    const viewW = viewH * camera.aspect;

    let tx = 0, ty = 0, onScreen = false;
    if (point && typeof point.x === 'number') {
      const lx = point.x - window.screenX;
      const ly = point.y - window.screenY;
      onScreen = lx >= 0 && lx < w && ly >= 0 && ly < h;
      tx = (lx / w - 0.5) * viewW;
      ty = -(ly / h - 0.5) * viewH;
    } else {
      // 无鼠标来源：正弦巡游模拟（与 2D 鼠标特效的回退一致）
      tx = Math.cos(t * 0.5) * viewW * 0.3;
      ty = Math.sin(t * 0.8) * viewH * 0.25;
      onScreen = true;
    }

    // -- 平滑与能量：位置 lerp 拖尾 + 扰动能量随速度激发、时间衰减 --
    if (state._smx === null) {
      state._smx = tx; state._smy = ty;
    } else {
      state._smx += (tx - state._smx) * 0.2;
      state._smy += (ty - state._smy) * 0.2;
    }
    if (state._prevX !== null && onScreen) {
      const dx = state._smx - state._prevX;
      const dy = state._smy - state._prevY;
      const spd = Math.sqrt(dx * dx + dy * dy);
      state._disturb = Math.min(2.5, state._disturb + Math.min(spd, 60) * 0.004);
    }
    state._prevX = state._smx; state._prevY = state._smy;
    state._disturb *= Math.exp(-dt * 1.4);

    // 斥力强度指数平滑：鼠标离屏（或速度归零路径外）柔和淡出
    const target = onScreen ? state.mouseStrength : 0;
    state._mStrength += (target - state._mStrength) * (1 - Math.pow(0.05, dt));

    const u = state._mat.uniforms;
    u.uMouse.value.set(state._smx, state._smy);
    u.uMouseStrength.value = state._mStrength;
    u.uDisturb.value = state._disturb;
    // 光斑跟随鼠标（水平全跟随、垂直半跟随），营造扫光效果
    u.uLightPos.value.set(state._smx, 1.2 + state._smy * 0.3, 6);
  }
});

})();
