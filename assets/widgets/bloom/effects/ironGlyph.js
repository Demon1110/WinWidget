// 铁画银钩 - 万枚磁性铁屑凝成书法：平时各自微颤、排列成文字，
// 鼠标如磁石，靠近的屑片转向磁场切向、围出涡旋状磁力线并向磁极聚集立起，
// 离开后"咔哒"归位，字重新凝出。与星尘成字的"推开"相反，这里是"转向 + 环绕"。
//
// 性能：与 glyphDust 同一管线（共享采样器 / InstancedMesh 单 draw call / 全顶点着色器动画 /
// 随机量 CPU 预计算规避 mediump hash 退化 / fps 30）。新数学只有一步实例级旋转：
// 屑片朝向角 = mix(静置颤动角, 磁场切向角, 接近度)，线段朝向本身成为新的可视信息维度。
(function () {

window.bloomRegister3D('ironGlyph', {
  fps: 30,
  init(scene, camera, state) {
    state.text = state.text || '铁画银钩';
    state.glyphColor = state.glyphColor || '#9fb6cc';
    state.density = state.density || 70;
    state.mouseRadius = state.mouseRadius || 4;
    state.pull = state.pull !== undefined ? state.pull : 0.9;        // 磁力强度（吸引）
    state.quiver = state.quiver !== undefined ? state.quiver : 0.8;    // 静置颤动幅度

    camera.position.set(0, 0, 18);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    state._start = performance.now();
    state._smx = null; state._smy = null;
    state._mPull = 0;

    // 细长屑片：长 0.15、厚 0.018，朝向由顶点着色器逐实例旋转
    const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
    const data = window.bloomSampleGlyph(state.text, state.density, viewH * camera.aspect * 0.92);
    state._count = data.count;

    const geo = new THREE.BoxGeometry(0.15, 0.018, 0.018);
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
        uPull: { value: 0 },
        uQuiver: { value: state.quiver },
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
        uniform float uPull;
        uniform float uQuiver;
        uniform vec3 uLightPos;
        uniform float uLightRange;

        varying float vOpacity;
        varying float vLight;
        varying vec3 vWorldPos;

        void main() {
          vOpacity = aOpacity;

          vec3 center = mix(aScattered, aCenter, uAssembly);

          // 入场未完成时自由漂浮
          float free = 1.0 - uAssembly;
          center += vec3(
            sin(uTime * 0.6 + aRand * 21.0),
            cos(uTime * 0.5 + aRand * 17.0),
            sin(uTime * 0.7 + aRand * 9.0)
          ) * 0.5 * free;

          // 静置颤动：铁屑的 restless 呼吸感
          center.x += sin(uTime * 0.9 + aRand * 40.0) * 0.03 * uQuiver;
          center.y += cos(uTime * 0.7 + aRand * 30.0) * 0.03 * uQuiver;

          // 磁石：近处屑片被轻微吸引并向"观察者"方向立起（磁流体尖峰）
          vec2 toMouse = center.xy - uMouse;
          float md = length(toMouse);
          float prox = smoothstep(uMouseRadius, uMouseRadius * 0.15, md);
          float force = prox * prox * uPull * uAssembly;
          center.xy -= toMouse * force * 0.25;
          center.z += prox * force * 1.2;

          // 朝向：远处沿静置角微颤，近处转向磁场切向 → 围绕光标排出涡旋磁力线
          float idleAng = aRand * 6.28 + sin(uTime * 0.8 + aRand * 9.4) * 0.35;
          float fieldAng = atan(center.y - uMouse.y, center.x - uMouse.x) + 1.5708;
          float ang = mix(idleAng, fieldAng, prox);
          float ca = cos(ang);
          float sa = sin(ang);
          vec3 local = vec3(
            position.x * ca - position.y * sa,
            position.x * sa + position.y * ca,
            position.z
          );

          // 整体呼吸浮动（量级极小，不影响磁场对位）
          center.y += sin(uTime * 0.4) * 0.1;

          vWorldPos = center;
          float lightDist = distance(center, uLightPos);
          float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
          vLight = mix(0.35, 2.4, lit * lit);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + local, 1.0);
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

          float alpha = vOpacity * (0.6 + glow);
          float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
          alpha *= shimmer * min(vLight, 1.0);

          vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
          color = mix(color, color * vec3(1.05, 1.02, 0.96), clamp(vLight - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const mesh = new THREE.InstancedMesh(geo, mat, data.count);
    const identity = new THREE.Matrix4();
    for (let i = 0; i < data.count; i++) mesh.setMatrixAt(i, identity);
    mesh.frustumCulled = false;
    scene.add(mesh);
    state._mesh = mesh;
    state._mat = mat;
  },

  update(scene, camera, time, dt, state) {
    const t = (time - state._start) / 1000;
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
      tx = Math.cos(t * 0.5) * viewW * 0.3;
      ty = Math.sin(t * 0.8) * viewH * 0.25;
      onScreen = true;
    }

    // 位置 lerp 拖尾（比星尘成字更黏一点：磁石有"拽"的惯性）
    if (state._smx === null) {
      state._smx = tx; state._smy = ty;
    } else {
      state._smx += (tx - state._smx) * 0.15;
      state._smy += (ty - state._smy) * 0.15;
    }

    // 磁力强度指数平滑：离屏柔和淡出
    const target = onScreen ? state.pull : 0;
    state._mPull += (target - state._mPull) * (1 - Math.pow(0.05, dt));

    const u = state._mat.uniforms;
    u.uMouse.value.set(state._smx, state._smy);
    u.uPull.value = state._mPull;
    u.uLightPos.value.set(state._smx, 1.2 + state._smy * 0.3, 6);
  }
});

})();
