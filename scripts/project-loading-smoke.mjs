import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/project-loading';
const empty = id => ({id,name:`[QA] ${id}`,revision:7,nodes:[],edges:[],motion:{id:`scene-${id}`,name:'Empty scene',width:1920,height:1080,fps:30,duration:6,background:'#111111',layers:[]}});
const cached = {...empty('cached'),nodes:[{id:'saved-note',kind:'text',title:'Saved local note',x:10,y:10,width:250,prompt:'Keep this saved work',model:'none',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'none'}]};
const report = {checkedAt:new Date().toISOString(),baseURL,isolation:'All API calls intercepted; no real project reads, writes, or generation.',checks:[],errors:[]};
const browser = await chromium.launch({headless:true});
let failure;
await mkdir(output,{recursive:true});

async function fixture({id='slow',path='/',cache,status=200,doc=empty(id),delayHealth=false}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const writes=[],creates=[];
  let releaseHealth,releaseProject;
  const healthGate=new Promise(resolve=>{releaseHealth=resolve;});
  const projectGate=new Promise(resolve=>{releaseProject=resolve;});
  if(!delayHealth)releaseHealth();
  await context.addInitScript(({cache,id})=>{
    if(window.top!==window)return;
    localStorage.setItem('onun-space-locale','en');
    if(cache)localStorage.setItem(`onun-space-project-v1-${id}`,JSON.stringify(cache));
    window.__qaNodes=[];
    new MutationObserver(records=>{for(const record of records)for(const added of record.addedNodes)if(added instanceof Element){const nodes=[...(added.matches('.canvas-node')?[added]:[]),...added.querySelectorAll('.canvas-node')];window.__qaNodes.push(...nodes.map(node=>node.getAttribute('data-node-id')));}}).observe(document,{childList:true,subtree:true});
  },{cache,id});
  let remote=structuredClone(doc);
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/api/health'){await healthGate;return json({ok:true});}
    if(url.pathname==='/api/settings')return json({providers:{openrouter:{configured:false},higgsfield:{configured:false}}});
    if(url.pathname==='/api/models')return json({models:[],source:'fixture'});
    if(url.pathname==='/api/projects'&&method==='POST'){const body=request.postDataJSON();creates.push(body);remote={...body,revision:1};return json(remote);}
    if(url.pathname===`/api/projects/${id}`){
      if(method==='GET'){await projectGate;return json(status===200?remote:{error:'Synthetic load failure'},status);}
      if(method==='PUT'){const body=request.postDataJSON();writes.push(body);remote={...body.project,revision:remote.revision+1};return json(remote);}
    }
    return json({error:'Blocked by isolated loading fixture'},503);
  });
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`${baseURL}${path}?project=${id}`,{waitUntil:'domcontentloaded'});
  return {page,context,writes,creates,releaseHealth,releaseProject};
}
async function assertPending(page) {
  await page.locator('.project-loading').waitFor();
  assert.equal(await page.locator('.app-header,.canvas-area,.motion-editor,.library-page,.canvas-node').count(),0,'Editing UI must remain unmounted until the requested document is accepted');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Delete');
  await page.keyboard.press('?');
  assert.equal(await page.getByRole('dialog').count(),0,'Loading must suppress editor keyboard shortcuts');
  assert.deepEqual(await page.evaluate(()=>window.__qaNodes),[],'No canvas content may appear even transiently');
}
try {
  for(const path of ['/','/motion','/library']){
    const f=await fixture({id:`slow-${path.replaceAll('/','')||'canvas'}`,path,delayHealth:true});
    await assertPending(f.page);
    f.releaseHealth();
    await assertPending(f.page);
    await f.page.waitForTimeout(250);
    assert.deepEqual(f.writes,[]);
    f.releaseProject();
    await f.page.locator('.app-header').waitFor();
    await f.page.locator('.project-loading').waitFor({state:'hidden'});
    assert.equal(await f.page.locator('.canvas-node,.motion-layer-row').count(),0);
    assert.deepEqual(await f.page.evaluate(()=>window.__qaNodes),[]);
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.creates,[]);
    if(path==='/')await f.page.screenshot({path:`${output}/empty-after-load.png`});
    report.checks.push(`${path}: delayed health and project GET keep editor unmounted; accepted empty document has no seed flash or write`);
    await f.context.close();
  }
  {
    const f=await fixture({id:'failed',status:503});
    await assertPending(f.page);f.releaseProject();
    await f.page.locator('.project-recovery').waitFor();
    assert.equal(await f.page.locator('.canvas-area,.motion-editor,.library-page,.canvas-node').count(),0);
    assert.deepEqual(await f.page.evaluate(()=>window.__qaNodes),[]);
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.creates,[]);
    assert.equal(await f.page.evaluate(()=>localStorage.getItem('onun-space-project-v1-failed')),null);
    report.checks.push('Failed uncached GET exposes recovery without showing or persisting a synthetic project');
    await f.context.close();
  }
  {
    const f=await fixture({id:'missing',status:404});
    await assertPending(f.page);f.releaseProject();
    await f.page.locator('.canvas-area').waitFor();
    assert.ok(f.creates.length>=1);
    for(const project of f.creates){assert.deepEqual(project.nodes,[]);assert.deepEqual(project.edges,[]);assert.deepEqual(project.motion.layers,[]);assert.equal(project.motion.customCode,undefined);}
    assert.deepEqual(await f.page.evaluate(()=>window.__qaNodes),[]);
    report.checks.push('A confirmed missing standalone project is created empty, with no canvas nodes or motion layers');
    await f.context.close();
  }
  {
    const f=await fixture({id:'cached',cache:cached,status:503});
    await assertPending(f.page);f.releaseProject();
    await f.page.locator('[data-node-id="saved-note"]').waitFor();
    assert.deepEqual(await f.page.evaluate(()=>window.__qaNodes),['saved-note']);
    await f.page.getByRole('button',{name:'Add note',exact:true}).click();
    await f.page.waitForFunction(()=>document.querySelectorAll('.canvas-node').length===2);
    await f.page.keyboard.press('Escape');
    await f.page.getByRole('button',{name:'Undo',exact:true}).click();
    await f.page.waitForFunction(()=>document.querySelectorAll('.canvas-node').length===1);
    await f.page.getByRole('button',{name:'Redo',exact:true}).click();
    await f.page.waitForFunction(()=>document.querySelectorAll('.canvas-node').length===2);
    await f.page.waitForFunction(()=>JSON.parse(localStorage.getItem('onun-space-project-v1-cached')).nodes.length===2);
    const saved=await f.page.evaluate(()=>JSON.parse(localStorage.getItem('onun-space-project-v1-cached')));
    assert.deepEqual(saved.nodes[0],cached.nodes[0]);assert.deepEqual(f.writes,[]);
    report.checks.push('Valid cached offline draft retains original content, permits edits, undo/redo, and browser autosave');
    await f.context.close();
  }
  {
    const f=await fixture({id:'remote-edits'});f.releaseProject();
    await f.page.locator('.canvas-area').waitFor();
    await f.page.getByRole('button',{name:'Add note',exact:true}).click();
    await f.page.keyboard.press('Escape');
    await f.page.waitForFunction(()=>document.querySelector('.local-badge')?.getAttribute('data-save-state')==='Saved on this device');
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].project.nodes.length,1);assert.equal(f.writes[0].expectedRevision,7);
    await f.page.getByRole('button',{name:'Undo',exact:true}).click();
    await f.page.waitForFunction(()=>document.querySelector('.local-badge')?.getAttribute('data-save-state')==='Saved on this device');
    assert.equal(f.writes.length,2);assert.equal(f.writes[1].project.nodes.length,0);assert.equal(f.writes[1].expectedRevision,8);
    report.checks.push('Accepted remote documents preserve autosave revision checks and undo after saving');
    await f.context.close();
  }
  assert.deepEqual(report.errors,[]);
}catch(error){failure=error;report.failure=error.stack||String(error);}
finally{await browser.close();report.status=failure?'failed':'passed';await writeFile(`${output}/report.json`,`${JSON.stringify(report,null,2)}\n`);}
if(failure){console.error(failure);process.exitCode=1;}else console.log(JSON.stringify(report));
