window.bloomRegister3D('ocean', {
  fps: 30, // 慢速氛围动画，30fps 足够（配合 overlay.js 的帧率上限）
  init(scene, camera, state) {
    state.sunColor = state.sunColor || '#ff9d00';
    state.deepColor = state.deepColor || '#001b36';
    state.shallowColor = state.shallowColor || '#004d61';
    state.waveHeight = state.waveHeight || 1;

    camera.position.set(0, 8, 32);
    camera.lookAt(0, -2, 0);

    // Optimized: Reduced segments to 96x96 to balance vertex shader load and visual smoothness
    const geo = new THREE.PlaneGeometry(240, 240, 96, 96);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.FrontSide, // 相机永远在水面之上，剔除背面可省近半片元着色（透明水面下的背面本来就几乎不可见）
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.5, 0.15, 0.8).normalize() },
        uSunCol: { value: new THREE.Color(state.sunColor || '#ff9d00') },
        uDeepCol: { value: new THREE.Color(state.deepColor || '#001b36') },
        uShallowCol: { value: new THREE.Color(state.shallowColor || '#004d61') },
        uWaveHeight: { value: state.waveHeight || 1 }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uWaveHeight;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vHeight;
        varying vec2 vUv;

        // Gerstner Wave 核心算法
        vec3 gWave(vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal) {
          float steepness = wave.z * uWaveHeight;
          float wavelength = wave.w;
          float k = 2.0 * 3.14159 / wavelength;
          float c = sqrt(9.8 / k);
          vec2 d = normalize(wave.xy);
          float f = k * (dot(d, p.xy) - c * uTime);
          float a = steepness / k;

          tangent += vec3(
            -d.x * d.x * (steepness * sin(f)),
            -d.x * d.y * (steepness * sin(f)),
            d.x * (steepness * cos(f))
          );
          binormal += vec3(
            -d.x * d.y * (steepness * sin(f)),
            -d.y * d.y * (steepness * sin(f)),
            d.y * (steepness * cos(f))
          );
          return vec3(
            d.x * (a * cos(f)),
            d.y * (a * cos(f)),
            a * sin(f)
          );
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          vec3 tangent = vec3(1.0, 0.0, 0.0);
          vec3 binormal = vec3(0.0, 1.0, 0.0);
          vec3 p = pos;

          p += gWave(vec4(1.0, 0.6, 0.15, 40.0), pos, tangent, binormal);
          p += gWave(vec4(0.7, 1.0, 0.12, 25.0), pos, tangent, binormal);
          p += gWave(vec4(-0.5, 0.8, 0.1, 15.0), pos, tangent, binormal);
          p += gWave(vec4(0.3, -0.4, 0.08, 10.0), pos, tangent, binormal);

          vHeight = p.z;
          vNormal = normalize(cross(tangent, binormal));
          vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunCol;
        uniform vec3 uDeepCol;
        uniform vec3 uShallowCol;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vHeight;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(vNormal);

          float micro = noise(vUv * 40.0 + uTime * 0.2) * 0.05;
          n = normalize(n + vec3(micro, micro, 0.0));

          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 4.5);
          float depth = smoothstep(-4.0, 6.0, vHeight);
          vec3 waterCol = mix(uDeepCol, uShallowCol, depth);

          float sss = pow(max(dot(viewDir, -uSunDir), 0.0), 4.0) * smoothstep(2.0, 6.0, vHeight);
          waterCol += vec3(0.0, 0.8, 0.6) * sss * 0.4;

          vec3 reflDir = reflect(-viewDir, n);
          float skyRefl = max(reflDir.y, 0.0);
          vec3 reflCol = mix(vec3(0.05, 0.02, 0.1), uSunCol * 0.4, skyRefl);
          reflCol += uSunCol * exp(-abs(reflDir.y) * 10.0) * 0.5;

          vec3 halfDir = normalize(uSunDir + viewDir);
          float specSharp = pow(max(dot(n, halfDir), 0.0), 1024.0) * 15.0;
          float specSoft = pow(max(dot(n, halfDir), 0.0), 32.0) * 0.5;
          float sparkle = step(0.92, hash(vUv * 100.0 + uTime * 0.5)) * specSoft * 2.0;

          float foamNoise = noise(vUv * 15.0 - uTime * 0.1);
          float foam = smoothstep(4.5, 7.5, vHeight + foamNoise * 1.5);
          vec3 foamCol = vec3(0.9, 0.95, 1.0);

          vec3 color = mix(waterCol, reflCol, fresnel * 0.6);
          color += uSunCol * (specSharp + specSoft + sparkle);
          color = mix(color, foamCol, foam * 0.4);

          float dist = length(vWorldPos.xz);
          float edgeFade = 1.0 - smoothstep(70.0, 110.0, dist);
          
          // 降低最大不透明度，提升环境融合度
          gl_FragColor = vec4(color, edgeFade * 0.65);
        }
      `
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    state._waterMat = mat;

    // 极致黄昏天空盒 - 调暗亮度以减少干扰
    const skyGeo = new THREE.SphereGeometry(450, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 zenith = vec3(0.01, 0.005, 0.04);
          vec3 sunset = vec3(0.4, 0.1, 0.05);
          vec3 horizon = vec3(0.6, 0.3, 0.1);

          vec3 color = mix(sunset, zenith, smoothstep(0.0, 0.8, h));
          color = mix(horizon, color, smoothstep(-0.1, 0.2, h));

          vec3 sunDir = normalize(vec3(0.5, 0.15, 0.8));
          float sunAngle = max(dot(vDir, sunDir), 0.0);
          float sun = smoothstep(0.998, 0.9998, sunAngle);
          color += vec3(0.8, 0.7, 0.5) * sun * 2.0;
          color += vec3(0.6, 0.2, 0.05) * pow(sunAngle, 120.0) * 1.5;

          gl_FragColor = vec4(color, smoothstep(-0.1, 0.1, h) * 0.8);
        }
      `
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // 注：水面与天空都是不受光照的自定义 ShaderMaterial，不放任何灯光
  },

  update(scene, camera, time, dt, state) {
    const t = time * 0.0006;
    state._waterMat.uniforms.uTime.value = t;

    // 极大幅度减弱相机晃动，保持视觉稳定
    camera.position.x = Math.sin(t * 0.1) * 1.5;
    camera.position.z = 38 + Math.cos(t * 0.08) * 2.0;
    camera.position.y = 7 + Math.sin(t * 0.4) * 0.2;
    
    camera.rotation.z = Math.sin(t * 0.2) * 0.005;
    camera.lookAt(0, -2, 0);
  }
});
