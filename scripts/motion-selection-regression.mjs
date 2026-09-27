import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const observe=process.env.ONUN_OBSERVE_SELECTION==='1';
const output='.figma-app/artifacts/actual';
const id='qa-selection-'+Date.now();
const report={baseURL,checkedAt:new Date().toISOString(),mode:observe?'before-fix-observation':'regression',checks:[],errors:[],fixture:{id}};
async function request(path,init={}){assert.ok(!init.method||path==='/projects'||path==='/projects/'+id);const response=await fetch(baseURL+'/api'+path,{...init,headers:{'Content-Type':'application/json','X-Onun-Client':'studio'}});assert.ok(response.ok,path+' '+response.status);const data=await response.json();return data.project||data;}
const source=await request('/projects/onun-studio');
const layer={...source.motion.layers[0],id:'qa-layer',name:'QA Layer',type:'shape',x:0,y:0,width:100,height:100,start:0,end:6,keyframes:[{time:.35,x:10},{time:1.65,x:20},{time:4,x:30}]};
const fixture=await request('/projects',{method:'POST',body:JSON.stringify({...source,id,name:'[QA] Keyframe regression',revision:0,motion:{...source.motion,duration:6,fps:30,customCode:undefined,layers:[layer]}})});
let browser,context,page,failure;
const current=()=>request('/projects/'+id);
const times=async()=>((await current()).motion.layers[0].keyframes.map(frame=>frame.time));
const frame=index=>page.locator('.motion-keyframe[data-layer-id="qa-layer"][data-keyframe-index="'+index+'"]');
const selected=()=>page.locator('.motion-keyframe.is-keyframe-selected');
const pause=()=>page.waitForTimeout(850);
async function reset(){const saved=await current();await request('/projects/'+id,{method:'PUT',body:JSON.stringify({project:{...fixture,revision:saved.revision},expectedRevision:saved.revision})});await page.reload({waitUntil:'networkidle'});await frame(2).waitFor();}
function record(name,bugObserved,details){report.checks.push({name,status:observe?'observed':bugObserved?'failed':'passed',bugObserved,details});if(!observe)assert.equal(bugObserved,false,name);}
await mkdir(output,{recursive:true});
try{
 browser=await chromium.launch({headless:true,...(process.env.ONUN_CHROMIUM_PATH?{executablePath:process.env.ONUN_CHROMIUM_PATH}:{})});context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark',reducedMotion:'reduce'});
 await context.route('**/api/**',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())&&new URL(req.url()).pathname!=='/api/projects/'+id)return route.abort();return route.continue();});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(baseURL+'/motion?project='+id+'&qa=1',{waitUntil:'networkidle'});await frame(2).waitFor();
 await frame(1).click();await page.getByRole('button',{name:'Code',exact:true}).click();await page.getByRole('dialog',{name:'Scene code',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Delete');await pause();
 const modalTimes=await times();record('modal-delete-guard',modalTimes.length!==3,{expected:[.35,1.65,4],actual:modalTimes});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await reset();
 await frame(1).click();const box=await frame(1).boundingBox();const width=await frame(1).evaluate(el=>el.parentElement.clientWidth);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+width/2,box.y+box.height/2,{steps:12});await page.mouse.up();await pause();assert.deepEqual(await times(),[.35,4,4.65]);
 await page.keyboard.press('Meta+z');await pause();assert.deepEqual(await times(),[.35,1.65,4],'Group drag must undo in one action');const selectionAfterUndo=await selected().evaluateAll(elements=>elements.map(el=>({index:Number(el.dataset.keyframeIndex),label:el.getAttribute('aria-label')})));
 // Safe history handling either clears selection or preserves the original frame identity.
 const wrongAfterUndo=selectionAfterUndo.some(item=>item.index!==1);record('undo-selection-identity',wrongAfterUndo,{selectionAfterUndo});
 if(!observe){await page.keyboard.press('Delete');await pause();const remaining=await times();assert.ok(remaining.includes(4),'Delete after undo must preserve unrelated keyframe at4s');}
 await reset();await frame(2).click();const seek=page.getByRole('slider',{name:'Timeline position',exact:true});await seek.fill('0.5');await page.getByRole('button',{name:'Add keyframe',exact:false}).click();await pause();assert.equal((await times()).length,4);const selectionAfterInsert=await selected().evaluateAll(elements=>elements.map(el=>({index:Number(el.dataset.keyframeIndex),label:el.getAttribute('aria-label')})));const insertedTimes=await times();record('insert-selection-identity',selectionAfterInsert.some(item=>![.5,4].includes(insertedTimes[item.index])),{selectionAfterInsert,times:insertedTimes});
 await page.screenshot({path:output+'/motion-selection-'+(observe?'before':'regression')+'.png',animations:'disabled'});assert.deepEqual(report.errors,[]);await reset();
}catch(error){failure=error;report.failure=error.stack||String(error);}
finally{
 await context?.close();await browser?.close();
 try{let removed=false;const root=resolve(process.env.ONUN_TEST_PROJECT_DIR||'.onun/projects');for(const path of [resolve(root,id,'project.json'),resolve(root,id+'.json')]){try{const stored=JSON.parse(await readFile(path,'utf8'));assert.equal(stored.id,id);await rm(path.endsWith('/project.json')?resolve(root,id):path,{recursive:path.endsWith('/project.json')});removed=true;}catch(error){if(error.code!=='ENOENT'){failure||=error;report.fixture.cleanupError=String(error);}}}assert.ok(removed);report.fixture.cleanedUp=true;}catch(error){failure||=error;report.fixture.cleanupError=String(error);}
 report.status=failure?'failed':observe?'observed':'passed';await writeFile(output+'/motion-selection-'+(observe?'before':'regression')+'.json',JSON.stringify(report,null,2)+'\n');
}
if(failure){console.error(failure);process.exitCode=1;}else console.log(JSON.stringify(report));
