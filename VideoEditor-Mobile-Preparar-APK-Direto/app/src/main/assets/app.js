'use strict';
/* VideoEditor Mobile: edição inteiramente local, sem bibliotecas/CDN/telemetria. */
const $ = id => document.getElementById(id);
const els = {};
const ids = ['previewCanvas','canvasFrame','emptyState','mediaInput','audioInput','clips','clipCount','totalDuration','currentTime','endTime','scrubber','scrubberProgress','scrubberThumb','selectedClipName','clipNotice','clipControls','projectName','saveState','toast','exportModal','exportFormat','exportResolution','exportDuration','exportDescription','exportProgress','exportProgressText','startExport','cancelExport','playBtn','audioName','musicInfo','previewAspect','previewQuality','trimStart','trimEnd','trimStartValue','trimEndValue','fitMode','rotation','overlayText','fontSize','fontColor','resolution','frameRate','originalVolume','musicVolume','timelineViewport','timelineContent','timelineRuler','timelinePlayhead','zoomStatus','textStart','textEnd'];
ids.forEach(id=>els[id]=$(id));
const ctx = els.previewCanvas.getContext('2d',{alpha:false});
const aspectSizes={'9:16':[9,16],'16:9':[16,9],'1:1':[1,1]};
const defaults=()=>({name:'Meu primeiro vídeo',clips:[],musicId:null,aspect:'9:16',resolution:720,fps:30,fit:'cover',rotation:0,brightness:100,contrast:100,saturation:100,grayscale:0,text:'',fontSize:42,fontColor:'#ffffff',textPosition:'center',textStart:0,textEnd:null,originalVolume:100,musicVolume:35});
let state=defaults(),selected=-1,playhead=0,playing=false,exporting=false,pausedAt=0,playbackStarted=0,activeId=null,rafId=0,history=[],future=[],historyBusy=false,importBusy=false;
let exportRecorder=null,exportCancelled=false,exportStream=null,exportChunks=[];
let timelineScale=22,autoFollow=true; const activeGestures=new Set();
let audioCtx=null,audioDest=null,previewGain=null,musicNode=null,mediaMap=new Map(),db=null,persistTimer=null,toastTimer=null,musicElement=null;
const idGen=()=> 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
const clone=o=>JSON.parse(JSON.stringify(o));
const bound=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const ftime=s=>{s=Math.max(0,+s||0);let m=Math.floor(s/60),sec=Math.floor(s%60);return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');};
const ftime1=s=>ftime(s)+'.'+Math.floor((Math.max(0,s)%1)*10);
const total=()=>state.clips.reduce((n,c)=>n+Math.max(0,(c.out-c.in)/c.speed),0);
const selectedClip=()=>state.clips[selected]||null;
function ranges(){const [a,b]=aspectSizes[state.aspect]||[9,16],q=Number(state.resolution)||720;let w,h;if(a<b){w=q;h=Math.round(q*b/a);}else if(a>b){h=q;w=Math.round(q*a/b);}else{w=q;h=q;} // dimensão-base 720 na menor direção
 return {w:Math.round(w/2)*2,h:Math.round(h/2)*2};}
function previewSize(){const [a,b]=aspectSizes[state.aspect]||[9,16];let w,h;if(a<b){w=480;h=Math.round(w*b/a);}else if(a>b){h=480;w=Math.round(h*a/b);}else{w=550;h=550;}els.previewCanvas.width=w;els.previewCanvas.height=h;els.canvasFrame.className='canvas-frame '+(a<b?'ratio-portrait':a>b?'ratio-landscape':'ratio-square');els.previewAspect.textContent=state.aspect;els.previewQuality.textContent=w+' × '+h;}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.remove('show'),3800);}
function scheduleSave(){els.saveState.textContent='Salvando…';clearTimeout(persistTimer);persistTimer=setTimeout(()=>saveProject(),500);}
function pushHistory(){if(historyBusy||exporting)return;history.push(clone(state));if(history.length>50)history.shift();future=[];syncHistoryButtons();}
function syncHistoryButtons(){$('undoBtn').disabled=!history.length||exporting;$('redoBtn').disabled=!future.length||exporting;}
function modified(repaint=true){if(repaint)updateUI();scheduleSave();}
function undo(){if(!history.length||exporting)return;future.push(clone(state));state=history.pop();selected=Math.min(selected,state.clips.length-1);pause();historyBusy=true;updateUI();historyBusy=false;scheduleSave();sweepMedia();}
function redo(){if(!future.length||exporting)return;history.push(clone(state));state=future.pop();selected=Math.min(selected,state.clips.length-1);pause();historyBusy=true;updateUI();historyBusy=false;scheduleSave();sweepMedia();}
function locate(t){let at=0;for(let i=0;i<state.clips.length;i++){let c=state.clips[i],length=(c.out-c.in)/c.speed;if(t<at+length-0.000001||i===state.clips.length-1)return {c,index:i,offset:bound(t-at,0,length),globalStart:at};at+=length;}return null;}
function startForIndex(i){return state.clips.slice(0,i).reduce((a,c)=>a+(c.out-c.in)/c.speed,0);}
function fixPlayhead(){playhead=bound(playhead,0,total());}
async function createMedia(file,id,kind){let url=URL.createObjectURL(file),m={id,file,url,kind,name:file.name||'Mídia',duration:0,thumb:null};
 if(kind==='video'){let v=document.createElement('video');v.src=url;v.preload='auto';v.playsInline=true;v.setAttribute('playsinline','');v.disablePictureInPicture=true;v.addEventListener('seeked',()=>{if(!playing)drawFrame();});try{await new Promise((res,rej)=>{let timer=setTimeout(()=>rej(new Error('Não foi possível ler o vídeo.')),25000);v.onloadedmetadata=()=>{clearTimeout(timer);res();};v.onerror=()=>{clearTimeout(timer);rej(new Error('Formato de vídeo incompatível.'));};});m.duration=v.duration;m.element=v;if(!Number.isFinite(m.duration)||m.duration<=0||m.duration>7200)throw new Error('Duração de vídeo inválida ou muito longa.');}catch(e){URL.revokeObjectURL(url);throw e;}}
 else if(kind==='image'){let im=new Image();im.src=url;await new Promise((res,rej)=>{im.onload=res;im.onerror=()=>rej(new Error('Foto incompatível.'));});m.duration=5;m.image=im;}
 else if(kind==='audio'){let a=document.createElement('audio');a.src=url;a.preload='auto';a.loop=true;await new Promise((res,rej)=>{let timer=setTimeout(()=>rej(new Error('Música não pode ser lida.')),20000);a.onloadedmetadata=()=>{clearTimeout(timer);res();};a.onerror=()=>{clearTimeout(timer);rej(new Error('Formato de áudio incompatível.'));};});m.duration=a.duration;m.element=a;}
 mediaMap.set(id,m);if(kind!=='audio'){m.thumb=await thumbnail(m).catch(()=>null);if(kind==='video')m.thumbStrip=await thumbnailStrip(m).catch(()=>null);}return m;}
