// 字火烟花 - 文字凝成粒子星阵后，每隔几秒随机有一个字"炸开"成烟花，
// 火花四溅再缓缓归位重组。字符簇由采样器逐字符绘制时标记（aCluster），
// 爆炸中心是该簇的质心（init 时 CPU 算好），一次只有一簇在燃放。
//
// 爆炸曲线 e = sin(π·progress)：0→1→0，炸开自然带回落归位；
// 位移 = 字心向外径向 + 每粒子随机旋向（火花四溅感），亮度随 e 增亮。
// 采样/汇聚/鼠标斥力/光斑跟随与 glyphDust 同一管线，fps 30。
(function () {

window.bloomRegister3D('glyphFireworks', {
  fps: 30,
  init(scene, camera, state) {
    state.text = state.text || '恭喜发财';
    state.glyphColor = state.glyphColor || '#ffc46b';
    state.density = state.density || 70;
    state.burstInterval = Math.max(1, state.burstInterval || 4);  // 烟花间隔（秒）
    state.burstPower = state.burstPower || 1.6;                   // 爆炸力度
    state.burstDur = 1.8;                                         // 单次燃放时长
    state.mouseRadius = state.mouseRadius || 4;
    state.mouseStrength = state.mouseStrength !== undefined ? state.mouseStrength : 0.8;

    camera.position.set(0, 0, 18);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    state._start = performance.now();
    state._smx = null; state._smy = null;
    state._mStrength = 0;
    state._burstTimer = 0;
    state._burstProg = -1;   // <0 表示当前无燃放

    const viewH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
    const data = window.bloomSampleGlyph(state.text, state.density, viewH * camera.aspect * 0.92);
    state._count = data.count;

    // 每个字符簇的质心（爆炸中心）
    const centers = new Float32Array(data.clusterCount * 3);
    const counts = new Float32Array(data.clusterCount);
    for (let i = 0; i < data.count; i++) {
      const c = data.clusters[i];
      centers[c * 3] += data.positions[i * 3];
      centers[c * 3 + 1] += data.positions[i * 3 + 1];
      centers[c * 3 + 2] += data.positions[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < data.clusterCount; c++) {
      if (counts[c] > 0) {
        centers[c * 3] /= counts[c];
        centers[c * 3 + 1] /= counts[c];
        centers[c * 3 + 2] /= counts[c];
      }
    }
    state._clusterCenters = centers;
    state._clusterCount = data.clusterCount;

    const geo = new THREE.BoxGeometry(0.085, 0.085, 0.03);
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(data.positions, 3));
    geo.setAttribute('aScattered', new THREE.InstancedBufferAttribute(data.scattered, 3));
    geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(data.opacities, 1));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(data.rands, 1));
    geo.setAttribute('aCluster', new THREE.InstancedBufferAttribute(data.clusters, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAssembly: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uMouseRadius: { value: state.mouseRadius || 4 },
        uMouseStrength: { value: 0 },
        uBurstCluster: { value: 0 },
        uBurstProg: { value: 0 },
        uBurstCenter: { value: new THREE.Vector3() },
        uBurstAmp: { value: 0 },
        uLightPos: { value: new THREE.Vector3(0, 1.2, 6) },
        uLightRange: { value: 12 },
        uColor: { value: new THREE.Color(state.glyphColor) }
      },
      vertexShader: `
        attribute vec3 aCenter;
        attribute vec3 aScattered;
        attribute float aOpacity;
        attribute float aRand;
        attribute float aCluster;

        uniform float uTime;
        uniform float uAssembly;
        uniform vec2 uMouse;
        uniform float uMouseRadius;
        uniform float uMouseStrength;
        uniform float uBurstCluster;
        uniform float uBurstProg;
        uniform vec3 uBurstCenter;
        uniform float uBurstAmp;
        uniform vec3 uLightPos;
        uniform float uLightRange;

        varying float vOpacity;
        varying float vLight;
        varying float vBurst;
        varying vec3 vWorldPos;

        void main() {
          vOpacity = aOpacity;
          vBurst = 0.0;

          vec3 center = mix(aScattered, aCenter, uAssembly);

          // 入场未完成时自由漂浮
          float free = 1.0 - uAssembly;
          center += vec3(
            sin(uTime * 0.6 + aRand * 21.0),
            cos(uTime * 0.5 + aRand * 17.0),
            sin(uTime * 0.7 + aRand * 9.0)
          ) * 0.5 * free;

          // 闲置微扰
          center.x += sin(uTime * 0.5 + aRand * 6.28) * 0.04;
          center.y += cos(uTime * 0.42 + aRand * 12.6) * 0.04;

          // 单字燃放：e = sin(π·progress) 炸开又收拢；径向 + 随机旋向 = 火花四溅
          if (uBurstAmp > 0.001 && abs(aCluster - uBurstCluster) < 0.5) {
            float e = sin(uBurstProg * 3.14159);
            vec2 dir = aCenter.xy - uBurstCenter.xy;
            float dl = length(dir);
            dir = dl > 0.001 ? dir / dl : vec2(cos(aRand * 6.28), sin(aRand * 6.28));
            float a2 = aRand * 6.28;
            vec2 swirl = vec2(cos(a2), sin(a2)) * 0.6;
            center.xy += (dir + swirl) * e * uBurstAmp * (0.4 + aRand);
            center.z += sin(aRand * 40.0 + uBurstProg * 6.28) * e * uBurstAmp * 0.8;
            vBurst = e;
          }

          // 鼠标斥力场（与星尘成字同款）
          vec2 toMouse = center.xy - uMouse;
          float md = length(toMouse);
          if (md < uMouseRadius && md > 0.001) {
            float t = 1.0 - md / uMouseRadius;
            float force = t * t * t * uMouseStrength * uAssembly;
            vec2 radialDir = toMouse / md;
            float noiseAngle = sin(aRand * 6.28 + uTime * 0.5) * 0.8;
            float ca = cos(noiseAngle);
            float sa = sin(noiseAngle);
            vec2 push = vec2(radialDir.x * ca - radialDir.y * sa, radialDir.x * sa + radialDir.y * ca);
            center.xy += push * force * 2.0;
            center.z += sin(aRand * 40.0 + uTime) * force * 0.8;
          }

          center.y += sin(uTime * 0.4) * 0.1;

          vWorldPos = center;
          float lightDist = distance(center, uLightPos);
          float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
          vLight = mix(0.3, 2.6, lit * lit) * (1.0 + vBurst * 1.6);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        varying float vLight;
        varying float vBurst;
        varying vec3 vWorldPos;

        uniform float uTime;
        uniform vec3 uColor;

        void main() {
          float dist = length(vWorldPos.xy);
          float glow = smoothstep(8.0, 0.0, dist) * 0.3;

          float alpha = vOpacity * (0.55 + glow) * (1.0 + vBurst * 0.6);
          float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
          alpha *= shimmer * min(vLight, 1.0);

          vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
          // 燃放的火花偏暖白
          color = mix(color, vec3(1.0, 0.95, 0.85) * vLight, clamp(vBurst, 0.0, 1.0) * 0.5);
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

    // -- 燃放调度：入场完成后按间隔随机挑一个字燃放 --
    const u = state._mat.uniforms;
    if (asm >= 1) {
      if (state._burstProg < 0) {
        state._burstTimer += dt;
        if (state._burstTimer >= state.burstInterval && state._clusterCount > 0) {
          state._burstTimer = 0;
          state._burstProg = 0;
          const c = Math.floor(Math.random() * state._clusterCount);
          u.uBurstCluster.value = c;
          u.uBurstCenter.value.set(
            state._clusterCenters[c * 3],
            state._clusterCenters[c * 3 + 1],
            state._clusterCenters[c * 3 + 2]
          );
          u.uBurstAmp.value = state.burstPower * 1.5;
        }
      } else {
        state._burstProg += dt / state.burstDur;
        if (state._burstProg >= 1) {
          state._burstProg = -1;
          u.uBurstAmp.value = 0;
        } else {
          u.uBurstProg.value = state._burstProg;
        }
      }
    }

    // -- 鼠标（与星尘成字同款链路） --
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

    u.uMouse.value.set(state._smx, state._smy);
    u.uMouseStrength.value = state._mStrength;
    u.uLightPos.value.set(state._smx, 1.2 + state._smy * 0.3, 6);
  }
});

})();
