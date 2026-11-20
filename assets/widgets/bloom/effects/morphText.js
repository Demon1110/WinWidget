// 千字流转 - 粒子在多段文字之间蜿蜒变形：每个粒子以自己的相位延迟出发，
// 沿弧线溪流流向下一个字，一场永不停歇的墨水迁徙。
//
// 实现要点：双目标集插值——几何体带 aCenterA / aCenterB 两组文字目标，
// uMix 0→1 完成一次变形；变形完成后 CPU 把 B 拷进 A、写入新的下一字
// （每轮仅一次约百 KB 的缓冲写入，帧内开销可忽略）。粒子出发次序由
// aRand 决定（stagger），变形时按 sin(π·p) 抬出弧线，形成溪流般的群体迁徙。
// 采样/汇聚/鼠标斥力/光斑跟随与 glyphDust 同一管线，fps 30。
(function () {

window.bloomRegister3D('morphText', {
  fps: 30,
  init(scene, camera, state) {
    // 自定义文本（2-10 字）按字符拆成逐字流转的序列；未配置时用默认多词
    if (state.text && !state.words) {
      state.words = Array.from(state.text).join('\n');
    }
    state.words = state.words || '玩出花\n万物皆粒子\n静水流深';
    state.glyphColor = state.glyphColor || '#8ef0c8';
    state.density = state.density || 60;
    state.holdSec = state.holdSec || 4;          // 每个字停留时长
    state.morphDur = state.morphDur || 1.6;      // 变形时长（固定）
    state.mouseRadius = state.mouseRadius || 4;
    state.mouseStrength = state.mouseStrength !== undefined ? state.mouseStrength : 0.8;

    camera.position.set(0, 0, 18);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    state._start = performance.now();
    state._smx = null; state._smy = null;
    state._prevX = null; state._prevY = null;
    state._mStrength = 0;

    // -- 逐词采样，统一粒子总数 N（不足的词按 stride 重复采样点并加抖动） --
    const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
    const maxWorldW = viewH * camera.aspect * 0.92;
    const wordLines = String(state.words).split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; }).slice(0, 12);
    if (wordLines.length === 0) wordLines.push('玩出花');
    state._wordList = wordLines;
    state._density = state.density;

    const samples = wordLines.map(function (w) {
      return window.bloomSampleGlyph(w, state.density, maxWorldW);
    });
    let N = 0;
    samples.forEach(function (s) { N = Math.max(N, s.count); });
    N = Math.min(N, 6000);
    state._N = N;

    // 每粒子随机量：统一一份（槽位抖动与 shader 相位共用）
    const rands = new Float32Array(N);
    for (let i = 0; i < N; i++) rands[i] = Math.random();

    const scatter = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const s0 = samples[0];
      const j = Math.floor(i * s0.count / N) * 3;
      scatter[i * 3] = s0.scattered[j];
      scatter[i * 3 + 1] = s0.scattered[j + 1];
      scatter[i * 3 + 2] = s0.scattered[j + 2];
    }
    const opA = wordOpacity(samples[0], N);
    const opB = wordOpacity(samples[1 % samples.length], N);

    state._posA = paddedSample(samples[0], N, rands);
    state._posB = paddedSample(samples[1 % samples.length], N, rands);
    state._wordIdx = 0;

    const geo = new THREE.BoxGeometry(0.085, 0.085, 0.03);
    geo.setAttribute('aCenterA', new THREE.InstancedBufferAttribute(state._posA, 3));
    geo.setAttribute('aCenterB', new THREE.InstancedBufferAttribute(state._posB, 3));
    geo.setAttribute('aOpA', new THREE.InstancedBufferAttribute(opA, 1));
    geo.setAttribute('aOpB', new THREE.InstancedBufferAttribute(opB, 1));
    geo.setAttribute('aScattered', new THREE.InstancedBufferAttribute(scatter, 3));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAssembly: { value: 0 },
        uMix: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uMouseRadius: { value: state.mouseRadius },
        uMouseStrength: { value: 0 },
        uLightPos: { value: new THREE.Vector3(0, 1.2, 6) },
        uLightRange: { value: 12 },
        uColor: { value: new THREE.Color(state.glyphColor) }
      },
      vertexShader: `
        attribute vec3 aCenterA;
        attribute vec3 aCenterB;
        attribute float aOpA;
        attribute float aOpB;
        attribute vec3 aScattered;
        attribute float aRand;

        uniform float uTime;
        uniform float uAssembly;
        uniform float uMix;
        uniform vec2 uMouse;
        uniform float uMouseRadius;
        uniform float uMouseStrength;
        uniform vec3 uLightPos;
        uniform float uLightRange;

        varying float vOpacity;
        varying float vLight;
        varying vec3 vWorldPos;

        void main() {
          // 粒子按 aRand 次序出发（stagger），变形呈现溪流般的群体迁徙
          float stagger = clamp((uMix - aRand * 0.35) / 0.65, 0.0, 1.0);
          float p = smoothstep(0.0, 1.0, stagger);

          vec3 center = mix(aCenterA, aCenterB, p);
          // 途中弧线偏移：一半向上拱起、一半向下俯冲，正弦包络保证起终点归零
          center.y += sin(p * 3.14159) * (aRand - 0.5) * 1.6;
          center.z += sin(p * 3.14159) * (fract(aRand * 7.3) - 0.5) * 1.2;

          vOpacity = mix(aOpA, aOpB, p);

          // 入场汇聚（首字成形）
          center = mix(aScattered, center, uAssembly);
          float free = 1.0 - uAssembly;
          center += vec3(
            sin(uTime * 0.6 + aRand * 21.0),
            cos(uTime * 0.5 + aRand * 17.0),
            sin(uTime * 0.7 + aRand * 9.0)
          ) * 0.5 * free;

          // 闲置微扰
          center.x += sin(uTime * 0.5 + aRand * 6.28) * 0.04;
          center.y += cos(uTime * 0.42 + aRand * 12.6) * 0.04;

          // 鼠标斥力场（与星尘成字同款：立方衰减 + 噪声旋转推挤）
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

          center.y += sin(uTime * 0.4) * 0.1;

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
          color = mix(color, color * vec3(1.07, 1.02, 0.94), clamp(vLight - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const identity = new THREE.Matrix4();
    for (let i = 0; i < N; i++) mesh.setMatrixAt(i, identity);
    mesh.frustumCulled = false;
    scene.add(mesh);
    state._mesh = mesh;
    state._mat = mat;
    state._geo = geo;
    state._phase = 0;        // 当前阶段计时
    state._morphing = false;
  },

  update(scene, camera, time, dt, state) {
    const t = (time - state._start) / 1000;
    state._mat.uniforms.uTime.value = t % 6000;
    const asm = Math.min(1, t / 2.5);
    state._mat.uniforms.uAssembly.value = 1 - Math.pow(1 - asm, 3);

    // -- 轮播状态机：hold(停留) → morph(变形) → 拷贝 B→A、写入新 B → hold ... --
    const words = state._wordList;
    if (words.length > 1 && asm >= 1) {
      state._phase += dt;
      if (!state._morphing) {
        if (state._phase >= state.holdSec) {
          state._morphing = true;
          state._phase = 0;
        }
      } else if (state._phase >= state.morphDur) {
        // 完成一次变形：B 成为当前字，写入新的下一字
        state._wordIdx = (state._wordIdx + 1) % words.length;
        const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
        const maxWorldW = viewH * camera.aspect * 0.92;
        const nextIdx = (state._wordIdx + 1) % words.length;
        const sNext = window.bloomSampleGlyph(words[nextIdx], state._density, maxWorldW);
        const rands = state._geo.attributes.aRand.array;
        state._posA.set(state._posB);
        state._posB.set(paddedSample(sNext, state._N, rands));
        // _posA/_posB 即 attribute 底层数组（init 时直接传入），标记上传即可
        state._geo.attributes.aCenterA.needsUpdate = true;
        state._geo.attributes.aCenterB.needsUpdate = true;
        const opA = state._geo.attributes.aOpA.array;
        const opB = state._geo.attributes.aOpB.array;
        opA.set(opB);
        const opNext = wordOpacity(sNext, state._N);
        opB.set(opNext);
        state._geo.attributes.aOpA.needsUpdate = true;
        state._geo.attributes.aOpB.needsUpdate = true;
        state._morphing = false;
        state._phase = 0;
        state._mat.uniforms.uMix.value = 0;
      } else {
        state._mat.uniforms.uMix.value = state._phase / state.morphDur;
      }
    }

    // -- 鼠标（与星尘成字完全同款：回退链 / lerp / 斥力强度平滑） --
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

    if (state._smx === null) {
      state._smx = tx; state._smy = ty;
    } else {
      state._smx += (tx - state._smx) * 0.2;
      state._smy += (ty - state._smy) * 0.2;
    }

    const target = onScreen ? state.mouseStrength : 0;
    state._mStrength += (target - state._mStrength) * (1 - Math.pow(0.05, dt));

    const u = state._mat.uniforms;
    u.uMouse.value.set(state._smx, state._smy);
    u.uMouseStrength.value = state._mStrength;
    u.uLightPos.value.set(state._smx, 1.2 + state._smy * 0.3, 6);
  }
});

// 词的透明度按与位置一致的 stride 映射铺满 N 槽位
function wordOpacity(s, N) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = s.opacities[Math.floor(i * s.count / N)];
  }
  return out;
}

// 把一个词的粒子铺满 N 个槽位：stride 取点，重复槽位按 aRand 加半间距抖动防叠亮
function paddedSample(s, N, rands) {
  const out = new Float32Array(N * 3);
  const m = s.count;
  for (let i = 0; i < N; i++) {
    const j = Math.floor(i * m / N) * 3;
    out[i * 3] = s.positions[j];
    out[i * 3 + 1] = s.positions[j + 1];
    out[i * 3 + 2] = s.positions[j + 2];
  }
  if (m < N) {
    for (let i = 0; i < N; i++) {
      const first = Math.floor(Math.floor(i * m / N) * N / m);
      if (i !== first) {
        out[i * 3] += (rands[i] - 0.5) * 0.09;
        out[i * 3 + 1] += (rands[(i + 7) % N] - 0.5) * 0.09;
      }
    }
  }
  return out;
}

})();