async function thumbnail(m){const cv=document.createElement('canvas');cv.width=180;cv.height=95;const x=cv.getContext('2d');x.fillStyle='#111425';x.fillRect(0,0,180,95);let source=null;if(m.kind==='video'){let v=document.createElement('video');v.preload='auto';v.muted=true;v.src=m.url;v.playsInline=true;await new Promise((res,rej)=>{v.onloadeddata=res;v.onerror=rej;setTimeout(res,1500);});if(v.readyState>=2)source=v;}
 else source=m.image;if(source){const w=source.videoWidth||source.naturalWidth,h=source.videoHeight||source.naturalHeight;if(w&&h){let scale=Math.max(180/w,95/h),dw=w*scale,dh=h*scale;x.drawImage(source,(180-dw)/2,(95-dh)/2,dw,dh);}}if(m.kind==='video'){source?.removeAttribute('src');source?.load();}return cv.toDataURL('image/jpeg',.75);}
async function thumbnailStrip(m){
 // Three independently sampled positions, cached once per imported video.
 const strip=document.createElement('canvas');strip.width=210;strip.height=54;
 const x=strip.getContext('2d'),v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=m.url;
 const seekFrame=target=>new Promise(resolve=>{
  const timeout=setTimeout(done,900);function done(){clearTimeout(timeout);v.removeEventListener('seeked',done);resolve();}
  v.addEventListener('seeked',done,{once:true});try{v.currentTime=target;}catch(err){done();}
 });
 try{
  await new Promise(resolve=>{if(v.readyState>=1)return resolve();v.addEventListener('loadedmetadata',resolve,{once:true});setTimeout(resolve,1200);});
  for(const [i,f] of [.12,.48,.85].entries()){
   await seekFrame(Math.max(0,Math.min((v.duration||m.duration)*f,(v.duration||m.duration)-.06)));
   x.fillStyle='#27303e';x.fillRect(i*70,0,70,54);
   if(v.readyState>=2&&v.videoWidth&&v.videoHeight){const scale=Math.max(70/v.videoWidth,54/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;try{x.drawImage(v,i*70+(70-w)/2,(54-h)/2,w,h);}catch(err){}}
  }
  return strip.toDataURL('image/jpeg',.68);
 }finally{v.pause();v.removeAttribute('src');v.load();}
}
async function addClips(files){if(importBusy||exporting)return;importBusy=true;let added=0;for(const file of files){if(!file.type.startsWith('video/')&&!file.type.startsWith('image/')){toast('Arquivo ignorado: '+file.name);continue;}try{const id=idGen(),kind=file.type.startsWith('video/')?'video':'image';if(file.size>1024*1024*1024)throw new Error('Arquivo maior que 1 GB. Use vídeos menores.');const m=await createMedia(file,id,kind);if(!added)pushHistory();state.clips.push({id: idGen(),mediaId:id,in:0,out:m.duration,speed:1});added++;await saveMediaToDB(m).catch(()=>toast('Armazenamento cheio: o projeto pode não persistir.'));}catch(e){toast('Não foi possível importar '+file.name+': '+e.message);}}
 importBusy=false;if(added){selected=state.clips.length-added;playhead=startForIndex(selected);modified();toast(added+' arquivo(s) adicionados.');}els.mediaInput.value='';}
async function addAudio(files){if(!files||!files.length||exporting)return;const file=files[0];try{if(file.size>200*1024*1024)throw new Error('O áudio deve ter até 200 MB.');const id=idGen(),m=await createMedia(file,id,'audio');pushHistory();state.musicId=id;musicElement=m.element;musicNode=null;await saveMediaToDB(m).catch(()=>toast('Não foi possível armazenar o áudio offline.'));modified();toast('Trilha sonora adicionada.');}catch(e){toast('Áudio não importado: '+e.message);}els.audioInput.value='';}
function removeMusic(){if(!state.musicId||exporting)return;pushHistory();if(musicElement)musicElement.pause();musicElement=null;musicNode=null;state.musicId=null;modified();sweepMedia();}
function updateUI(){
 fixPlayhead(); const n=state.clips.length;
 els.emptyState.hidden=n>0;
 els.clipCount.textContent=n+' '+(n===1?'clipe':'clipes');
 els.totalDuration.textContent=ftime(total());els.endTime.textContent=ftime1(total());
 els.currentTime.textContent=ftime1(playhead);
 const pct=total()>0?playhead/total()*100:0;
 els.scrubberProgress.style.width=pct+'%';els.scrubberThumb.style.left=pct+'%';
 els.scrubber.setAttribute('aria-valuemax',String(Math.round(total())));
 els.scrubber.setAttribute('aria-valuenow',String(Math.round(playhead)));
 renderTimeline();
 const c=selectedClip(),m=c&&mediaMap.get(c.mediaId);
 els.selectedClipName.textContent=m?.name||'Nenhum selecionado';els.clipNotice.hidden=!!c;
 els.clipControls.classList.toggle('disabled-panel',!c);
 if(c){els.trimStart.min=0;els.trimStart.max=String(Math.max(0,c.out-.1));els.trimStart.value=String(c.in);
 els.trimEnd.min=String(c.in+.1);els.trimEnd.max=String(m.duration);els.trimEnd.value=String(c.out);
 els.trimStartValue.textContent=c.in.toFixed(1)+'s';els.trimEndValue.textContent=c.out.toFixed(1)+'s';
 document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.speed)===c.speed));}
 document.querySelectorAll('[data-aspect]').forEach(b=>b.classList.toggle('selected',b.dataset.aspect===state.aspect));
 document.querySelectorAll('[data-position]').forEach(b=>b.classList.toggle('selected',b.dataset.position===state.textPosition));
 const look=currentLook();for(const k of ['brightness','contrast','saturation','grayscale']){$(k).value=look[k];$(k+'Value').textContent=look[k]+'%';}
 for(const k of ['originalVolume','musicVolume']){$(k).value=state[k];$(k+'Value').textContent=state[k]+'%';}
 els.fitMode.value=look.fit;els.rotation.value=look.rotation;
 if(document.activeElement!==els.overlayText)els.overlayText.value=state.text;
 els.fontSize.value=state.fontSize;els.fontColor.value=state.fontColor;
 els.textStart.value=String(state.textStart||0);els.textEnd.value=String(state.textEnd??total());
 els.resolution.value=state.resolution;els.frameRate.value=state.fps;
 if(document.activeElement!==els.projectName)els.projectName.value=state.name;
 const music=mediaMap.get(state.musicId);
 els.audioName.textContent=music?.name||'Nenhuma música adicionada';
 els.musicInfo.textContent=music?.name||'Sem trilha sonora';
 syncHistoryButtons();previewSize();renderAt(playhead,false);
}
function currentLook(){const base={fit:state.fit,rotation:state.rotation,brightness:state.brightness,contrast:state.contrast,saturation:state.saturation,grayscale:state.grayscale};return {...base,...(selectedClip()?.look||{})};}
function clipLook(c){return {...{fit:state.fit,rotation:state.rotation,brightness:state.brightness,contrast:state.contrast,saturation:state.saturation,grayscale:state.grayscale},...(c?.look||{})};}
function updateLook(name,value){const c=selectedClip();if(c){c.look={...clipLook(c),[name]:value};}else state[name]=value;}
function durationOf(c){return Math.max(0,(c.out-c.in)/c.speed);}
function renderTimeline(){
 const viewport=els.timelineViewport,oldWidth=els.timelineContent.offsetWidth;
 const contentWidth=Math.max(viewport?.clientWidth||320,Math.ceil(total()*timelineScale)+48);
 els.timelineContent.style.width=contentWidth+'px';els.clips.innerHTML='';
 els.zoomStatus.textContent=timelineScale+' px/s';
 const step=timelineScale<14?10:timelineScale<32?5:2;
 els.timelineRuler.innerHTML='';
 for(let t=0;t<=total()+.01;t+=step){const marker=document.createElement('span');marker.className='ruler-tick';marker.style.left=(t*timelineScale)+'px';marker.textContent=ftime(t);els.timelineRuler.appendChild(marker);}
 if(!state.clips.length){els.clips.innerHTML='<div class="clips-placeholder">Importe vídeos ou fotos para editar</div>';}
 for(const [i,c] of state.clips.entries()){
  const m=mediaMap.get(c.mediaId),width=Math.max(8,durationOf(c)*timelineScale);
  const b=document.createElement('div');b.className='clip-item'+(i===selected?' active':'');b.dataset.index=i;b.style.width=width+'px';
  const frames=document.createElement('div');frames.className='clip-frames';
  frames.style.backgroundImage=m?.thumbStrip||m?.thumb?'url("'+(m.thumbStrip||m.thumb)+'")':'none';
  const label=document.createElement('span');label.className='clip-caption';label.textContent=(m?.name||'Mídia')+' · '+ftime1(durationOf(c));
  b.append(frames,label);
  for(const side of ['start','end']){const handle=document.createElement('span');handle.className='trim-handle '+side;handle.setAttribute('role','slider');handle.setAttribute('tabindex','0');handle.setAttribute('aria-label',side==='start'?'Cortar início':'Cortar fim');handle.dataset.side=side;
   handle.addEventListener('pointerdown',ev=>beginTrim(ev,i,side));
   handle.addEventListener('keydown',ev=>{if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){ev.preventDefault();if(exporting)return;pushHistory();const delta=(ev.key==='ArrowRight'?1:-1)*.1;adjustClipTrim(i,side,(side==='start'?c.in:c.out)+delta);modified();}});
   b.appendChild(handle);
  }
  b.addEventListener('click',()=>{if(!b.dataset.dragged)selectClip(i);delete b.dataset.dragged;});
  b.addEventListener('pointerdown',ev=>{if(ev.target.closest('.trim-handle'))return;beginReorder(ev,i,b);});
  els.clips.appendChild(b);
 }
 updateTimelineCursor();
}
function updateTimelineCursor(){if(!els.timelinePlayhead)return;const x=playhead*timelineScale;els.timelinePlayhead.style.left=x+'px';if(playing&&autoFollow){const vp=els.timelineViewport;if(x-vp.scrollLeft>vp.clientWidth-32||x-vp.scrollLeft<12)vp.scrollLeft=Math.max(0,x-vp.clientWidth*.30);}}
function adjustClipTrim(i,side,value){const c=state.clips[i],m=mediaMap.get(c.mediaId);if(!m)return;
 if(side==='start')c.in=bound(value,0,c.out-.1);else c.out=bound(value,c.in+.1,m.duration);
 playhead=startForIndex(i);}
