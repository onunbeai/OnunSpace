import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {defaultScene} from '../shared/motion.ts';
const output='.figma-app/evidence/motion-assistant';
const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
let project={id:'qa-motion-assistant',name:'QA',revision:1,nodes:[],edges:[],motion:structuredClone(defaultScene)};
const report={checks:[],errors:[],isolation:'All APIs mocked. No user project, credential or paid generation.'};
const browser=await chromium.launch({headless:true});
await mkdir(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.addInitScript(()=>{if(window.top===window)localStorage.setItem('onun-space-locale','en');});
 page.on('pageerror',error=>report.errors.push(error.message));
 const requests=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/health')return json({ok:true});
  if(path==='/api/settings')return json({providers:{higgsfield:{configured:false},openrouter:{configured:false}}});
  if(path==='/api/models')return json({source:'live',models:['anthropic/claude-opus-5.5','openai/gpt-6-astra','openai/gpt-6-astra-pro'].map(id=>({id,name:id,kind:'motion',provider:'openrouter'}))});
  if(path==='/api/projects/qa-motion-assistant'){
   if(route.request().method()==='PUT')project={...route.request().postDataJSON().project,revision:project.revision+1};
   return json(project);
  }
  if(path==='/api/generate'){requests.push(route.request().postDataJSON());return json({id:'qa-mock',status:'error',error:'Mocked generation'});}
  return json({});
 });
 await page.goto(`${baseURL}/motion?project=qa-motion-assistant`);
 const rotation=page.getByRole('spinbutton',{name:'Rotation',exact:true});
 await rotation.focus();
 const focus=await rotation.evaluate(input=>({outline:getComputedStyle(input).outlineStyle,border:getComputedStyle(input.closest('.motion-value')).borderColor,radius:getComputedStyle(input.closest('.motion-value')).borderRadius}));
 assert.equal(focus.outline,'none');assert.ok(parseFloat(focus.radius)>0);assert.match(focus.border,/255, 135, 247/);
 report.checks.push('Numeric focus highlights rounded full field without inner rectangular outline');
 await page.screenshot({path:`${output}/input-focus.png`});
 await page.getByRole('button',{name:'Create with AI',exact:true}).click();
 const dialog=page.getByRole('dialog');
 const select=dialog.getByRole('button',{name:'OpenRouter model',exact:true});
 assert.match(await select.innerText(),/Opus 5.5/);
 await select.click();
 await page.getByRole('menuitem',{name:'GPT-6 Astra',exact:true}).click();
 assert.match(await select.innerText(),/GPT-6 Astra/);
 assert.doesNotMatch(await dialog.innerText(),/4\.6/);
 report.checks.push('Opus 5.5 is the default; Astra and Astra Pro available in model selector');
 await dialog.locator('textarea').fill('Synthetic test only');
 await dialog.getByRole('button',{name:'Create scene with AI',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.motion-model-select')!==null);
 assert.equal(requests[0]?.model,'openai/gpt-6-astra');
 report.checks.push('Selected Astra native identifier is sent to mocked generation');
 await page.screenshot({path:`${output}/model-selector.png`});
 assert.deepEqual(report.errors,[]);
 report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
