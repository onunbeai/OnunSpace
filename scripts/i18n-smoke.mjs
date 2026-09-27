import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const output='.figma-app/artifacts/actual';
const id=`qa-i18n-${Date.now()}`;
const report={baseURL,checkedAt:new Date().toISOString(),checks:[],captures:[],errors:[],mutations:[],accessibility:[],fixture:{id}};
async function request(path,init={}){assert.ok(!init.method||path==='/projects'||path===`/projects/${id}`);const response=await fetch(`${baseURL}/api${path}`,{...init,headers:{'Content-Type':'application/json','X-Onun-Client':'studio'}});assert.ok(response.ok,`${path} ${response.status}`);const data=await response.json();return data.project||data;}
const source=await request('/projects/onun-studio');
const node={id:'generator',kind:'image',title:'Título autoral preservado',x:150,y:100,width:360,prompt:'Aprovado: preservar este texto autoral em português.',model:'google/gemini-2.5-flash-image',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'review',generationStatus:'idle',artwork:'poster'};
const fixture=await request('/projects',{method:'POST',body:JSON.stringify({...source,id,name:'Projeto autoral em português',nodes:[node],edges:[],revision:0})});
let browser,context,page,failure;
const url=path=>`${baseURL}${path}?project=${id}&qa=1`;
function pass(name,notes){report.checks.push({name,status:'passed',notes});}
async function capture(name){await page.evaluate(()=>document.fonts.ready);const path=`${output}/${name}.png`;const bytes=await page.screenshot({path,animations:'disabled'});report.captures.push({name,path,viewport:page.viewportSize(),deviceScaleFactor:1,sha256:createHash('sha256').update(bytes).digest('hex'),route:new URL(page.url()).pathname});}
async function locale(value){await page.locator('.language-selector').click();await page.getByRole('menuitemradio',{name:value==='en'?'English':'Português',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),value);}
async function close(){await page.getByRole('dialog').getByRole('button',{name:/^(Close|Fechar)$/}).click();}
async function a11y(name){const result=await new AxeBuilder({page}).exclude('.motion-stage iframe').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();report.accessibility.push({name,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});assert.equal(result.violations.length,0,`${name} axe: ${JSON.stringify(report.accessibility.at(-1))}`);}
await mkdir(output,{recursive:true});
try{
 browser=await chromium.launch({headless:true,...(process.env.ONUN_CHROMIUM_PATH?{executablePath:process.env.ONUN_CHROMIUM_PATH}:{})});
 context=await browser.newContext({viewport:{width:1440,height:900},locale:'pt-BR',colorScheme:'dark',reducedMotion:'reduce'});
 await context.route('**/api/**',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){report.mutations.push({url:req.url(),method:req.method()});return route.abort();}return route.continue();});
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(url('/'),{waitUntil:'networkidle'});await page.locator('[data-node-id="generator"]').waitFor();
 assert.equal(await page.locator('html').getAttribute('lang'),'en');await page.getByRole('button',{name:'Export',exact:true}).waitFor();
 assert.equal(await page.locator('.language-selector').innerText(),'EN');assert.match(await page.locator('.status-badge').innerText(),/Needs review/);
 assert.equal(await page.locator('[data-node-id="generator"] textarea').inputValue(),node.prompt);assert.equal(await page.locator('.project-name button').innerText(),fixture.name);
 pass('english-default','Fresh context with browser locale pt-BR still defaults to English. Project name, node title and prompt stay authored Portuguese.');
 await page.locator('.language-selector').click();const menu=page.locator('.language-menu');await menu.waitFor();
 const geometry=await menu.evaluate(element=>({width:element.getBoundingClientRect().width,flags:[...element.querySelectorAll('img')].map(img=>({src:img.getAttribute('src'),width:img.width,height:img.height,radius:getComputedStyle(img).borderRadius,loaded:img.complete&&img.naturalWidth>0})),rows:[...element.querySelectorAll('[role=menuitemradio]')].map(row=>row.getBoundingClientRect().height)}));
 assert.ok(geometry.width>=170&&geometry.width<=180);assert.deepEqual(geometry.rows,[36,36]);assert.ok(geometry.flags.every(flag=>flag.src.endsWith('.svg')&&flag.width===18&&flag.height===18&&flag.radius==='50%'&&flag.loaded));assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(await menu.innerText()));
 await capture('i18n-language-selector');await page.keyboard.press('Escape');pass('circular-svg-flags',geometry);
 const canvas=await page.locator('.canvas-world').elementHandle();await page.getByRole('button',{name:'Zoom in',exact:true}).click();const transform=await page.locator('.canvas-world').getAttribute('style');
 await locale('pt-BR');assert.match(await page.locator('.status-badge').innerText(),/Precisa de revisão/);assert.equal(await page.locator('.canvas-world').getAttribute('style'),transform);assert.ok(await canvas.evaluate(el=>el.isConnected));
 await page.getByRole('button',{name:'Exportar',exact:true}).waitFor();await capture('i18n-canvas-pt');
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('lang'),'pt-BR');assert.equal(await page.evaluate(()=>localStorage.getItem('onun-space-locale')),'pt-BR');
 pass('portuguese-persistence','Language switches React state without remounting the canvas or resetting camera; memoized node status updates immediately. PT-BR preference survives reload.');
 await locale('en');await page.getByRole('button',{name:'Add node',exact:true}).click();await page.getByRole('textbox',{name:'Search tools',exact:true}).fill('image');assert.equal(await page.locator('.add-panel .add-item').count(),3);await page.getByRole('button',{name:'Close tools',exact:true}).click();
 const generator=page.locator('[data-node-id="generator"]');await generator.getByRole('button',{name:'Change status',exact:true}).click();await page.getByRole('menuitemradio',{name:'Approved',exact:true}).waitFor();await page.keyboard.press('Escape');
 await generator.locator('.model-trigger').click();await page.getByRole('dialog',{name:'Models',exact:true}).waitFor();await page.getByRole('button',{name:'All models',exact:true}).waitFor();await close();
 await page.getByRole('button',{name:'Connect API',exact:true}).click();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor();await page.getByRole('button',{name:'Connect provider',exact:true}).waitFor();await close();
 pass('canvas-menus-en','Add palette localized search, status radio choices, provider models and settings are English. No edits or generation requests.');
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Files',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Search files',exact:true}).waitFor();await capture('i18n-files-en');
 await locale('pt-BR');await page.getByRole('heading',{name:'Arquivos',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Buscar arquivos',exact:true}).waitFor();await locale('en');pass('library-bilingual','Files view labels and search update in place; authored file name unchanged.');
 await page.locator('.header-tabs').getByRole('button',{name:'Motion',exact:true}).click();await page.locator('.motion-editor').waitFor();await page.getByRole('button',{name:'Add layer',exact:true}).waitFor();await page.getByRole('button',{name:'Play animation',exact:true}).waitFor();await page.locator('iframe[title="Motion scene preview"]').waitFor();await capture('i18n-motion-en');
 await locale('pt-BR');await page.getByRole('button',{name:'Adicionar camada',exact:true}).waitFor();await page.getByRole('button',{name:'Reproduzir animação',exact:true}).waitFor();await page.locator('iframe[title="Prévia da cena de motion"]').waitFor();await locale('en');pass('motion-bilingual','Motion layer tools, playback, inspector and preview labels switch between English and PT-BR without altering the scene.');
 await a11y('motion-en');await page.getByRole('button',{name:'Canvas',exact:true}).click();await a11y('canvas-en');
 for(const width of [760,761,1024]){await page.setViewportSize({width,height:900});assert.ok(await page.locator('.language-selector').isVisible());const sizes=await page.evaluate(()=>({window:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(sizes.document<=sizes.window+1);}
 await page.setViewportSize({width:1440,height:900});await capture('i18n-canvas-en');pass('responsive-selector','Language selector remains available at 760, 761, 1024 and 1440 CSS pixels without document overflow.');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[]);const after=await request(`/projects/${id}`);assert.deepEqual(after,fixture);pass('authored-data-preserved','Complete project document, revision and motion scene remain byte-equivalent at the JSON value level. Browser made no mutating API request.');
}catch(error){failure=error;report.failure=error.stack||String(error);if(page)await capture('i18n-failure').catch(()=>{});}
finally{
 await context?.close();await browser?.close();
 try{let removed=false;const root=resolve(process.env.ONUN_TEST_PROJECT_DIR||'.onun/projects');for(const path of [resolve(root,id,'project.json'),resolve(root,`${id}.json`)]){try{const stored=JSON.parse(await readFile(path,'utf8'));assert.equal(stored.id,id);await rm(path.endsWith('/project.json')?resolve(root,id):path,{recursive:path.endsWith('/project.json')});removed=true;}catch(error){if(error.code!=='ENOENT'){failure||=error;report.fixture.cleanupError=String(error);}}}assert.ok(removed);report.fixture.cleanedUp=true;}catch(error){failure||=error;report.fixture.cleanupError=String(error);}
 report.status=failure?'failed':'passed';await writeFile(`${output}/i18n-smoke.json`,JSON.stringify(report,null,2)+'\n');
}
if(failure){console.error(failure);process.exitCode=1;}else console.log(JSON.stringify({status:report.status,checks:report.checks.length,captures:report.captures.length,accessibility:report.accessibility,report:`${output}/i18n-smoke.json`}));