function beginTrim(e,i,side){if(exporting)return;e.stopPropagation();e.preventDefault();pause();const startX=e.clientX,c=state.clips[i],from=side==='start'?c.in:c.out,rate=c.speed;
 let changed=false;const target=e.currentTarget;target.setPointerCapture(e.pointerId);
 const move=ev=>{const value=from+(ev.clientX-startX)/timelineScale*rate;if(!changed&&Math.abs(value-from)>.001){pushHistory();changed=true;}adjustClipTrim(i,side,value); const targetClip=els.clips.children[i];if(targetClip)targetClip.style.width=Math.max(8,durationOf(c)*timelineScale)+'px';renderAt(playhead,false);};
 const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);if(changed)modified();};
 target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
}
function beginReorder(e,i,el){if(exporting||e.button>0)return;const startX=e.clientX,startY=e.clientY;let armed=false,moved=false,panned=false,lastX=e.clientX;
 if(el.setPointerCapture)el.setPointerCapture(e.pointerId);
 const hold=setTimeout(()=>{if(!panned){armed=true;el.classList.add('dragging');}},360);
 const move=ev=>{const distance=Math.hypot(ev.clientX-startX,ev.clientY-startY);if(distance>8&&!armed){clearTimeout(hold);panned=true;el.dataset.dragged='1';els.timelineViewport.scrollLeft+=lastX-ev.clientX;}lastX=ev.clientX;if(armed&&distance>8){moved=true;el.style.transform='translateX('+(ev.clientX-startX)+'px)';el.style.zIndex='5';}};
 const end=ev=>{clearTimeout(hold);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);
 if(moved){el.dataset.dragged='1';el.classList.remove('dragging');el.style.transform='';el.style.zIndex='';
 const siblings=[...els.clips.querySelectorAll('.clip-item')];const candidates=siblings.map((item,k)=>({k,rect:item.getBoundingClientRect()})).filter(x=>x.k!==i);
 const closest=candidates.sort((a,b)=>Math.abs(ev.clientX-(a.rect.left+a.rect.width/2))-Math.abs(ev.clientX-(b.rect.left+b.rect.width/2)))[0];const j=closest?.k;
 if(closest&&Number.isFinite(j)&&j!==i){pushHistory();const [item]=state.clips.splice(i,1);state.clips.splice(j,0,item);selected=j;playhead=startForIndex(j);modified();}}
 el.classList.remove('dragging');};
 el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
