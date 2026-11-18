window.bloomRegister3D('nebula', {
  fps: 30, // 慢速氛围动画，30fps 足够（配合 overlay.js 的帧率上限）
  init(scene, camera, state) {
    state.primaryColor = state.primaryColor || '#4834d4';
    state.secondaryColor = state.secondaryColor || '#22a6b3';
    state.coreColor = state.coreColor || '#be2edd';
    state.starDensity = state.starDensity || 1;

    // 顶点着色器共享时钟：旋臂差速旋转 / 星光闪烁已 GPU 化，
    // CPU 每帧只推进这一个 uniform，无逐粒子循环、无缓冲区上传
    state._nebulaTime = { value: 0 };
    state._lookTarget = new THREE.Vector3();

    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    // 1. 创建高性能的粒子纹理
    const softTex = window.bloomCreateSoftParticleTexture(64, 0.05);  // 稀薄气体
    const midTex = window.bloomCreateSoftParticleTexture(32, 0.2);   // 云团
    const sharpTex = window.bloomCreateSoftParticleTexture(16, 0.5); // 星星

    const layers = [
      // 1. 深层背景星云气（星云的灵魂，极大尺寸，低不透明度）
      { 
        id: 'bgGas', count: 120, spread: 100, size: 50, color: 0x1f0f3d, opacity: 0.08, speed: 0.05, 
        tex: softTex, distribution: 'sphere', pulse: 0.05 
      },
      // 2. 主旋臂 A（深邃蓝紫）
      { 
        id: 'armBlue', count: 1500, spread: 80, size: 8, color: new THREE.Color(state.primaryColor || '#4834d4'), opacity: 0.16, speed: 0.2,
        tex: midTex, distribution: 'spiral', arms: 3, curl: 0.9, pulse: 0.1
      },
      // 3. 高亮内旋臂 B（明亮青绿）
      { 
        id: 'armCyan', count: 1000, spread: 65, size: 6, color: new THREE.Color(state.secondaryColor || '#22a6b3'), opacity: 0.18, speed: 0.28, 
        tex: midTex, distribution: 'spiral', arms: 3, curl: 1.1, pulse: 0.15
      },
      // 4. 活跃核心气云（瑰丽玫粉）
      { 
        id: 'coreGas', count: 700, spread: 45, size: 12, color: new THREE.Color(state.coreColor || '#be2edd'), opacity: 0.14, speed: 0.35,
        tex: softTex, distribution: 'cluster', pulse: 0.2
      },
      // 5. 内部嵌入星（明亮闪烁星）
      { 
        id: 'starsInner', count: 500, spread: 85, size: 1.8, color: 0xffffff, opacity: 0.8, speed: 0.1, 
        tex: sharpTex, distribution: 'sphere', pulse: 0.4
      },
      // 6. 背景远景星
      { 
        id: 'starsOuter', count: 700, spread: 160, size: 1.2, color: 0xffffff, opacity: 0.5, speed: 0.03, 
        tex: sharpTex, distribution: 'sphere', pulse: 0.6
      }
    ];

    layers.forEach(l => l.count = Math.round(l.count * (state.starDensity || 1)));

    state._nebulaLayers = [];

    layers.forEach((layer) => {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(layer.count * 3);
      const colors = new Float32Array(layer.count * 3);
      const sizes = new Float32Array(layer.count);
      const baseColor = new THREE.Color(layer.color);

      // 动态物理模拟所需的属性
      const radii = new Float32Array(layer.count);
      const baseAngles = new Float32Array(layer.count);
      const yCoords = new Float32Array(layer.count);
      const noiseX = new Float32Array(layer.count);
      const noiseZ = new Float32Array(layer.count);
      const twinkleFrequencies = new Float32Array(layer.count);
      const twinklePhases = new Float32Array(layer.count);
      const baseColorsAttr = new Float32Array(layer.count * 3);

      for (let i = 0; i < layer.count; i++) {
        let x, y, z;
        let r = 0;
        let angle = 0;
        let nx = 0;
        let nz = 0;
        
        if (layer.distribution === 'spiral') {
          const t = Math.pow(Math.random(), 0.95); // 稍微向中心聚集
          r = t * layer.spread;
          const arm = Math.floor(Math.random() * (layer.arms || 3));
          const armAngle = (arm / (layer.arms || 3)) * Math.PI * 2;
          angle = t * Math.PI * (layer.curl || 4) + armAngle;
          
          nx = (Math.random() - 0.5) * layer.spread * 0.18;
          nz = (Math.random() - 0.5) * layer.spread * 0.18;
          y = (Math.random() - 0.5) * layer.spread * 0.08;

          x = Math.cos(angle) * r + nx;
          z = Math.sin(angle) * r + nz;
        } else if (layer.distribution === 'cluster') {
          r = Math.pow(Math.random(), 1.8) * layer.spread;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          x = r * Math.sin(phi) * Math.cos(theta);
          y = r * Math.sin(phi) * Math.sin(theta) * 0.3; // 扁平状核心
          z = r * Math.cos(phi);
        } else { // sphere
          r = Math.random() * layer.spread;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          x = r * Math.sin(phi) * Math.cos(theta);
          y = r * Math.sin(phi) * Math.sin(theta);
          z = r * Math.cos(phi);
        }

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // 缓存原始物理值
        radii[i] = r;
        baseAngles[i] = angle;
        yCoords[i] = y;
        noiseX[i] = nx;
        noiseZ[i] = nz;

        // 闪烁机制数据（适用于星星层）
        twinkleFrequencies[i] = 1.5 + Math.random() * 3.5;
        twinklePhases[i] = Math.random() * Math.PI * 2;

        // 颜色渐变微调，增强星云细节层次
        const c = baseColor.clone();
        const hsl = {};
        c.getHSL(hsl);
        // 给偏外部的粒子添加微弱的色相漂移和亮度衰减
        const distRatio = r / layer.spread;
        c.setHSL(
          hsl.h + (Math.random() - 0.5) * 0.06 - distRatio * 0.04,
          hsl.s,
          hsl.l + (Math.random() - 0.5) * 0.08 - distRatio * 0.05
        );
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;

        sizes[i] = layer.size * (0.6 + Math.random() * 0.8);
      }

      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      
      const mat = new THREE.PointsMaterial({
        size: layer.size,
        map: layer.tex,
        vertexColors: true,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
      });

      // 动态层动画 GPU 化：通过 onBeforeCompile 往 PointsMaterial 的顶点着色器里
      // 注入差速旋转 / 星光闪烁计算，CPU 每帧零逐粒子循环、零缓冲区上传。
      // 粒子位置/颜色属性保持静态，动画输入只有共享的 uTime uniform
      if (layer.distribution === 'spiral') {
        geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        geo.setAttribute('aBaseAngle', new THREE.BufferAttribute(baseAngles, 1));
        geo.setAttribute('aBaseY', new THREE.BufferAttribute(yCoords, 1));
        geo.setAttribute('aNoiseX', new THREE.BufferAttribute(noiseX, 1));
        geo.setAttribute('aNoiseZ', new THREE.BufferAttribute(noiseZ, 1));
        const seeds = new Float32Array(layer.count);
        for (let i = 0; i < layer.count; i++) seeds[i] = i;
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = state._nebulaTime;
          shader.uniforms.uSpeed = { value: layer.speed };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
              attribute float aRadius;
              attribute float aBaseAngle;
              attribute float aBaseY;
              attribute float aNoiseX;
              attribute float aNoiseZ;
              attribute float aSeed;
              uniform float uTime;
              uniform float uSpeed;`)
            .replace('#include <begin_vertex>', `
              float nebAngle = aBaseAngle + uTime * uSpeed * (28.0 / (aRadius + 12.0));
              vec3 transformed = vec3(
                cos(nebAngle) * aRadius + aNoiseX,
                aBaseY + sin(uTime * 0.8 + aSeed * 0.05) * 0.4,
                sin(nebAngle) * aRadius + aNoiseZ
              );`);
        };
      } else if (layer.id.startsWith('stars')) {
        geo.setAttribute('aTwFreq', new THREE.BufferAttribute(twinkleFrequencies, 1));
        geo.setAttribute('aTwPhase', new THREE.BufferAttribute(twinklePhases, 1));
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = state._nebulaTime;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
              attribute float aTwFreq;
              attribute float aTwPhase;
              uniform float uTime;`)
            .replace('#include <color_vertex>', `#include <color_vertex>
              #ifdef USE_COLOR
                vColor *= 0.28 + 0.72 * abs(sin(uTime * aTwFreq + aTwPhase));
              #endif`);
        };
      }

      const points = new THREE.Points(geo, mat);
      scene.add(points);
      
      const layerObj = {
        mesh: points,
        speed: layer.speed,
        baseOpacity: layer.opacity,
        pulseScale: layer.pulse || 0.1,
        phase: Math.random() * Math.PI * 2,
        dynamic: layer.distribution === 'spiral' || layer.id.startsWith('stars')
      };

      state._nebulaLayers.push(layerObj);
    });

    // 优化点 1: 在星云中央增设一个扁平的、呈 Additive 混合的发光半透明气体实体核心
    // 这能在视觉上瞬间建立坚实的体积感，解决纯粒子核心略显空洞的问题
    const coreGeo = new THREE.SphereGeometry(6, 24, 24);
    coreGeo.scale(1, 0.35, 1); // 扁平星系核
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff4bb4,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);
    state._coreMesh = coreMesh;
    // 注：场景内全部是 PointsMaterial / MeshBasicMaterial 等不受光照的材质，
    // 任何灯光都不会产生影响，因此不放灯
  },
  
  update(scene, camera, time, dt, state) {
    const t = time * 0.0008;

    // 旋臂差速旋转与星光闪烁已在顶点着色器中计算，CPU 只推进共享时钟
    state._nebulaTime.value = t;

    // 静态层慢速整体自转 + 呼吸脉动；动态层仅作整体微摆
    state._nebulaLayers.forEach((layer) => {
      if (!layer.dynamic) {
        layer.mesh.rotation.y = t * layer.speed * 0.2;
        layer.mesh.rotation.z = t * layer.speed * 0.1;
      } else {
        layer.mesh.rotation.y = Math.sin(t * 0.05) * 0.05;
      }

      const pulse = Math.sin(t * 0.6 + layer.phase);
      layer.mesh.material.opacity = layer.baseOpacity * (1.0 + pulse * layer.pulseScale);
    });

    // 核心气云体积球体的脉动与高光起伏
    if (state._coreMesh) {
      const corePulse = 0.94 + Math.sin(t * 1.2) * 0.06;
      state._coreMesh.scale.set(corePulse, 0.35, corePulse);
      state._coreMesh.material.opacity = 0.16 + Math.cos(t * 0.7) * 0.04;
      state._coreMesh.rotation.y = -t * 0.08; // 逆向自转
    }

    // 电影级慢速摄像机环绕与微幅摇移
    const camT = t * 0.08;
    const radius = 95 + Math.sin(camT * 0.4) * 15;
    camera.position.x = Math.cos(camT) * radius;
    camera.position.z = Math.sin(camT) * radius;
    camera.position.y = Math.sin(camT * 0.6) * 22;

    // 摄像机视点中心在微小范围内浮动，营造太空漂浮镜头感（复用向量避免每帧分配）
    const look = state._lookTarget;
    look.set(
      Math.sin(t * 0.3) * 4,
      Math.cos(t * 0.25) * 3,
      Math.sin(t * 0.4) * 4
    );
    camera.lookAt(look);
  },

  // 清理函数
  function(state) {
    state.initialized = false;
    state._nebulaLayers = null;
    state._nebulaTime = null;
    state._lookTarget = null;
    if (state._coreMesh) {
      state._coreMesh.geometry.dispose();
      state._coreMesh.material.dispose();
      state._coreMesh = null;
    }
  }
});
