import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const output='.figma-app/evidence/media-preview';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={checks:[],errors:[],projectRequests:0};
try{
 const page=await browser.newPage({viewport:{width:1280,height:982},deviceScaleFactor:1});
 page.on('pageerror',error=>report.errors.push(error.message));
 // The isolated fixture cannot read or write a real project.
 await page.route('**/api/**',route=>{report.projectRequests++;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Isolated preview fixture"}'});});
 await page.goto(baseURL);
 await page.locator('.app-header').waitFor();
 await page.evaluate(async()=>{
  const resources=performance.getEntriesByType('resource').map(entry=>entry.name);
  const react=await import(resources.find(url=>/\/react\.js\?/.test(url)));
  const dom=await import(resources.find(url=>/\/react-dom_client\.js\?/.test(url)));
  const {MediaPreview}=await import('/src/components/MediaPreview.tsx');
  const React=react.default||react,createRoot=dom.createRoot||dom.default.createRoot;
  document.getElementById('root').style.display='none';
  const fixture=document.createElement('div');document.body.append(fixture);
  const root=createRoot(fixture);
  window.showPreview=(width,height)=>{
   const media=`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#232323"/><circle cx="${width/2}" cy="${height/2}" r="${Math.min(width,height)/3}" fill="#ff87f7"/></svg>`)}`;
   const node={id:`fixture-${width}-${height}`,kind:'image',title:'Preview stability',x:0,y:0,width:300,prompt:'',model:'',provider:'openrouter',aspectRatio:'1:1',resolution:'1K',count:1,status:'none',media};
   root.render(React.createElement(MediaPreview,{key:node.id,node,onClose:()=>root.render(null)}));
  };
  window.showPreview(300,218);
  await document.fonts.ready;
 });
 const percentage=async()=>Number((await page.locator('.media-preview-controls output').innerText()).replace('%',''));
 async function stable(name,duration=1800){
  await page.waitForTimeout(150);
  const readings=await page.evaluate(async duration=>{
   const samples=[];const end=performance.now()+duration;
   while(performance.now()<end){samples.push(document.querySelector('.media-preview-controls output').textContent);await new Promise(resolve=>setTimeout(resolve,75));}
   return samples;
  },duration);
  assert.equal(new Set(readings).size,1,`${name}: zoom oscillated ${readings.join(',')}`);
  report.checks.push({name,samples:readings.length,zoom:readings[0]});
  return percentage();
 }
 await page.locator('.media-preview-frame img').waitFor();
 await page.waitForFunction(()=>document.querySelector('.media-preview-frame img')?.naturalWidth===300);
 const initial=await stable('Fit remains stable for three seconds',3000);
 const fitted=await page.locator('.media-preview-viewport').evaluate(element=>({width:element.clientWidth,height:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight}));
 assert.ok(fitted.scrollWidth<=fitted.width+1&&fitted.scrollHeight<=fitted.height+1,'Fit does not create a scrollbar');
 await page.locator('.media-preview-controls button').nth(1).click();
 const zoomed=await stable('Manual zoom with scrollbars');assert.ok(zoomed>initial);
 await page.locator('.media-preview-viewport').evaluate(element=>{element.scrollLeft=100;element.scrollTop=90;});
 assert.equal(await stable('Scrolling preserves manual zoom',900),zoomed);
 await page.locator('.media-preview-controls button').nth(0).click();
 assert.equal(await stable('Zoom out restores previous scale',900),initial);
 await page.keyboard.press('+');assert.ok(await percentage()>initial);
 await page.keyboard.press('0');assert.equal(await stable('Keyboard fit restores scale',900),initial);
 await page.setViewportSize({width:1511,height:1107});
 const resized=await stable('Fit updates once after viewport resize');assert.ok(resized>initial);
 await page.locator('.media-preview-controls button').nth(1).click();
 await page.locator('.media-preview-controls button').nth(2).click();
 assert.equal(await stable('Fit button restores resized scale',900),resized);
 await page.screenshot({path:`${output}/stable-fit.png`});
 for(const dimensions of [[3840,2160],[401,733]]){
  await page.evaluate(([width,height])=>window.showPreview(width,height),dimensions);
  await page.waitForFunction(width=>document.querySelector('.media-preview-frame img')?.naturalWidth===width,dimensions[0]);
  await stable(`Image ${dimensions.join('×')} remains stable`,1200);
 }
 await page.setViewportSize({width:390,height:844});
 await stable('Portrait fit on mobile',1200);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.media-preview').count(),0);
 assert.deepEqual(report.errors,[]);
 await writeFile(`${output}/stability.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,...report}));
}finally{await browser.close();}