function selectClip(i){if(exporting)return;pause();selected=i;playhead=startForIndex(i);updateUI();const vp=els.timelineViewport;const x=playhead*timelineScale;if(x<vp.scrollLeft||x>vp.scrollLeft+vp.clientWidth-40)vp.scrollLeft=Math.max(0,x-20);}
function setTab(tab){if(exporting)return;document.getElementById('tools').style.height='';document.body.classList.add('tools-open');document.querySelectorAll('.tool-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tool-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));}
function drawImageFrame(src,look){const canvas=els.previewCanvas,{width:W,height:H}=canvas;
 const sw=src.videoWidth||src.naturalWidth,sh=src.videoHeight||src.naturalHeight;if(!sw||!sh)return;
 const rot=look.rotation||0,quarter=rot===90||rot===270,effectiveW=quarter?sh:sw,effectiveH=quarter?sw:sh;
 const scale=look.fit==='cover'?Math.max(W/effectiveW,H/effectiveH):Math.min(W/effectiveW,H/effectiveH);
 ctx.save();ctx.translate(W/2,H/2);ctx.rotate(rot*Math.PI/180);
 ctx.filter=`brightness(${look.brightness}%) contrast(${look.contrast}%) saturate(${look.saturation}%) grayscale(${look.grayscale}%)`;
 ctx.drawImage(src,-sw*scale/2,-sh*scale/2,sw*scale,sh*scale);ctx.restore();}
function drawFrame(){const canvas=els.previewCanvas,W=canvas.width,H=canvas.height;
 ctx.save();ctx.fillStyle='#0A0A12';ctx.fillRect(0,0,W,H);ctx.restore();
 const loc=locate(playhead);
 if(loc){const m=mediaMap.get(loc.c.mediaId);if(m){const source=m.kind==='image'?m.image:m.element;
 if(m.kind==='image'||source.readyState>=2){try{drawImageFrame(source,clipLook(loc.c));}catch(e){console.warn('Frame não pôde ser desenhado:',e);}}}}
 if(state.text.trim()&&playhead>=(state.textStart||0)&&playhead<=(state.textEnd??total())){
  let font=bound(state.fontSize,18,90)*W/480;
  ctx.save();ctx.font='700 '+font+'px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
  const maxWidth=W*.89;
  const lines=[];
  for(const paragraph of state.text.trim().split('\n')){
   let line='';for(const word of paragraph.split(/\s+/)){
    const candidate=line?line+' '+word:word;
    if(line&&ctx.measureText(candidate).width>maxWidth){lines.push(line);line=word;}else line=candidate;
   }lines.push(line);
  }
  const lineHeight=font*1.24,centerY=state.textPosition==='top'?H*.16:state.textPosition==='bottom'?H*.84:H*.5;
  ctx.lineWidth=Math.max(3,font*.10);ctx.strokeStyle='#000b';ctx.fillStyle=state.fontColor;
  for(const [i,line] of lines.entries()){
   const y=centerY+(i-(lines.length-1)/2)*lineHeight;
   if(y<font/2||y>H-font/2)continue;
   ctx.strokeText(line,W/2,y,maxWidth);ctx.fillText(line,W/2,y,maxWidth);
  }ctx.restore();
 }
}
function prepareAudio(m){if(!audioCtx){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audioCtx=new Audio();audioDest=audioCtx.createMediaStreamDestination();previewGain=audioCtx.createGain();previewGain.connect(audioCtx.destination);}if(!m||!m.element)return;if(!m.source){m.source=audioCtx.createMediaElementSource(m.element);m.gain=audioCtx.createGain();m.source.connect(m.gain);m.gain.connect(previewGain);m.gain.connect(audioDest);}m.gain.gain.value=(m.kind==='audio'?state.musicVolume:state.originalVolume)/100;previewGain.gain.value=exporting?0:1;}
async function activateAudio(){try{if(!audioCtx){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audioCtx=new Audio();audioDest=audioCtx.createMediaStreamDestination();previewGain=audioCtx.createGain();previewGain.connect(audioCtx.destination);}}if(audioCtx&&audioCtx.state==='suspended')await audioCtx.resume();}catch(e){console.warn('Áudio:',e);}}
function pauseMedia(){for(const m of mediaMap.values())if(m.element)m.element.pause();activeId=null;}
function syncMusic(t,doPlay){const m=mediaMap.get(state.musicId);if(!m||!m.element)return;const a=m.element;if(audioCtx)prepareAudio(m);if(m.duration&&Number.isFinite(m.duration)&&m.duration>0){const target=t%m.duration;if(Math.abs(a.currentTime-target)>.5)a.currentTime=target;}if(doPlay&&a.paused)a.play().catch(()=>{});else if(!doPlay&&!a.paused)a.pause();}
function renderAt(t,doPlay){playhead=bound(t,0,total());const loc=locate(playhead);if(loc){const m=mediaMap.get(loc.c.mediaId);if(m&&m.kind==='video'){const v=m.element,target=bound(loc.c.in+loc.offset*loc.c.speed,loc.c.in,Math.max(loc.c.in,loc.c.out-.02));if(activeId!==m.id){for(const other of mediaMap.values())if(other!==m&&other.element&&other.kind==='video')other.element.pause();activeId=m.id;}
 if(v.playbackRate!==loc.c.speed)v.playbackRate=loc.c.speed;
 if(Number.isFinite(target)&&Math.abs((v.currentTime||0)-target)>.24){try{v.currentTime=target;}catch(e){}}
 if(audioCtx)prepareAudio(m);
 if(doPlay){if(v.paused)v.play().catch(()=>{});}else if(!v.paused)v.pause();}
 else if(m){pauseMedia();}}
 else pauseMedia();syncMusic(playhead,doPlay);drawFrame();els.currentTime.textContent=ftime1(playhead);const pct=total()>0?playhead/total()*100:0;els.scrubberProgress.style.width=pct+'%';els.scrubberThumb.style.left=pct+'%';els.scrubber.setAttribute('aria-valuenow',String(Math.round(playhead)));updateTimelineCursor();}
function setPlayIcon(){els.playBtn.innerHTML=playing?'<svg><use href="#i-pause"/></svg>':'<svg><use href="#i-play"/></svg>';els.playBtn.setAttribute('aria-label',playing?'Pausar':'Reproduzir');}
function tick(){if(!playing)return;const now=(performance.now()-playbackStarted)/1000,finished=now>=total();renderAt(finished?total():now,!finished);if(exporting){const progress=total()>0?100*playhead/total():0;els.exportProgress.style.width=progress+'%';els.exportProgressText.textContent=Math.round(progress)+'% · '+ftime1(playhead)+' / '+ftime1(total());}if(finished){if(exporting){stopExport(false);}else pause();return;}rafId=requestAnimationFrame(tick);}
async function play(){if(exporting||!state.clips.length)return;if(playhead>=total()-.03)playhead=0;await activateAudio();if(audioCtx)for(const m of mediaMap.values())if(m.kind==='video'||m.id===state.musicId)prepareAudio(m);playing=true;playbackStarted=performance.now()-playhead*1000;setPlayIcon();cancelAnimationFrame(rafId);tick();}
function pause(){if(!playing)return;playing=false;cancelAnimationFrame(rafId);pauseMedia();if(musicElement)musicElement.pause();setPlayIcon();drawFrame();}
function seek(time){if(exporting)return;const wasPlaying=playing;pause();renderAt(time,false);if(wasPlaying)play();}
function split(){const c=selectedClip();if(!c||exporting)return;const st=startForIndex(selected),position=bound(playhead-st,0,(c.out-c.in)/c.speed),at=c.in+position*c.speed;if(at<=c.in+.10||at>=c.out-.10){toast('Posicione o cursor dentro do clipe para dividir.');return;}pushHistory();const second={...c,id:idGen(),in:at};c.out=at;state.clips.splice(selected+1,0,second);selected++;modified();toast('Clipe dividido.');}
function shiftSelected(offset){const c=selectedClip();if(!c||exporting)return;const j=selected+offset;if(j<0||j>=state.clips.length)return;pushHistory();state.clips[selected]=state.clips[j];state.clips[j]=c;selected=j;playhead=startForIndex(j);modified();}
function deleteSelected(){if(!selectedClip()||exporting)return;pushHistory();state.clips.splice(selected,1);selected=Math.min(selected,state.clips.length-1);playhead=bound(playhead,0,total());pause();modified();sweepMedia();}
function changeTrim(which){const c=selectedClip();if(!c||exporting)return;const m=mediaMap.get(c.mediaId);const value=Number(els[which].value);if(which==='trimStart'){c.in=bound(value,0,c.out-.1);}else{c.out=bound(value,c.in+.1,m.duration);}els.trimStartValue.textContent=c.in.toFixed(1)+'s';els.trimEndValue.textContent=c.out.toFixed(1)+'s';playhead=startForIndex(selected);renderAt(playhead,false);scheduleSave();}
function setupSimpleControls(){
 document.querySelectorAll('.tool-tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
 $('closeTools').onclick=()=>{document.body.classList.remove('tools-open');$('tools').style.height='';};
 setupSheetGesture();
 for(const id of ['emptyImport','addClip'])$(id).onclick=()=>{if(!exporting)els.mediaInput.click();};
 els.mediaInput.addEventListener('change',e=>addClips(Array.from(e.target.files||[])));
 for(const id of ['addMusicMini','addAudio'])$(id).onclick=()=>{if(!exporting)els.audioInput.click();};
 els.audioInput.addEventListener('change',e=>addAudio(Array.from(e.target.files||[])));
 $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
 els.playBtn.onclick=()=>playing?pause():play();$('backwardBtn').onclick=()=>seek(playhead-5);$('forwardBtn').onclick=()=>seek(playhead+5);
 els.scrubber.addEventListener('pointerdown',e=>{if(exporting||!state.clips.length)return;const wasPlaying=playing;pause();const point=ev=>{const r=els.scrubber.getBoundingClientRect();renderAt(total()*bound((ev.clientX-r.left)/r.width,0,1),false);};els.scrubber.setPointerCapture(e.pointerId);point(e);const move=ev=>point(ev);const end=()=>{els.scrubber.removeEventListener('pointermove',move);els.scrubber.removeEventListener('pointerup',end);els.scrubber.removeEventListener('pointercancel',end);if(wasPlaying)play();};els.scrubber.addEventListener('pointermove',move);els.scrubber.addEventListener('pointerup',end);els.scrubber.addEventListener('pointercancel',end);});
 els.scrubber.onkeydown=e=>{if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();seek(playhead+(e.key==='ArrowRight'?1:-1));}};
 els.timelineRuler.addEventListener('pointerdown',e=>{if(exporting)return;const r=els.timelineRuler.getBoundingClientRect();seek(bound((e.clientX-r.left)/timelineScale,0,total()));});
 $('zoomIn').onclick=()=>zoomTimeline(1.3);$('zoomOut').onclick=()=>zoomTimeline(1/1.3);
 els.timelineViewport.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();zoomTimeline(e.deltaY<0?1.15:1/1.15);}}, {passive:false});
 const touches=new Map();let pinching=0;
 els.timelineViewport.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){const v=[...touches.values()];pinching=Math.hypot(v[1].x-v[0].x,v[1].y-v[0].y);}}});
 els.timelineViewport.addEventListener('pointermove',e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){const v=[...touches.values()],d=Math.hypot(v[1].x-v[0].x,v[1].y-v[0].y);if(pinching&&Math.abs(d-pinching)>16){zoomTimeline(d/pinching);pinching=d;}}});
 const release=e=>{touches.delete(e.pointerId);if(touches.size<2)pinching=0;};els.timelineViewport.addEventListener('pointerup',release);els.timelineViewport.addEventListener('pointercancel',release);
 $('splitClip').onclick=split;$('deleteClip').onclick=deleteSelected;$('moveLeft').onclick=()=>shiftSelected(-1);$('moveRight').onclick=()=>shiftSelected(1);
 $('duplicateClip').onclick=()=>{if(exporting||!selectedClip())return;pushHistory();state.clips.splice(selected+1,0,{...clone(selectedClip()),id:idGen()});selected++;playhead=startForIndex(selected);modified();};
 for(const id of ['trimStart','trimEnd']){bindHistoryInput(els[id]);els[id].addEventListener('change',()=>{changeTrim(id);updateUI();});els[id].addEventListener('input',()=>changeTrim(id));}
 document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{const c=selectedClip();if(!c||exporting)return;pushHistory();c.speed=Number(b.dataset.speed);playhead=startForIndex(selected);modified();});
 for(const name of ['brightness','contrast','saturation','grayscale','originalVolume','musicVolume']){
  const el=$(name);bindHistoryInput(el);
  el.addEventListener('input',()=>{if(exporting)return;const value=Number(el.value);if(['originalVolume','musicVolume'].includes(name))state[name]=value;else updateLook(name,value);
   $(name+'Value').textContent=value+'%';if(audioCtx){for(const m of mediaMap.values())if(m.gain)m.gain.gain.value=(m.kind==='audio'?state.musicVolume:state.originalVolume)/100;}
   drawFrame();scheduleSave();});
 }
 for(const name of ['fitMode','rotation'])$(name).onchange=e=>{if(exporting)return;pushHistory();updateLook(name==='fitMode'?'fit':'rotation',name==='rotation'?Number(e.target.value):e.target.value);modified();};
 $('resetLook').onclick=()=>{if(exporting)return;pushHistory();const reset={brightness:100,contrast:100,saturation:100,grayscale:0,fit:'cover',rotation:0};
  if(selectedClip())selectedClip().look=reset;else Object.assign(state,reset);modified();};
 els.overlayText.addEventListener('beforeinput',()=>snapshotGesture(els.overlayText));
 els.overlayText.addEventListener('blur',()=>activeGestures.delete(els.overlayText));
 els.overlayText.oninput=e=>{if(exporting)return;state.text=e.target.value;drawFrame();scheduleSave();};
 for(const id of ['fontSize','fontColor']){const el=els[id];bindHistoryInput(el);el.addEventListener('input',e=>{if(exporting)return;state[id]=id==='fontSize'?Number(e.target.value):e.target.value;drawFrame();scheduleSave();});}
 for(const id of ['textStart','textEnd']){const el=els[id];el.addEventListener('focus',()=>snapshotGesture(el));el.addEventListener('blur',()=>activeGestures.delete(el));el.addEventListener('change',()=>{if(exporting)return;state.textStart=Math.max(0,Number(els.textStart.value)||0);state.textEnd=Math.max(state.textStart,Number(els.textEnd.value)||0);modified();});}
 document.querySelectorAll('[data-position]').forEach(b=>b.onclick=()=>{if(exporting)return;pushHistory();state.textPosition=b.dataset.position;modified();});
 $('removeAudio').onclick=removeMusic;
 document.querySelectorAll('[data-aspect]').forEach(b=>b.onclick=()=>{if(exporting)return;pushHistory();state.aspect=b.dataset.aspect;modified();});
 els.resolution.onchange=e=>{if(exporting)return;pushHistory();state.resolution=Number(e.target.value);modified();};
 els.frameRate.onchange=e=>{if(exporting)return;pushHistory();state.fps=Number(e.target.value);modified();};
 els.projectName.addEventListener('change',e=>{if(exporting)return;pushHistory();state.name=e.target.value.trim()||'Meu vídeo';modified();});
 $('newProject').onclick=async()=>{if(exporting)return;if(state.clips.length&&!confirm('Criar um novo projeto? O projeto atual será substituído.'))return;
  pause();state=defaults();releaseAllMedia();selected=-1;playhead=0;musicElement=null;history=[];future=[];await clearDB().catch(()=>{});modified();toast('Novo projeto criado.');};
 for(const id of ['exportTop','exportPanel'])$(id).onclick=openExport;
 $('closeModal').onclick=$('cancelExport').onclick=()=>{if(exporting){stopExport(true);}else els.exportModal.hidden=true;};els.startExport.onclick=startExport;
 document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();return;}if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();return;}
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(e.code==='Space'){e.preventDefault();playing?pause():play();}});
}
function setupSheetGesture(){
 const sheet=$('tools'),head=sheet.querySelector('.tools-heading');
 head.addEventListener('pointerdown',e=>{
  if(e.target.closest('button'))return;
  const startY=e.clientY,startHeight=sheet.getBoundingClientRect().height;
  let changed=false;
  head.setPointerCapture(e.pointerId);
  const move=ev=>{const difference=startY-ev.clientY;if(Math.abs(difference)>7)changed=true;
   if(changed){sheet.style.transition='none';sheet.style.height=bound(startHeight+difference,135,window.innerHeight-40)+'px';}};
  const end=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',end);head.removeEventListener('pointercancel',end);
   sheet.style.transition='';const height=sheet.getBoundingClientRect().height;
   if(height<180){document.body.classList.remove('tools-open');sheet.style.height='';}
   else sheet.style.height=height>window.innerHeight*.65?Math.round(Math.min(window.innerHeight*.85,620))+'px':Math.round(Math.min(window.innerHeight*.65,530))+'px';};
  head.addEventListener('pointermove',move);head.addEventListener('pointerup',end);head.addEventListener('pointercancel',end);
 });
}
function zoomTimeline(multiplier){const viewport=els.timelineViewport,centerTime=(viewport.scrollLeft+viewport.clientWidth/2)/timelineScale;
 timelineScale=Math.round(bound(timelineScale*multiplier,8,100));renderTimeline();viewport.scrollLeft=Math.max(0,centerTime*timelineScale-viewport.clientWidth/2);}
