import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,readFile,rm } from 'node:fs/promises';
import {resolve} from 'node:path';
const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const projectId=`qa-motion-ui-${Date.now()}`;
const originalResponse=await fetch(`${baseURL}/api/projects/onun-studio`);
assert.ok(originalResponse.ok);
const original=await originalResponse.json();
const created=await fetch(`${baseURL}/api/projects`,{method:'POST',headers:{'Content-Type':'application/json','X-Onun-Client':'studio'},body:JSON.stringify({...original,id:projectId,name:'[QA] Motion UI',revision:0})});
assert.ok(created.ok);
await mkdir('.figma-app/evidence/motion-ui',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{if(window.top===window)localStorage.setItem('onun-space-locale','pt-BR');});
 await page.route('**/api/projects/**',route=>route.request().method()==='GET'||new URL(route.request().url()).pathname===`/api/projects/${projectId}`?route.continue():route.abort());
 await page.goto(`${baseURL}/motion?project=${projectId}`);
 await page.getByRole('button',{name:'Reproduzir animação',exact:true}).waitFor();
 await page.locator('.motion-stage iframe').waitFor();
 await page.waitForTimeout(500);
 await page.screenshot({path:'.figma-app/evidence/motion-ui/desktop.png'});
 const frames=page.frames();const preview=frames.find(frame=>frame!==page.mainFrame());
 assert.ok(await preview.evaluate(()=>window.__ONUN_MOTION__?.ready));
 await page.getByRole('button',{name:'Reproduzir animação',exact:true}).click();
 await page.getByRole('button',{name:'Pausar animação',exact:true}).waitFor();
 await page.waitForTimeout(180);
 await page.getByRole('button',{name:'Pausar animação',exact:true}).click();
 await page.getByRole('button',{name:'Ir ao início',exact:true}).click();
 assert.match(await page.locator('.motion-timecode').innerText(),/^0.00/);
 const text=page.getByRole('textbox',{name:'Conteúdo da camada',exact:true});
 await text.fill('motion.');
 await page.getByRole('button',{name:'Adicionar texto',exact:true}).click();
 await page.getByRole('textbox',{name:'Conteúdo da camada',exact:true}).fill('Made here.');
 await page.getByRole('button',{name:/Adicionar keyframe/}).click();
 assert.ok(await page.getByRole('button',{name:/Novo texto: keyframe/}).count());
 await page.getByRole('button',{name:/Novo texto: keyframe/}).focus();
 await page.keyboard.press('ArrowRight');
 assert.match(await page.locator('.motion-timecode').innerText(),/^0.03/);
 await page.getByRole('button',{name:'Excluir camada',exact:true}).click();
 await page.getByRole('button',{name:'Código',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'Ir ao fim',exact:true}).click();
 await page.setViewportSize({width:1024,height:768});
 await page.screenshot({path:'.figma-app/evidence/motion-ui/tablet.png'});
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(150);
 await page.screenshot({path:'.figma-app/evidence/motion-ui/mobile.png'});
 const stageBounds=await page.locator('.motion-stage').boundingBox();
 assert.ok(stageBounds.x>=0 && stageBounds.x+stageBounds.width<=390);
 await page.getByRole('button',{name:'Editar propriedades',exact:true}).click();
 await page.getByRole('button',{name:'Fechar propriedades',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log(JSON.stringify({passed:true,errors,viewports:['1600x1000','1024x768','390x844']}));
}finally{
 await browser.close();
 const root=resolve(process.env.ONUN_TEST_PROJECT_DIR||'.onun/projects');
 for(const file of [resolve(root,`${projectId}.json`),resolve(root,projectId,'project.json')]){
  const stored=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stored){assert.equal(stored.id,projectId);await rm(file.endsWith('/project.json')?resolve(root,projectId):file,{recursive:file.endsWith('/project.json')});}
 }
}
