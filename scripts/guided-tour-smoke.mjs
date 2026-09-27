import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const output='.figma-app/artifacts/actual';
const id='qa-tour-'+Date.now();
const steps=['workspace','canvas','tools','node','connections','properties','models','motion','timeline','library','mcp','backup'];
const report={baseURL,checkedAt:new Date().toISOString(),checks:[],captures:[],errors:[],mutations:[],accessibility:[],fixture:{id}};
async function request(path,init={}){assert.ok(!init.method||path==='/projects'||path==='/projects/'+id);const response=await fetch(baseURL+'/api'+path,{...init,headers:{'Content-Type':'application/json','X-Onun-Client':'studio'}});assert.ok(response.ok,path+' '+response.status);const value=await response.json();return value.project||value;}
const source=await request('/projects/onun-studio');
const node={id:'generator',kind:'image',title:'Nó do guia',x:120,y:100,width:360,prompt:'Conteúdo autoral preservado pelo guia.',model:'google/gemini-2.5-flash-image',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'review',generationStatus:'idle',artwork:'poster'};
const fixture=await request('/projects',{method:'POST',body:JSON.stringify({...source,id,name:'[QA] Guia interativo',nodes:[node],edges:[],revision:0})});
let browser,context,page,failure;
const url=baseURL+'/?project='+id+'&qa=1';
function pass(name,notes){report.checks.push({name,status:'passed',notes});}
async function capture(name){await page.evaluate(()=>document.fonts.ready);const path=output+'/'+name+'.png';const bytes=await page.screenshot({path,animations:'disabled'});report.captures.push({name,path,viewport:page.viewportSize(),deviceScaleFactor:1,sha256:createHash('sha256').update(bytes).digest('hex'),route:new URL(page.url()).pathname});}
async function start(){await page.getByRole('button',{name:/^(Guided tour|Guia interativo)$/,exact:true}).click();await page.locator('.guided-tour-card').waitFor();}
async function step(id){await page.locator('.guided-tour[data-tour-step="'+id+'"]').waitFor();await page.waitForTimeout(250);const box=await page.locator('.guided-tour-card').boundingBox();const viewport=page.viewportSize();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'Guide card must remain in viewport at '+id);await page.locator('.guided-tour-highlight').waitFor({timeout:10000});}
async function next(){await page.locator('.guided-tour-next').click();}
async function a11y(name){const result=await new AxeBuilder({page}).exclude('.motion-stage iframe').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();report.accessibility.push({name,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});assert.equal(result.violations.length,0,JSON.stringify(report.accessibility.at(-1)));}
await mkdir(output,{recursive:true});
try{
 browser=await chromium.launch({headless:true,...(process.env.ONUN_CHROMIUM_PATH?{executablePath:process.env.ONUN_CHROMIUM_PATH}:{})});
 context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',reducedMotion:'reduce'});
 await context.route('**/api/**',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){report.mutations.push({url:req.url(),method:req.method()});return route.abort();}return route.continue();});
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url,{waitUntil:'networkidle'});await page.locator('[data-node-id="generator"]').waitFor();
 await start();await step('workspace');await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();await capture('guide-basic-en');
 const color=await page.locator('.guided-tour-highlight').evaluate(el=>({color:getComputedStyle(el).borderTopColor,width:getComputedStyle(el).borderTopWidth}));assert.ok(parseFloat(color.width)>=1&&parseFloat(color.width)<=2);const rgb=color.color.match(/\d+/g).map(Number);assert.ok(rgb[0]>rgb[1]&&rgb[2]>rgb[1],'Spotlight border is pink');
 for(let index=1;index<steps.length;index++){await next();await step(steps[index]);}
 await page.locator('.guided-tour-next').click();assert.equal(await page.locator('.guided-tour').count(),0);assert.equal(page.url(),url);await page.locator('.canvas-area').waitFor();pass('basic-guide-12-steps','All 12 English steps show a pink spotlight and bounded card, then restore the original route.');
 await page.locator('.language-selector').click();await page.getByRole('menuitemradio',{name:'Português',exact:true}).click();await start();await page.getByRole('heading',{name:'Seu espaço de trabalho',exact:true}).waitFor();await page.getByRole('switch',{name:'Modo avançado',exact:true}).click();assert.equal(await page.locator('.guided-tour-detail').count(),1);
 for(let index=0;index<steps.length;index++){
  if(index)await next();await step(steps[index]);
  if(steps[index]==='tools'){await page.locator('.add-panel').waitFor();await capture('guide-advanced-tools');}
  if(steps[index]==='node')await page.locator('.dropdown').waitFor();
  if(steps[index]==='connections')assert.equal(await page.locator('.guided-tour-highlight').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'999px');
  if(steps[index]==='properties')await page.locator('.node-inspector').waitFor();
  if(steps[index]==='models'){await page.locator('.model-list').waitFor();await capture('guide-advanced-models');await a11y('guide-models-pt');}
  if(steps[index]==='motion')await page.locator('.motion-editor').waitFor();
  if(steps[index]==='timeline')await page.locator('.motion-timeline').waitFor();
  if(steps[index]==='library')await page.locator('.file-library').waitFor();
  if(steps[index]==='mcp'){await page.locator('.mcp-content').waitFor();await capture('guide-advanced-mcp');}
  if(steps[index]==='backup'){await page.locator('.backup-dialog').waitFor();await capture('guide-advanced-backup');}
 }
 pass('advanced-guide-panels','PT-BR advanced mode opens actual add palette, node inspector, model catalog, Motion timeline, Files, MCP configuration and Backup dialog.');
 await page.locator('.guided-tour-next').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Sair do guia');await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('.guided-tour-next').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('ArrowLeft');await step('mcp');await page.keyboard.press('ArrowRight');await step('backup');await page.keyboard.press('Escape');assert.equal(await page.locator('.guided-tour').count(),0);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(page.url(),url);pass('keyboard-and-restoration','Tab/Shift+Tab stay inside the guide. Arrow keys navigate; Escape closes the tour and its demonstration dialogs, restoring the original route.');
 for(const width of [760,1024]){await page.setViewportSize({width,height:900});await start();await step('workspace');if(width===760)await capture('guide-mobile');await page.keyboard.press('Escape');}
 pass('responsive-guide','Guide remains within 760px and 1024px viewports.');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[]);assert.deepEqual(await request('/projects/'+id),fixture);pass('no-content-mutation','All tour steps, advanced panels, keyboard navigation and responsive checks preserve the entire project/revision. No mutating API requests.');
}catch(error){failure=error;report.failure=error.stack||String(error);if(page)await capture('guide-failure').catch(()=>{});}
finally{
 await context?.close();await browser?.close();
 try{let removed=false;const root=resolve(process.env.ONUN_TEST_PROJECT_DIR||'.onun/projects');for(const path of [resolve(root,id,'project.json'),resolve(root,id+'.json')]){try{const stored=JSON.parse(await readFile(path,'utf8'));assert.equal(stored.id,id);await rm(path.endsWith('/project.json')?resolve(root,id):path,{recursive:path.endsWith('/project.json')});removed=true;}catch(error){if(error.code!=='ENOENT'){failure||=error;report.fixture.cleanupError=String(error);}}}assert.ok(removed);report.fixture.cleanedUp=true;}catch(error){failure||=error;report.fixture.cleanupError=String(error);}
 report.status=failure?'failed':'passed';await writeFile(output+'/guided-tour-smoke.json',JSON.stringify(report,null,2)+'\n');
}
if(failure){console.error(failure);process.exitCode=1;}else console.log(JSON.stringify({status:report.status,checks:report.checks.length,captures:report.captures.length,report:output+'/guided-tour-smoke.json'}));