function snapshotGesture(el){if(exporting)return;if(!activeGestures.has(el)){pushHistory();activeGestures.add(el);}}
function bindHistoryInput(el){el.addEventListener('pointerdown',()=>snapshotGesture(el));el.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(e.key))snapshotGesture(el);});
 el.addEventListener('pointerup',()=>activeGestures.delete(el));el.addEventListener('keyup',()=>activeGestures.delete(el));el.addEventListener('blur',()=>activeGestures.delete(el));}
function releaseAllMedia(){for(const m of mediaMap.values())releaseMedia(m);mediaMap.clear();}
function releaseMedia(m){try{m.element?.pause();m.source?.disconnect();m.gain?.disconnect();m.element?.removeAttribute('src');m.element?.load();m.image?.removeAttribute('src');URL.revokeObjectURL(m.url);}catch(e){console.warn('Liberação de mídia:',e);}}
function sweepMedia(){const used=new Set();for(const s of [state,...history,...future]){for(const c of s.clips)used.add(c.mediaId);if(s.musicId)used.add(s.musicId);}
 for(const [id,m] of mediaMap)if(!used.has(id)){releaseMedia(m);mediaMap.delete(id);if(db)dbDelete('media',id).catch(console.warn);}}
function dbDelete(store,key){return new Promise((res,rej)=>{if(!db)return res();const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
function exportMime(){if(!window.MediaRecorder||!MediaRecorder.isTypeSupported)return null;const withAudio=Boolean(state.musicId||state.clips.some(c=>mediaMap.get(c.mediaId)?.kind==='video'));const formats=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"',...(!withAudio?['video/mp4;codecs="avc1.42E01E"']:[]),'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];return formats.find(m=>MediaRecorder.isTypeSupported(m))||null;}
function openExport(){if(!state.clips.length){toast('Adicione pelo menos um vídeo ou uma foto.');return;}if(exporting)return;const mime=exportMime(),size=ranges();els.exportFormat.textContent=mime?mime.startsWith('video/mp4')?'MP4':'WebM':'Não disponível';els.exportResolution.textContent=size.w+' × '+size.h;els.exportDuration.textContent=ftime1(total());els.exportDescription.textContent=mime?'O arquivo será processado localmente no seu dispositivo.':'Este navegador não oferece gravação de vídeo em canvas. Tente atualizar o Chrome.';els.exportProgress.style.width='0%';els.exportProgressText.textContent='Pronto para começar';els.startExport.disabled=!mime;els.startExport.textContent='Iniciar exportação';els.exportModal.hidden=false;}
async function startExport(){if(exporting||!state.clips.length)return;const mime=exportMime();if(!mime){toast('Exportação não é suportada neste navegador.');return;}pause();exportCancelled=false;exportChunks=[];exporting=true;document.body.classList.add('export-lock');els.startExport.disabled=true;els.startExport.textContent='Processando…';els.exportProgress.style.width='0%';const oldW=els.previewCanvas.width,oldH=els.previewCanvas.height;try{
 await activateAudio();if(audioCtx)for(const m of mediaMap.values())if(m.kind==='video'||m.id===state.musicId)prepareAudio(m);if(previewGain)previewGain.gain.value=0;
 const {w,h}=ranges();els.previewCanvas.width=w;els.previewCanvas.height=h;
 renderAt(0,false);
 if(typeof els.previewCanvas.captureStream!=='function')throw new Error('Seu navegador não permite captura de canvas.');
 const captured=els.previewCanvas.captureStream(Number(state.fps));const tracks=[...captured.getVideoTracks()];if(audioDest&& (state.clips.some(c=>mediaMap.get(c.mediaId)?.kind==='video')||state.musicId)){tracks.push(...audioDest.stream.getAudioTracks());}
 exportStream=new MediaStream(tracks);
 exportRecorder=new MediaRecorder(exportStream,{mimeType:mime,videoBitsPerSecond:state.resolution>=1080?6500000:state.resolution>=720?3500000:1800000,audioBitsPerSecond:128000});
 exportRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)exportChunks.push(e.data);};
 exportRecorder.onerror=e=>{console.error('Erro MediaRecorder:',e);toast('Erro durante exportação.');stopExport(true);};
 exportRecorder.onstop=async()=>{const cancelled=exportCancelled,rec=exportRecorder;let chunks=exportChunks.slice();exportRecorder=null;exportChunks=[];if(exportStream){exportStream.getTracks().forEach(t=>t.stop());exportStream=null;}
 playing=false;exporting=false;document.body.classList.remove('export-lock');pauseMedia();if(musicElement)musicElement.pause();if(previewGain)previewGain.gain.value=1;els.previewCanvas.width=oldW;els.previewCanvas.height=oldH;renderAt(0,false);setPlayIcon();syncHistoryButtons();els.startExport.disabled=false;els.startExport.textContent='Iniciar exportação';
 if(cancelled){els.exportModal.hidden=true;toast('Exportação cancelada.');}if(!cancelled&&chunks.length){const realMime=rec?.mimeType||mime,extension=realMime.includes('mp4')?'mp4':'webm',blob=new Blob(chunks,{type:realMime}),name=(state.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\-_. ]/gi,'').trim()||'videoedit')+'-'+Date.now()+'.'+extension;try{await saveVideoBlob(blob,name,realMime);els.exportProgress.style.width='100%';els.exportProgressText.textContent='Concluído! '+(blob.size/1024/1024).toFixed(1)+' MB · '+extension.toUpperCase();toast('Vídeo exportado!');}catch(e){console.error(e);els.exportProgressText.textContent='Não foi possível salvar: '+e.message;toast('Falha ao salvar o vídeo.');}}
 else{els.exportProgressText.textContent=cancelled?'Exportação cancelada':'O navegador não gerou dados de vídeo.';if(!cancelled)toast('Falha ao gerar o vídeo.');}
 };
 exportRecorder.start(250);playing=true;playhead=0;playbackStarted=performance.now();setPlayIcon();cancelAnimationFrame(rafId);tick();
 }catch(e){console.error(e);exportCancelled=true;exporting=false;document.body.classList.remove('export-lock');playing=false;cancelAnimationFrame(rafId);pauseMedia();if(previewGain)previewGain.gain.value=1;if(exportStream){exportStream.getTracks().forEach(t=>t.stop());exportStream=null;}els.previewCanvas.width=oldW;els.previewCanvas.height=oldH;renderAt(0,false);setPlayIcon();els.startExport.disabled=false;els.startExport.textContent='Iniciar exportação';els.exportProgressText.textContent=e.message;toast('Exportação falhou: '+e.message);}}
