import type { MotionLayer, MotionLayerContent, MotionScene } from '../../../shared/motion'

const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
const scriptSafe = (value: string) => value.replace(/<\/script/gi, '<\\/script')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function defaultLayerContent(layer: MotionLayer): MotionLayerContent {
  const alignment = layer.textAlign ?? (layer.type === 'label' && layer.radius ? 'center' : 'left')
  const labelLayout = layer.type === 'label' ? `\n  display: flex;\n  align-items: center;\n  justify-content: ${alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start'};` : ''
  return { html: `<div class="layer-content">${escapeHtml(layer.text ?? '')}</div>`, css: `.layer-content {\n  width: 100%;\n  height: 100%;\n  white-space: pre-wrap;${labelLayout}\n}` }
}

export function buildSceneDocument(scene: MotionScene, gsapSource: string, fontDataUrl?: string): string {
  const fontFace = fontDataUrl ? `@font-face{font-family:Inter;src:url(${fontDataUrl});font-weight:500;font-display:block}` : ''
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${fontFace}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${scene.background}}body{font-family:Inter,Arial,sans-serif}#scene{position:absolute;width:${scene.width}px;height:${scene.height}px;transform-origin:0 0;overflow:hidden;background:${scene.background}}.motion-layer{position:absolute;transform-origin:center;white-space:pre-wrap;line-height:1;letter-spacing:-.045em}.motion-layer[hidden]{display:none!important}.motion-label{letter-spacing:.14em;display:flex;align-items:center;line-height:1.1}.motion-shape{border:1.5px solid currentColor}.motion-orb{border-radius:50%;background:radial-gradient(circle at 31% 25%,#ffe8fc 0%,var(--color) 18%,#bc55b7 47%,#652c69 70%,#241526 94%);box-shadow:inset -22px -24px 50px #0005,inset 14px 12px 30px #ffffff12,0 30px 130px #ed76e328}.motion-orb::after{content:'';position:absolute;inset:8%;border:1px solid #ffffff26;border-radius:50%;transform:rotate(-30deg) scaleX(.3)}
</style></head><body><main id="scene"></main><script>${scriptSafe(gsapSource)}</script><script>
const sceneData=${safeJson(scene)};
const sceneRoot=document.getElementById('scene');
gsap.config({force3D:false});
const timeline=gsap.timeline({paused:true,defaults:{lazy:false,force3D:false}});
const selectedTargets=new Map();
const customLayerRoots=[];
function appendLayerContent(element,layer){
  const host=document.createElement('div');host.className='motion-custom-content';Object.assign(host.style,{width:'100%',height:'100%',minWidth:'0',minHeight:'0'});element.appendChild(host);
  const root=host.attachShadow({mode:'open'});const template=document.createElement('template');template.innerHTML=layer.customContent.html;
  for(const node of template.content.querySelectorAll('script,iframe,object,embed,link,meta,base'))node.remove();
  for(const node of template.content.querySelectorAll('*'))for(const attribute of Array.from(node.attributes)){
    const name=attribute.name.toLowerCase();const value=attribute.value.replace(/[\\u0000-\\u0020]/g,'').toLowerCase();
    if(name.startsWith('on')||name==='srcdoc'||((name==='href'||name==='xlink:href'||name==='src')&&/^(?:javascript|vbscript):/.test(value)))node.removeAttribute(attribute.name);
  }
  const style=document.createElement('style');style.textContent=':host{display:block;isolation:isolate}*,*::before,*::after{box-sizing:border-box}'+layer.customContent.css;
  const clockStyle=document.createElement('style');clockStyle.textContent=':host,:host::before,:host::after,*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
  root.append(style,template.content,clockStyle);customLayerRoots.push({root,layer});
}
function fit(){sceneRoot.style.transform='scale('+Math.min(innerWidth/sceneData.width,innerHeight/sceneData.height)+')';}
fit(); addEventListener('resize',fit);
for(const layer of sceneData.layers){
  const element=document.createElement('div');element.id=layer.id;element.className='motion-layer motion-'+layer.type;element.dataset.layerId=layer.id;
  Object.assign(element.style,{left:layer.x+'px',top:layer.y+'px',width:layer.width+'px',height:layer.height+'px',color:layer.color,fontSize:(layer.fontSize??32)+'px',fontWeight:String(layer.fontWeight??400),fontFamily:layer.fontFamily??'Inter,Arial,sans-serif',fontStyle:layer.fontStyle??'normal',textAlign:layer.textAlign??(layer.type==='label'&&layer.radius?'center':'left'),textTransform:layer.textTransform??'none',textDecoration:layer.textDecoration??'none',borderRadius:(layer.radius??0)+'px',padding:(layer.padding??0)+'px',webkitTextStrokeWidth:(layer.textStrokeWidth??0)+'px',webkitTextStrokeColor:layer.textStrokeColor??layer.color,paintOrder:'stroke fill',opacity:String(layer.opacity),visibility:layer.hidden?'hidden':'visible'});
  element.style.setProperty('--color',layer.color);
  if(layer.type==='orb')element.style.borderRadius='50%';
  if(layer.type==='label'&&layer.radius){element.style.border='1px solid #ffffff25';element.style.justifyContent='center';element.style.background='#ffffff04';}
  if(layer.lineHeight!==undefined)element.style.lineHeight=String(layer.lineHeight);
  if(layer.letterSpacing!==undefined)element.style.letterSpacing=layer.letterSpacing+'px';
  if(layer.backgroundColor!==undefined)element.style.background=layer.backgroundColor;
  if(layer.borderWidth!==undefined||layer.borderColor!==undefined||layer.borderStyle!==undefined){element.style.borderStyle=layer.borderStyle??'solid';element.style.borderWidth=(layer.borderWidth??(layer.type==='shape'?1.5:layer.type==='label'&&layer.radius?1:0))+'px';element.style.borderColor=layer.borderColor??(layer.type==='label'&&layer.radius?'#ffffff25':layer.color);}
  if(layer.type==='label'&&layer.textAlign!==undefined)element.style.justifyContent=layer.textAlign==='center'?'center':layer.textAlign==='right'?'flex-end':'flex-start';
  if(layer.customContent)appendLayerContent(element,layer);else element.textContent=layer.text??'';
  sceneRoot.appendChild(element);selectedTargets.set(layer.id,element);
  gsap.set(element,{x:0,y:0,rotation:layer.rotation,scale:layer.scale,opacity:layer.opacity});
  const frames=[...layer.keyframes].sort((a,b)=>a.time-b.time);
  let previous=0;
  for(const frame of frames){const values={};for(const key of ['x','y','scale','rotation','opacity'])if(frame[key]!==undefined)values[key]=key==='x'?frame[key]-layer.x:key==='y'?frame[key]-layer.y:frame[key];
    if(frame.time===0){gsap.set(element,values);timeline.set(element,values,0);}else timeline.to(element,{...values,duration:frame.time-previous,ease:frame.ease??layer.ease},previous);previous=frame.time;}
}
${scene.customCode ? `sceneRoot.innerHTML=${safeJson(scene.customCode.html)};const customStyle=document.createElement('style');customStyle.textContent=${safeJson(scene.customCode.css)};document.head.appendChild(customStyle);timeline.clear();try{${scriptSafe(scene.customCode.js)}}catch(error){window.__ONUN_ERROR__=String(error);}` : ''}
let requestedTime=0;
function seek(time){const t=Math.min(sceneData.duration,Math.max(0,Number(time)||0));requestedTime=t;timeline.pause().seek(0,true).seek(t,true);for(const layer of sceneData.layers){const element=selectedTargets.get(layer.id);if(element){const hidden=layer.hidden||t<layer.start||t>layer.end;element.hidden=hidden;element.style.visibility=hidden?'hidden':'visible';}}for(const {root,layer} of customLayerRoots)for(const node of [root.host,...root.querySelectorAll('*')])for(const animation of node.getAnimations()){animation.pause();animation.currentTime=Math.max(0,t-layer.start)*1000;}return t;}
window.__ONUN_MOTION__={ready:false,duration:sceneData.duration,seek,timeline};
addEventListener('message',event=>{if(event.source!==parent)return;if(event.data?.type==='onun:pick'){const element=document.elementFromPoint(Number(event.data.x),Number(event.data.y))?.closest('[data-layer-id]');if(element)parent.postMessage({type:'onun:layer',id:element.dataset.layerId},'*');}if(event.data?.type==='onun:seek'){seek(event.data.time);if(event.data.requestId)parent.postMessage({type:'onun:rendered',requestId:event.data.requestId},'*')}if(event.data?.type==='onun:transform'){const layer=sceneData.layers.find(item=>item.id===event.data.id);const element=selectedTargets.get(event.data.id);if(element&&layer)gsap.set(element,{x:event.data.x-layer.x,y:event.data.y-layer.y});}if(event.data?.type==='onun:select'||event.data?.type==='onun:transform'){const element=document.getElementById(event.data.id);const layer=sceneData.layers.find(item=>item.id===event.data.id);if(element&&layer){const rect=element.getBoundingClientRect();parent.postMessage({type:'onun:bounds',id:event.data.id,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},values:{x:layer.x+Number(gsap.getProperty(element,'x')),y:layer.y+Number(gsap.getProperty(element,'y')),scale:Number(gsap.getProperty(element,'scaleX')),rotation:Number(gsap.getProperty(element,'rotation')),opacity:Number(gsap.getProperty(element,'opacity'))}},'*');}}});
sceneRoot.addEventListener('pointerdown',event=>{const element=event.target.closest('[data-layer-id]');if(element)parent.postMessage({type:'onun:layer',id:element.dataset.layerId},'*');});
Promise.all([document.fonts.ready,...[...document.images,...customLayerRoots.flatMap(({root})=>Array.from(root.querySelectorAll('img')))].map(img=>img.decode().catch(()=>{}))]).then(()=>{seek(requestedTime);window.__ONUN_MOTION__.ready=true;parent.postMessage({type:'onun:ready',error:window.__ONUN_ERROR__},'*');});
</script></body></html>`
}
