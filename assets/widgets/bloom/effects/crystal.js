window.bloomRegister3D('crystal', {
  fps: 30, // 慢速氛围动画，30fps 足够（配合 overlay.js 的帧率上限）
  init(scene, camera, state) {
    state.primaryColor = state.primaryColor || '#ff77aa';
    state.secondaryColor = state.secondaryColor || '#77bbff';
    state.rotationSpeed = state.rotationSpeed || 1;
    state.bokehCount = state.bokehCount || 70;

    camera.position.set(0, 0, 45);
    camera.lookAt(0, 0, 0);

    // 1. 极其柔和、梦幻的色彩光源，营造“流光溢彩”的折射感
    const light1 = new THREE.PointLight(new THREE.Color(state.primaryColor || '#ff77aa'), 2.5, 100);
    light1.position.set(20, 20, 20);
    scene.add(light1);

    const light2 = new THREE.PointLight(new THREE.Color(state.secondaryColor || '#77bbff'), 2.5, 100);
    light2.position.set(-20, -20, 20);
    scene.add(light2);

    const light3 = new THREE.PointLight(0xbb88ff, 2.0, 100);
    light3.position.set(0, 0, -20);
    scene.add(light3);

    state._lights = [light1, light2, light3];

    // 2. 主体：完美的数学形态 —— 莫比乌斯环 / 环面结 (Torus Knot)
    // 这种几何体本身就自带优雅和连绵不断的视觉美感
    const geo = new THREE.TorusKnotGeometry(9, 2.8, 256, 64);
    
    // 材质：极简透明，仅保留光影痕迹。
    // 性能关键：MeshPhysicalMaterial + transmission 会让 three.js 每帧先把全场景
    // 渲染进离屏 transmission buffer 再画一遍（整场景双倍渲染成本），而 opacity
    // 0.05 的蝉翼本体几乎隐形，折射背景的贡献趋近于零——高光才是视觉唯一焦点。
    // 改用 Phong 后场景恢复单遍渲染，画面几乎无差，GPU 开销大幅下降
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      specular: 0xffffff,
      shininess: 120, // 高光锐利如玻璃
      transparent: true,
      opacity: 0.08, // 身体几乎彻底消失
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    state._knot = mesh;

    // 内部柔光线框，增加细节层次，使其不至于完全透明而消失。
    // 用低精度几何：复用 256×64 主几何时 wireframe 模式每帧近 10 万条线段，
    // 而透明度只有 0.03，低精度版本肉眼几乎无差
    const wireGeo = new THREE.TorusKnotGeometry(9, 2.8, 96, 12);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.03,
      blending: THREE.AdditiveBlending
    });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    wire.scale.setScalar(0.995);
    mesh.add(wire);

    // 3. 氛围：电影级焦外光斑 (Bokeh) 取代具象的粒子
    const bokehCount = state.bokehCount || 70;
    const bokehGeo = new THREE.BufferGeometry();
    const bokehPos = new Float32Array(bokehCount * 3);
    const bokehColors = new Float32Array(bokehCount * 3);
    const bokehData = [];

    // 绘制一个非常柔和的光斑纹理
    const createBokehTex = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };

    const tex = createBokehTex();

    for(let i=0; i<bokehCount; i++) {
      bokehPos[i*3] = (Math.random() - 0.5) * 100;
      bokehPos[i*3+1] = (Math.random() - 0.5) * 80;
      bokehPos[i*3+2] = (Math.random() - 0.5) * 60 - 15; // 稍微靠后，避免挡住主体

      // 颜色在粉、蓝、紫之间过渡
      const hue = Math.random() * 0.15 + 0.75; // 0.75-0.9 (紫-粉红)
      const color = new THREE.Color().setHSL(hue, 0.7, 0.7);
      
      // 偶尔混入冰蓝色
      if (Math.random() > 0.7) color.setHSL(0.55, 0.7, 0.7);

      bokehColors[i*3] = color.r;
      bokehColors[i*3+1] = color.g;
      bokehColors[i*3+2] = color.b;

      bokehData.push({
        phaseY: Math.random() * Math.PI * 2,
        phaseX: Math.random() * Math.PI * 2,
        speed: 0.05 + Math.random() * 0.1, // 移动极慢
        size: 2 + Math.random() * 6 // 大小不一
      });
    }

    bokehGeo.setAttribute('position', new THREE.BufferAttribute(bokehPos, 3));
    bokehGeo.setAttribute('color', new THREE.BufferAttribute(bokehColors, 3));

    // PointsMaterial 不支持逐点 size attribute（之前设置的 size 属性是死代码，
    // 从未生效过），屏幕上的大小差异完全来自 sizeAttenuation 的透视衰减
    const bokehMat = new THREE.PointsMaterial({
      size: 6, // 基础大小
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    const bokehSystem = new THREE.Points(bokehGeo, bokehMat);
    scene.add(bokehSystem);
    state._bokeh = bokehSystem;
    state._bokehData = bokehData;
  },

  update(scene, camera, time, dt, state) {
    const t = time * 0.001;

    // 主体的旋转：优雅、舒缓、如流水般连绵
    state._knot.rotation.x = Math.sin(t * 0.2) * 0.5;
    state._knot.rotation.y += dt * 0.15 * (state.rotationSpeed || 1);
    state._knot.rotation.z = Math.cos(t * 0.15) * 0.3;

    // 整体像在水下呼吸一样微微起伏
    state._knot.position.y = Math.sin(t * 0.4) * 2;

    // 光源围绕主体游走，这会在玻璃材质上产生流动的霓虹反光
    state._lights[0].position.x = Math.sin(t * 0.5) * 30;
    state._lights[0].position.z = Math.cos(t * 0.5) * 30;
    
    state._lights[1].position.y = Math.sin(t * 0.4 + Math.PI) * 30;
    state._lights[1].position.z = Math.cos(t * 0.4 + Math.PI) * 30;

    // 光斑极其缓慢的游移
    if (state._bokeh) {
      const pos = state._bokeh.geometry.attributes.position.array;
      for(let i=0; i<state._bokehData.length; i++) {
        const d = state._bokehData[i];
        pos[i*3+1] += Math.sin(t * d.speed + d.phaseY) * 0.015;
        pos[i*3] += Math.cos(t * d.speed + d.phaseX) * 0.01;
      }
      state._bokeh.geometry.attributes.position.needsUpdate = true;
    }

    // 摄像机镜头轻微的推拉摇移，增加空间感
    camera.position.x = Math.sin(t * 0.1) * 8;
    camera.position.y = Math.cos(t * 0.15) * 5;
    camera.lookAt(0, 0, 0);
  }
});