function stopExport(cancelled){if(!exporting)return;exportCancelled=!!cancelled;playing=false;cancelAnimationFrame(rafId);pauseMedia();if(musicElement)musicElement.pause();if(cancelled)els.exportProgressText.textContent='Cancelando…';try{if(exportRecorder&&exportRecorder.state!=='inactive')exportRecorder.stop();else{exporting=false;}}catch(e){console.error(e);exporting=false;} }
async function saveVideoBlob(blob,name,mime){if(window.NativeSaver&&typeof window.NativeSaver.beginSave==='function'){// Em um APK Android, salvar diretamente em Movies/VideoEditor.
 let started=false;try{const result=window.NativeSaver.beginSave(name,mime,blob.size);if(result!=='OK')throw new Error(String(result));started=true;const bytesPerChunk=128*1024;for(let pos=0;pos<blob.size;pos+=bytesPerChunk){const b=await blob.slice(pos,pos+bytesPerChunk).arrayBuffer();const u=new Uint8Array(b);let binary='';for(let k=0;k<u.length;k+=8192)binary+=String.fromCharCode(...u.subarray(k,k+8192));let status=window.NativeSaver.appendData(btoa(binary));if(status!=='OK')throw new Error(String(status));els.exportProgressText.textContent='Salvando no aparelho: '+Math.round(100*(pos+u.length)/blob.size)+'%';}const end=window.NativeSaver.finishSave();if(end!=='OK')throw new Error(String(end));return;}catch(e){if(started&&window.NativeSaver.cancelSave)window.NativeSaver.cancelSave();throw e;}}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.textContent='Salvar vídeo';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
// IndexedDB: apenas dados locais, sem envio pela rede.
function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window)){reject(Error('IndexedDB não suportado'));return;}let r=indexedDB.open('videoeditor-mobile-db',1);r.onupgradeneeded=()=>{let d=r.result;if(!d.objectStoreNames.contains('media'))d.createObjectStore('media',{keyPath:'id'});if(!d.objectStoreNames.contains('project'))d.createObjectStore('project',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbPut(store,obj){return new Promise((resolve,reject)=>{if(!db){reject(Error('Banco não disponível'));return;}let t=db.transaction(store,'readwrite');t.objectStore(store).put(obj);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
function dbGet(store,key){return new Promise((resolve,reject)=>{if(!db){reject(Error('Banco não disponível'));return;}let t=db.transaction(store,'readonly'),r=t.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function saveMediaToDB(m){if(!db)return;await dbPut('media',{id:m.id,file:m.file,kind:m.kind});}
async function saveProject(){if(!db){els.saveState.textContent='Sessão atual';return;}try{await dbPut('project',{key:'active',state});els.saveState.textContent='Salvo no aparelho';}catch(e){els.saveState.textContent='Sem salvamento';console.warn('Projeto não salvo:',e);}}
function clearDB(){return new Promise((resolve,reject)=>{if(!db){resolve();return;}let t=db.transaction(['media','project'],'readwrite');t.objectStore('media').clear();t.objectStore('project').clear();t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
async function restore(){try{db=await openDB();const data=await dbGet('project','active');if(!data?.state)return;let old=data.state;let s={...defaults(),...old};const needed=new Set(s.clips.map(c=>c.mediaId));if(s.musicId)needed.add(s.musicId);let loaded=0;for(const id of needed){const item=await dbGet('media',id);if(!item)continue;try{await createMedia(item.file,item.id,item.kind);loaded++;}catch(e){console.warn('Mídia não restaurada:',e);}}
 s.clips=s.clips.filter(c=>mediaMap.has(c.mediaId));if(!mediaMap.has(s.musicId))s.musicId=null;state=s;musicElement=mediaMap.get(s.musicId)?.element||null;selected=state.clips.length?0:-1;if(loaded)toast('Projeto restaurado do aparelho.');}
 catch(e){console.warn('Persistência indisponível:',e);els.saveState.textContent='Sessão atual';}}
async function init(){setupSimpleControls();previewSize();drawFrame();await restore();updateUI();if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol)){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline não disponível:',e));}if(!exportMime())console.warn('Gravação de vídeo indisponível neste navegador.');}
init().catch(e=>{console.error(e);toast('Falha na inicialização.');});
// Interface para testes locais, sem acesso a rede ou arquivos fora do aplicativo.
window.__videoEditorTest={getState:()=>clone(state),getTimelineDuration:total,selectClip,seek,exportMime,undo,redo,zoomTimeline,snapshot:()=>({selected,playhead,timelineScale,media:mediaMap.size,exporting})};
