window.bloomRegister('ripple',
  function(ctx, w, h, time, dt, state) {
    if(!state.ripples){state.ripples=[];
      state.spawnInterval=state.spawnInterval||1200;
      state.maxRadius=state.maxRadius||100;
      state.hue=state.hue!==undefined?state.hue:180;
      state.ringCount=state.ringCount||3;
    }
    if(!state.lastSpawn)state.lastSpawn=0;
    if(time-state.lastSpawn>state.spawnInterval+Math.random()*1500){state.lastSpawn=time;
      state.ripples.push({x:Math.random()*w,y:Math.random()*h,radius:0,
        maxRadius:Math.random()*200+state.maxRadius,speed:Math.random()*80+40,hue:Math.random()*60+state.hue,rings:Math.floor(Math.random()*3)+state.ringCount});}
    state.ripples=state.ripples.filter(r=>{r.radius+=r.speed*dt;if(r.radius>r.maxRadius+50)return false;
      for(let i=0;i<r.rings;i++){const rr=r.radius-i*15;if(rr<0)continue;
        const progress=rr/r.maxRadius;const alpha=(1-progress)*0.5;
        ctx.beginPath();ctx.arc(r.x,r.y,rr,0,Math.PI*2);
        ctx.strokeStyle=`hsla(${r.hue+i*20},70%,65%,${alpha})`;ctx.lineWidth=2*(1-progress)+0.5;ctx.stroke();}
      return true;});
  },
  function(state) { state.ripples = null; state.lastSpawn = null; }
);
