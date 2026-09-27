import assert from 'node:assert/strict';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createSeedProject,newNode} from '../src/features/canvas/seed.ts';

const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const id=`qa-layout-${Date.now()}`;
const headers={'Content-Type':'application/json','X-Onun-Client':'studio'};
const output='.figma-app/artifacts/actual';
await mkdir(output,{recursive:true});
const fixture={...createSeedProject(),id,name:'[QA] Layout',nodes:[newNode('image',180,120),newNode('text',800,120)],edges:[]};
const created=await fetch(`${baseURL}/api/projects`,{method:'POST',headers,body:JSON.stringify(fixture)});
assert.ok(created.ok);
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addInitScript(()=>{if(window.top===window)localStorage.setItem('onun-space-locale','pt-BR');});
const page=await context.newPage();
const report={checkedAt:new Date().toISOString(),projectId:id,checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
const getProject=async()=>{const r=await fetch(`${baseURL}/api/projects/${id}`);assert.ok(r.ok);return r.json();};
async function settledCount(count){for(let i=0;i<40;i++){const doc=await getProject();if(doc.nodes.length===count)return doc;await page.waitForTimeout(100);}throw new Error(`Expected ${count} nodes`);}
async function checkPlacement(nodeId){
 const node=page.locator(`[data-node-id="${nodeId}"]`);
 await node.waitFor();await page.waitForTimeout(360);
 const boxes=await page.locator('.canvas-node').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{id:n.dataset.nodeId,left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));
 const target=boxes.find(n=>n.id===nodeId);
 for(const other of boxes.filter(n=>n.id!==nodeId))assert.ok(target.right<=other.left||target.left>=other.right||target.bottom<=other.top||target.top>=other.bottom,'New node must not overlap existing nodes');
 const area=await page.locator('.canvas-area').boundingBox();
 const panel=await page.locator('.node-inspector').count()?await page.locator('.node-inspector').boundingBox():null;
 assert.ok(target.left>=area.x+40&&target.right<=(panel?.x??area.x+area.width)-10,'New node is in the unobscured horizontal viewport');
 assert.ok(target.top>=area.y&&target.bottom<=area.y+area.height-50,'New node is vertically visible above bottom toolbar');
}
let failure;
try{
 await page.goto(`${baseURL}/?project=${id}`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelectorAll('.canvas-node').length===2);
 const existingIds=new Set(fixture.nodes.map(node=>node.id));
 await page.getByRole('button',{name:'Adicionar nó',exact:true}).click();
 await page.locator('.add-panel').getByRole('button',{name:/Gerar imagem/}).click();
 let doc=await settledCount(3);const added=doc.nodes.find(n=>!existingIds.has(n.id));
 await checkPlacement(added.id);
 report.checks.push('New image is placed without overlap and viewport moves to it, accounting for inspector.');
 await page.locator(`[data-node-id="${added.id}"] .status-badge`).click();
 const review=page.getByRole('menuitemradio',{name:'Precisa de revisão',exact:true});
 await review.waitFor();
 assert.ok(await review.locator('svg [fill-opacity="0.4"]').count()>0,'Review status uses a filled duotone glyph');
 assert.equal(await review.evaluate(n=>getComputedStyle(n).color),'rgb(210, 210, 210)','Status label stays neutral');
 await page.screenshot({path:`${output}/review-status-menu.png`});
 await review.click();
 await page.waitForTimeout(850);
 assert.equal((await getProject()).nodes.find(n=>n.id===added.id).status,'review');
 await page.locator(`[data-node-id="${added.id}"] .status-badge`).click();
 assert.equal(await page.getByRole('menuitemradio',{name:'Precisa de revisão',exact:true}).getAttribute('aria-checked'),'true');
 await page.keyboard.press('Escape');
 report.checks.push('Review statuses use neutral compact radio rows, authentic duotone glyphs and a separate selection mark; status persists.');

 await page.locator('.node-inspector .inspector-footer button').click();
 const toast=page.locator('.toast');await toast.waitFor();
 const toastStyle=await toast.evaluate(n=>({radius:getComputedStyle(n).borderRadius,height:n.getBoundingClientRect().height,text:n.textContent}));
 assert.equal(toastStyle.radius,'999px');assert.ok(toastStyle.height<=46);assert.ok(toastStyle.text.includes('Adicione um prompt'));
 report.checks.push('Empty prompt toast is compact and fully rounded.');
 await page.getByRole('button',{name:'Fechar aviso'}).click();
 await page.getByRole('button',{name:'Fechar propriedades'}).click();
 await page.locator(`[data-node-id="${added.id}"] button[aria-label="Duplicar nó"]`).click();
 doc=await settledCount(4);const duplicate=doc.nodes.find(n=>!existingIds.has(n.id)&&n.id!==added.id);
 await checkPlacement(duplicate.id);
 report.checks.push('Duplicated node uses a free position and is brought into view.');
 await page.getByRole('button',{name:'Adicionar nota',exact:true}).click();
 doc=await settledCount(5);const note=doc.nodes.at(-1);await checkPlacement(note.id);
 const title=await page.locator(`[data-node-id="${note.id}"] .node-title`).evaluate(n=>({font:getComputedStyle(n).fontSize,padding:getComputedStyle(n).paddingLeft,icon:n.querySelector('svg').getAttribute('width')}));
 assert.deepEqual(title,{font:'11px',padding:'16px',icon:'14'});
 await page.locator(`[data-node-id="${note.id}"] textarea`).focus();
 const focus=await page.locator(`[data-node-id="${note.id}"] textarea`).evaluate(n=>({outline:getComputedStyle(n).outlineStyle,display:getComputedStyle(n).display}));
 assert.equal(focus.outline,'none');assert.equal(focus.display,'block');
 report.checks.push('New note is visible, titles are smaller/inset and note focus does not render a clipped inner outline.');
 await page.getByRole('button',{name:'Fechar propriedades'}).click();
 await page.getByRole('button',{name:'Adicionar nó',exact:true}).click();
 await page.locator('.panel-search input').focus();
 assert.equal(await page.locator('.panel-search input').evaluate(n=>getComputedStyle(n).outlineStyle),'none');
 for(const selector of ['.header-tabs','.header-tabs button','.project-back','.header-actions .button.light','.canvas-bottom']){
  assert.equal(await page.locator(selector).first().evaluate(n=>getComputedStyle(n).borderRadius),'999px');
 }
 report.checks.push('Search focus uses its rounded container; top tabs/actions and bottom controls stay fully rounded.');
 await page.mouse.move(900,800);
 await page.getByRole('button',{name:'Adicionar nó',exact:true}).hover();
 await page.getByRole('tooltip',{name:'Adicionar nó',exact:true}).waitFor();
 assert.ok(await page.locator('.ui-tooltip').isVisible());
 await page.mouse.move(900,800);
 await page.getByRole('button',{name:'Conexão MCP',exact:true}).focus();
 await page.getByRole('tooltip',{name:'Conexão MCP',exact:true}).waitFor();
 assert.ok(await page.locator('.local-badge img[src="/assets/mcp.svg"]').isVisible());
 assert.ok(await page.locator('.avatar svg [fill-opacity="0.4"]').count());
 report.checks.push('Tooltips appear on hover and keyboard focus; MCP uses the official SVG and user icon has genuine duotone fill.');

 await page.screenshot({path:`${output}/canvas-layout-polish.png`});
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);await page.screenshot({path:`${output}/canvas-layout-polish-failure.png`});failure=error;}
finally{
 await browser.close();
 const projectRoot=resolve(process.env.ONUN_TEST_PROJECT_DIR||'.onun/projects');
 for(const file of [resolve(projectRoot,`${id}.json`),resolve(projectRoot,id,'project.json')]){
  try{const stored=JSON.parse(await readFile(file,'utf8'));assert.equal(stored.id,id);if(file.endsWith('/project.json'))await rm(resolve(projectRoot,id),{recursive:true});else await rm(file);}catch(error){if(error.code!=='ENOENT'){failure??=error;report.status='failed';report.error=String(error);}}
 }
 await writeFile(`${output}/canvas-layout-smoke.json`,JSON.stringify(report,null,2));
}
if(failure)throw failure;
console.log(JSON.stringify(report));
