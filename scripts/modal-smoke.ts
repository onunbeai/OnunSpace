import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/app.js';
import {defaultScene} from '../shared/motion.js';

const temporary=await mkdtemp(join(tmpdir(),'onun-modal-ui-'));
const runtime=createApp({dataDirectory:join(temporary,'runtime')});
runtime.server.listen(0,'127.0.0.1');await once(runtime.server,'listening');
const base=`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
const projectId='qa-modals-isolated';
const original=await runtime.projects.save({id:projectId,name:'[QA] Modal studio',edges:[],motion:defaultScene,nodes:[
 {id:'generator',kind:'image',title:'Image generator',x:120,y:100,width:310,prompt:'Studio light, clean composition.',model:'openai/gpt-image-1',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'none',artwork:'poster'},
 {id:'reference',kind:'reference',title:'Reference',x:530,y:100,width:290,prompt:'',model:'',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'none',artwork:'brand'}]});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark'});const page=await context.newPage();
const checks:unknown[]=[];const errors:string[]=[];const output=resolve('.figma-app/artifacts/actual');await mkdir(output,{recursive:true});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/models'){const provider=url.searchParams.get('provider');return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'curated',models:provider==='openrouter'?[{id:'google/gemini-3.1-flash-image-preview',name:'Gemini Flash Image',provider,kind:'image'},{id:'openai/gpt-image-1',name:'GPT Image 1',provider,kind:'image'}]:[{id:'flux-pro/kontext/max/text-to-image',name:'FLUX Kontext Max',provider,kind:'image'}]})});}const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});});
async function capture(name:string){
 const dialog=page.getByRole('dialog');await dialog.waitFor();await page.evaluate(()=>document.fonts.ready);
 for(const [size,width,height]of [['desktop',1440,900],['mobile',390,844]]as const){
  await page.setViewportSize({width,height});await page.waitForTimeout(120);
  const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,`${name} ${size} bounds`);
  assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`${name} ${size} horizontal overflow`);
  await page.screenshot({path:join(output,`modal-${name}-${size}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});
 const audit=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 checks.push({name,viewports:['1440x900','390x844'],violations:audit.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>node.target)}))});
 if(audit.violations.length)console.log(JSON.stringify(audit.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}))));
 assert.deepEqual(audit.violations.map(item=>item.id),[],`${name} accessibility`);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
}
async function exportSelects(){
 const dialog=page.getByRole('dialog',{name:'Export',exact:true});
 const format=dialog.getByRole('button',{name:'Export format',exact:true});
 const quality=dialog.getByRole('button',{name:'Export quality',exact:true});
 const choose=async(trigger:typeof format,label:string,captureName?:string)=>{
  await trigger.click();const option=page.getByRole('menuitem',{name:label,exact:true});await option.waitFor();
  const hit=await option.evaluate(element=>{const bounds=element.getBoundingClientRect();return element.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2));});
  assert.equal(hit,true,`${label} must receive pointer events above its dialog`);
  if(captureName)await page.screenshot({path:join(output,captureName+'.png')});
  await option.click();assert.ok((await trigger.innerText()).includes(label));
 };
 for(const[size,width,height]of[['desktop',1440,900],['mobile',390,844]]as const){
  await page.setViewportSize({width,height});
  await choose(format,'WebM · VP9',`modal-export-format-${size}`);
  await choose(quality,'Preview · up to 960px',`modal-export-quality-${size}`);
  await quality.click();await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({state:'hidden'});
  await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,'Export quality',{timeout:2000}).catch(async error=>{console.log('Active element after Escape:',await page.evaluate(()=>document.activeElement?.outerHTML));throw error;});
  assert.equal(await quality.evaluate(element=>element===document.activeElement),true,'Escape restores focus to the quality trigger');
  assert.equal(await dialog.isVisible(),true,'Escape closes only the select menu');
  await choose(format,'MP4 · H.264');await choose(quality,'High · original resolution');
 }
 checks.push({name:'export-select-interactions',viewports:['1440x900','390x844'],checks:['Format WebM/MP4 and quality preview/high options receive pointer hits above the modal.','Click changes selected value.','Escape closes only the menu and restores trigger focus.']});
 await page.setViewportSize({width:1440,height:900});
}
try{
 await page.goto(`http://127.0.0.1:5178/?project=${projectId}&qa=1`);await page.locator('[data-node-id="generator"]').waitFor();
 await page.getByRole('button',{name:'Connect API',exact:true}).click();await capture('settings');
 await page.getByRole('button',{name:'MCP connection',exact:true}).click();await capture('mcp');
 await page.getByRole('button',{name:'Export',exact:true}).click();await exportSelects();await capture('export');
 await page.getByRole('button',{name:'Projects',exact:true}).click();await capture('projects');
 await page.getByRole('button',{name:'Workspace menu',exact:true}).click();await page.getByRole('menuitem',{name:'Project backup',exact:true}).click();await capture('backup');
 const node=page.locator('[data-node-id="generator"]');await node.locator('.node-visual').click();
 await node.getByRole('button',{name:'Add references',exact:true}).click();await capture('references');
 await node.locator('.model-trigger').click();await page.locator('.model-list>button').filter({hasText:'GPT Image 1'}).waitFor();
 const filters=await page.locator('.modal .provider-logo').evaluateAll(images=>images.map(image=>getComputedStyle(image).filter));assert.ok(filters.length>=3&&filters.every(filter=>filter.includes('brightness(0)')&&filter.includes('invert(1)')));
 await capture('models');
 assert.deepEqual(await runtime.projects.get(projectId),original);assert.deepEqual(errors,[]);
 await writeFile(join(output,'modal-smoke.json'),JSON.stringify({timestamp:new Date().toISOString(),checks,errors,isolation:'Ephemeral runtime, no user project read/write. Model catalog responses controlled for layout only; no generation requests.',projectUnchanged:true},null,2));
 console.log(JSON.stringify({checks,projectUnchanged:true}));
}finally{await browser.close();await new Promise<void>(resolve=>runtime.server.close(()=>resolve()));await rm(temporary,{recursive:true,force:true});}
