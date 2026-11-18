window.bloomRegister('glitchVision',function(ctx,w,h,time,dt,state){if(!state.initialized){
  state.glitchIntensity=state.glitchIntensity||1;
  state.pixelCount=state.pixelCount||40;
  state.scanSpeed=state.scanSpeed||80;
  state.rgbShift=state.rgbShift!==undefined?state.rgbShift:1;
  state.scanY=0;state.scanSp=state.scanSpeed+Math.random()*60;state.bars=[];state.glitches=[];state.pix=[];state.gT=0;state.sT=0;for(let i=0;i<state.pixelCount;i++)state.pix.push({x:Math.random()*w,y:Math.random()*h,si:Math.random()*3+1,hue:Math.random()*360,t:Math.random()*1000});state.initialized=true}
ctx.fillStyle='rgba(8,8,12,0.12)';ctx.fillRect(0,0,w,h);
// scanlines
state.scanY=(state.scanY+state.scanSp*state.glitchIntensity*dt)%h;ctx.fillStyle=`rgba(255,255,255,${0.03+Math.sin(time*0.005)*0.01})`;ctx.fillRect(0,state.scanY,w,1.5);
for(let y=0;y<h;y+=3){ctx.fillStyle=`rgba(255,255,255,${0.008+Math.sin(y*0.1+time*0.002)*0.004})`;ctx.fillRect(0,y,w,1)}
// glitch bars
state.gT-=dt;if(state.gT<=0){state.gT=(0.05+Math.random()*0.15)/state.glitchIntensity;const bh=Math.random()*30+5;const by=Math.random()*(h-bh);state.bars.push({y:by,h:bh,off:(Math.random()-0.5)*80,life:0.15+Math.random()*0.25,hue:Math.random()*360})}
state.bars=state.bars.filter(b=>{b.life-=dt;if(b.life<=0)return false;const a=b.life;ctx.save();ctx.beginPath();ctx.rect(0,b.y,w,b.h);ctx.clip();ctx.fillStyle=`hsla(${b.hue},60%,50%,0.12)`;ctx.fillRect(0,b.y,w,b.h);ctx.fillStyle=`rgba(255,0,0,${a*0.15})`;ctx.fillRect(b.off,0,4,h);ctx.fillStyle=`rgba(0,255,80,${a*0.08})`;ctx.fillRect(b.off+2,0,2,h);ctx.fillStyle=`rgba(0,80,255,${a*0.15})`;ctx.fillRect(b.off+8,0,4,h);for(let k=0;k<8;k++){const ly=b.y+Math.random()*b.h;ctx.fillStyle=`rgba(255,255,255,${Math.random()*a*0.3})`;ctx.fillRect(Math.random()*w-10,ly,Math.random()*20+5,1)}ctx.restore();return true});
// RGB separation blocks
state.sT-=dt;if(state.sT<=0){state.sT=0.3+Math.random()*0.6;const bw=Math.random()*150+50;const bh=Math.random()*80+20;const bx=Math.random()*(w-bw);const by=Math.random()*(h-bh);state.glitches.push({x:bx,y:by,w:bw,h:bh,rx:(Math.random()*8-4)*state.rgbShift,ry:(Math.random()*4-2)*state.rgbShift,gx:(Math.random()*8-4)*state.rgbShift,gy:(Math.random()*4-2)*state.rgbShift,bx:(Math.random()*8-4)*state.rgbShift,by:(Math.random()*4-2)*state.rgbShift,life:0.2+Math.random()*0.3})}
state.glitches=state.glitches.filter(g=>{g.life-=dt;if(g.life<=0)return false;ctx.save();ctx.beginPath();ctx.rect(g.x,g.y,g.w,g.h);ctx.clip();const a=g.life;ctx.globalCompositeOperation='screen';ctx.fillStyle=`rgba(255,0,0,${a*0.3})`;ctx.fillRect(g.x+g.rx,g.y+g.ry,g.w,g.h);ctx.fillStyle=`rgba(0,255,0,${a*0.3})`;ctx.fillRect(g.x+g.gx,g.y+g.gy,g.w,g.h);ctx.fillStyle=`rgba(0,80,255,${a*0.3})`;ctx.fillRect(g.x+g.bx,g.y+g.by,g.w,g.h);ctx.globalCompositeOperation='source-over';ctx.restore();return true});
// flickering pixels
state.pix.forEach(p=>{const a=(Math.sin((time+p.t)*0.01)*0.5+0.5)*0.6;ctx.fillStyle=`hsla(${p.hue},80%,60%,${a})`;ctx.fillRect(p.x,p.y,p.si,p.si)});
// data tear lines
ctx.fillStyle='rgba(255,255,255,0.02)';for(let i=0;i<5;i++){const ty=Math.random()*h;const th=Math.random()*2+1;ctx.fillRect(0,ty,w,th)}
},function(s){s.initialized=false;s.bars=null;s.glitches=null;s.pix=null;});
