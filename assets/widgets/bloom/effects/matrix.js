window.bloomRegister('matrix',
  function(ctx, w, h, time, dt, state) {
    if (!state.drops) {
      state.fontSize = state.fontSize || 16;
      state.columns = Math.floor(w / state.fontSize);
      state.drops = [];
      state.speeds = [];
      for (let x = 0; x < state.columns; x++) {
        state.drops[x] = Math.random() * -100;
        state.speeds[x] = Math.random() * 0.5 + 0.5;
      }
      state.chars = state.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*アイウエオカキクケコサシスセソタチツテト纳ニヌネ诺哈ヒフヘホ马ミムメモ也ユヨ拉リルレ罗瓦ヲン';
      // Emoji 是代理对，必须按码点切分，不能用 length/charAt 按 UTF-16 单元取
      state.charList = Array.from(state.chars);
      state.trailLength = 25;

      let hex = state.primaryColor || '#00ff32';
      hex = hex.replace(/^#/, '');
      let r = 0, g = 255, b = 50;
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
      state.rgb = [r, g, b];
      state.fontFamily = state.fontFamily || '"Courier New", monospace';
    }
    ctx.font = state.fontSize + 'px ' + state.fontFamily;
    ctx.textAlign = 'center';
    const r = state.rgb[0], g = state.rgb[1], b = state.rgb[2];
    // 头字符亮色（无 shadowBlur，避免每帧数百次阴影渲染）
    const hr = Math.min(255, r + 180), hg = Math.min(255, g + 180), hb = Math.min(255, b + 180);
    for (let i = 0; i < state.drops.length; i++) {
      const headY = Math.floor(state.drops[i]);
      const x = i * state.fontSize + state.fontSize / 2;
      for (let j = 0; j < state.trailLength; j++) {
        const yPos = headY - j;
        if (yPos > 0 && yPos * state.fontSize < h + state.fontSize) {
          const charIndex = Math.floor((x * 13 + yPos * 31 + time / 200) % state.charList.length);
          const text = state.charList[charIndex];
          const alpha = 1 - (j / state.trailLength);
          if (j === 0) {
            ctx.fillStyle = 'rgba(' + hr + ', ' + hg + ', ' + hb + ', ' + alpha + ')';
          } else {
            ctx.fillStyle = 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (alpha * 0.8) + ')';
          }
          ctx.fillText(text, x, yPos * state.fontSize);
        }
      }
      if (headY * state.fontSize > h && Math.random() > 0.98) {
        state.drops[i] = 0; state.speeds[i] = Math.random() * 0.5 + 0.5;
      }
      // 按时间推进（60fps 为基准），避免高刷屏下落速度变快、帧率上限改变手感
      state.drops[i] += state.speeds[i] * 60 * dt;
    }
  },
  function(state) { state.drops = null; state.rgb = null; state.charList = null; }
);
