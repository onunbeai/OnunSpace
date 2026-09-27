import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {createMotionLayer,defaultScene,validateMotionScene,type MotionLayer,type MotionScene} from '../shared/motion'
import {buildSceneDocument,defaultLayerContent} from '../src/features/motion/sceneDocument'
import {RenderQueue} from '../server/render'

const require=createRequire(import.meta.url)
const textLayer=():MotionLayer=>({id:'typography',name:'Typography',type:'text',x:20,y:20,width:360,height:150,rotation:0,opacity:1,scale:1,color:'#ffffff',text:'Aa motion',fontSize:30,fontWeight:600,start:0,end:2,ease:'none',keyframes:[]})
const fixture=():MotionScene=>({id:'appearance-fixture',name:'Appearance fixture',width:640,height:360,fps:10,duration:2,background:'#111111',layers:[textLayer()]})
const appearance={fontFamily:'Arial, sans-serif',fontStyle:'italic' as const,textAlign:'right' as const,lineHeight:1.5,letterSpacing:3,textTransform:'uppercase' as const,textDecoration:'underline' as const,backgroundColor:'#123456',borderColor:'#ff87f7',borderWidth:3,borderStyle:'dashed' as const,padding:12,textStrokeWidth:1,textStrokeColor:'#000000'}
type RuntimeWindow=Window&{__ONUN_MOTION__:{ready:boolean;seek(time:number):number};__bad?:boolean;__layerMessages?:string[]}

test('optional layer appearance is preserved and cloned; invalid properties and layer JavaScript are rejected',()=>{
 const scene=fixture();Object.assign(scene.layers[0],appearance,{customContent:{html:'<strong>Editable</strong>',css:'strong{font:inherit}'}})
 const validated=validateMotionScene(scene);assert.deepEqual(validated,scene);assert.notEqual(validated.layers[0].customContent,scene.layers[0].customContent)
 assert.deepEqual(validateMotionScene(defaultScene),defaultScene)
 const invalid:Record<string,unknown>[]=[{fontFamily:''},{fontFamily:'x'.repeat(201)},{fontFamily:'Arial\nserif'},{fontStyle:'oblique'},{textAlign:'start'},{lineHeight:0},{lineHeight:Infinity},{letterSpacing:-201},{letterSpacing:1001},{textTransform:'small-caps'},{textDecoration:'blink'},{backgroundColor:'red'},{borderColor:'#fff'},{borderWidth:-1},{borderWidth:1001},{borderStyle:'double'},{padding:NaN},{padding:1001},{textStrokeWidth:101},{textStrokeColor:'transparent'},{customContent:null},{customContent:{html:'',css:'',js:'alert(1)'}},{customContent:{html:'x'.repeat(100001),css:''}},{customContent:{html:'',css:'x'.repeat(50001)}}]
 for(const patch of invalid){const candidate=fixture();Object.assign(candidate.layers[0],patch);assert.throws(()=>validateMotionScene(candidate),JSON.stringify(Object.keys(patch)))}
})

test('new shapes have explicit fill and new text/labels fit small scenes; native HTML starter escapes text',()=>{
 const scene={...fixture(),width:320,height:180};const shape=createMotionLayer('shape',scene)
 assert.equal(shape.backgroundColor,'#ff87f7');assert.equal(shape.borderWidth,0)
 for(const type of ['text','label'] as const){const layer=createMotionLayer(type,scene);assert.ok(layer.text);assert.ok(layer.fontSize!>0);assert.ok(layer.x>=0&&layer.y>=0&&layer.x+layer.width<=scene.width&&layer.y+layer.height<=scene.height)}
 const layer={...textLayer(),text:'<img onerror="bad()"> & text'};const content=defaultLayerContent(layer)
 assert.ok(content.html.includes('&lt;img'));assert.ok(content.html.includes('&amp;'));assert.ok(!content.html.includes('<img'));assert.deepEqual(layer.keyframes,[])
})

test('Chromium renders appearance, legacy outlines and isolated HTML/CSS with deterministic keyframes and CSS animation',async()=>{
 const scene=fixture();Object.assign(scene.layers[0],appearance)
 const legacy:MotionLayer={...textLayer(),id:'legacy',name:'Legacy outline',type:'shape',x:430,y:20,width:80,height:80,text:undefined,color:'#ff87f7'}
 const filled:MotionLayer={...legacy,id:'filled',x:530,backgroundColor:'#ff87f7',borderWidth:0}
 const custom:MotionLayer={...textLayer(),id:'custom',x:20,y:210,width:260,height:110,text:'Native text',fontSize:20,end:1.8,keyframes:[{time:0,x:20},{time:2,x:220}],customContent:{html:'<span id="scoped-text" onclick="window.__bad=true">Scoped content</span><script>window.__bad=true</script><iframe srcdoc="bad"></iframe>',css:':host{animation:hostPulse 2s linear infinite}body,.motion-layer{color:red!important}#scoped-text{visibility:visible;color:#00ff00;animation:layerPulse 2s linear infinite}@keyframes layerPulse{from{opacity:0}to{opacity:1}}@keyframes hostPulse{from{opacity:.4}to{opacity:1}}'}}
 scene.layers.push(legacy,filled,custom)
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:640,height:360}})
 try{
  const requests:string[]=[];await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()})
  await page.setContent(buildSceneDocument(validateMotionScene(scene),await readFile(require.resolve('gsap/dist/gsap.min.js'),'utf8')))
  await page.waitForFunction(()=>(window as unknown as RuntimeWindow).__ONUN_MOTION__?.ready)
  const computed=await page.locator('#typography').evaluate(element=>{const style=getComputedStyle(element);return{fontFamily:style.fontFamily,fontStyle:style.fontStyle,textAlign:style.textAlign,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,textTransform:style.textTransform,textDecoration:style.textDecorationLine,background:style.backgroundColor,borderColor:style.borderColor,borderWidth:style.borderWidth,borderStyle:style.borderStyle,padding:style.padding,textStrokeWidth:style.webkitTextStrokeWidth,textStrokeColor:style.webkitTextStrokeColor}})
  assert.deepEqual(computed,{fontFamily:'Arial, sans-serif',fontStyle:'italic',textAlign:'right',lineHeight:'45px',letterSpacing:'3px',textTransform:'uppercase',textDecoration:'underline',background:'rgb(18, 52, 86)',borderColor:'rgb(255, 135, 247)',borderWidth:'3px',borderStyle:'dashed',padding:'12px',textStrokeWidth:'1px',textStrokeColor:'rgb(0, 0, 0)'})
  const shapes=await page.evaluate(()=>['legacy','filled'].map(id=>{const element=document.getElementById(id)!;const style=getComputedStyle(element);return{background:style.backgroundColor,border:style.borderTopWidth,color:style.color}}))
  assert.equal(shapes[0].background,'rgba(0, 0, 0, 0)');assert.ok(parseFloat(shapes[0].border)>0);assert.equal(shapes[1].background,'rgb(255, 135, 247)');assert.equal(shapes[1].border,'0px')
  assert.equal(await page.locator('#custom .motion-custom-content').evaluate(host=>!!host.shadowRoot),true)
  assert.equal(await page.locator('#scoped-text').getAttribute('onclick'),null);assert.equal(await page.locator('#custom script').count(),0);assert.equal(await page.locator('#custom iframe').count(),0)
  await page.evaluate(()=>{(window as unknown as RuntimeWindow).__layerMessages=[];window.addEventListener('message',event=>{if(event.data?.type==='onun:layer')(window as unknown as RuntimeWindow).__layerMessages!.push(event.data.id)});(window as unknown as RuntimeWindow).__ONUN_MOTION__.seek(.5)})
  const position=await page.locator('#custom').boundingBox();assert.equal(position?.x,70)
  const opacity=await page.locator('#scoped-text').evaluate(element=>getComputedStyle(element).opacity);assert.equal(opacity,'0.25');assert.equal(await page.locator('#custom .motion-custom-content').evaluate(element=>getComputedStyle(element).opacity),'0.55')
  assert.equal(await page.locator('#custom').evaluate(element=>getComputedStyle(element).color),'rgb(255, 255, 255)')
  await page.locator('#scoped-text').dispatchEvent('pointerdown');await page.waitForFunction(()=>(window as unknown as RuntimeWindow).__layerMessages?.includes('custom'))
  assert.equal(await page.evaluate(()=>(window as unknown as RuntimeWindow).__bad),undefined)
  const first=await page.screenshot();await page.evaluate(()=>(window as unknown as RuntimeWindow).__ONUN_MOTION__.seek(1.5));await page.evaluate(()=>(window as unknown as RuntimeWindow).__ONUN_MOTION__.seek(.5));assert.deepEqual(await page.screenshot(),first)
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(await page.locator('#scoped-text').evaluate(element=>getComputedStyle(element).opacity),'0.25');assert.equal(await page.locator('#custom .motion-custom-content').evaluate(element=>getComputedStyle(element).opacity),'0.55');assert.deepEqual(requests,[])
  await page.evaluate(()=>(window as unknown as RuntimeWindow).__ONUN_MOTION__.seek(1.9));assert.equal(await page.locator('#scoped-text').isVisible(),false)
 }finally{await browser.close()}
})

test('local export encodes the same appearance and scoped HTML scene into a real MP4',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'onun-appearance-render-'));const queue=new RenderQueue(directory);const scene=fixture();scene.width=320;scene.height=180;scene.duration=.2;scene.layers=[{...textLayer(),width:280,height:130,end:.2,fontSize:24,...appearance,customContent:{html:'<strong>Motion export</strong>',css:'strong{font:inherit;color:inherit}'}}]
 try{const job=queue.enqueue(scene,{format:'mp4',quality:'high',fps:10});const deadline=Date.now()+30_000;while(['queued','rendering','encoding'].includes(job.status)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(job.status,'completed',job.error??'Local export did not complete');assert.equal(job.totalFrames,2);assert.ok(job.filePath);const bytes=await readFile(job.filePath!);assert.ok(bytes.length>1000);assert.equal(bytes.subarray(4,8).toString(),'ftyp')}
 finally{for(const job of queue.list())if(['queued','rendering','encoding'].includes(job.status))queue.cancel(job.id);await rm(directory,{recursive:true,force:true})}
})

test('the bundled static Inter face allows visible synthetic bold instead of claiming a variable weight range',async()=>{
 const scene=fixture();scene.height=160;scene.layers=[{...textLayer(),x:0,y:0,width:640,height:160,fontSize:80,fontWeight:400,text:'Typography'}]
 const font=`data:font/woff2;base64,${(await readFile('public/assets/inter-medium.woff2')).toString('base64')}`
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:640,height:160}})
 try{
  const gsap=await readFile(require.resolve('gsap/dist/gsap.min.js'),'utf8');await page.setContent(buildSceneDocument(scene,gsap,font));await page.waitForFunction(()=>(window as unknown as RuntimeWindow).__ONUN_MOTION__?.ready)
  const regular=await page.screenshot();await page.locator('#typography').evaluate(element=>element.style.fontWeight='900');await page.evaluate(()=>document.fonts.ready);assert.notDeepEqual(await page.screenshot(),regular)
 }finally{await browser.close()}
})
