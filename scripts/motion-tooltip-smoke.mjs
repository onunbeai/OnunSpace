import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL=process.env.ONUN_TEST_URL||'http://127.0.0.1:5178';
const output='.figma-app/evidence/motion-tooltips';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={checks:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Isolated fixture"}'}));
 await page.goto(baseURL);
 await page.locator('.app-header').waitFor();
 await page.evaluate(async()=>{
  const resources=performance.getEntriesByType('resource').map(entry=>entry.name);
  const react=await import(resources.find(url=>/\/react\.js\?/.test(url)));
  const dom=await import(resources.find(url=>/\/react-dom_client\.js\?/.test(url)));
  const React=react.default||react,createRoot=dom.createRoot||dom.default.createRoot;
  const [{MotionEditor},{MotionAssistant},{defaultScene},{TooltipProvider}]=await Promise.all([import('/src/features/motion/MotionEditor.tsx'),import('/src/features/motion/MotionAssistant.tsx'),import('/shared/motion.ts'),import('/src/components/Tooltip.tsx')]);
  document.getElementById('root').style.display='none';
  const fixture=document.createElement('div');fixture.style.height='100vh';document.body.append(fixture);
  function Fixture(){
   const[scene,setScene]=React.useState(structuredClone(defaultScene)),[assistant,setAssistant]=React.useState(false);
   window.showAssistant=()=>setAssistant(true);
   return React.createElement(TooltipProvider,{delayDuration:100},React.createElement(React.Fragment,null,React.createElement(MotionEditor,{scene,onChange:setScene,onExport:()=>{}}),React.createElement(MotionAssistant,{open:assistant,onClose:()=>setAssistant(false),project:{id:'fixture',nodes:[],edges:[],name:'Fixture',motion:scene},onScene:setScene,onConnect:()=>{}})));
  }
  createRoot(fixture).render(React.createElement(Fixture));
 });
 await page.locator('.motion-stage iframe').waitFor();
 async function checkTooltip(locator,expected,method='hover'){
  await page.mouse.move(1590,990);
  await locator.evaluate(element=>element.blur());
  if(method==='focus')await locator.focus();else await locator.hover();
  const tooltip=page.locator('.ui-tooltip[data-state="delayed-open"],.ui-tooltip[data-state="instant-open"]');
  await tooltip.waitFor({state:'visible'});
  assert.equal((await tooltip.innerText()).trim(),expected);
  assert.equal(await locator.getAttribute('title'),null,'Native title is not duplicated');
  report.checks.push({expected,method});
  await locator.evaluate(element=>element.blur());await page.mouse.move(1590,990);
 }
 await checkTooltip(page.getByRole('button',{name:'Add text',exact:true}),'Add text');
 await checkTooltip(page.getByRole('button',{name:'Add shape',exact:true}),'Add shape','focus');
 await checkTooltip(page.getByRole('button',{name:'Play animation',exact:true}),'Play animation');
 await checkTooltip(page.getByRole('button',{name:'Go to start',exact:true}),'Go to start','focus');
 await checkTooltip(page.getByRole('spinbutton',{name:'Width',exact:true}),'Width');
 await checkTooltip(page.getByRole('spinbutton',{name:'Opacity',exact:true}),'Opacity','focus');
 await checkTooltip(page.locator('.motion-ease'),'Animation easing');
 await page.locator('.motion-ease').click();await page.getByRole('menuitem',{name:'expo.out',exact:true}).click();
 assert.equal((await page.locator('.motion-ease').innerText()).replace(/\s+/g,' ').trim(),'Easing expo.out');
 const keyframe=page.locator('.motion-track-row.is-selected .motion-keyframe').first();
 assert.equal(await keyframe.evaluate(element=>element.parentElement.className),'motion-track');
 const label=await keyframe.getAttribute('aria-label');
 const time=Number(label.match(/keyframe at ([\d.]+)/i)[1]);
 await checkTooltip(keyframe,`Keyframe at ${time.toFixed(2)}s`,'focus');
 await keyframe.focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('.motion-timecode').innerText(),`${(time+1/30).toFixed(2)} / 6.00 s`);
 const moved=page.locator('.motion-track-row.is-selected .motion-keyframe').first();
 const bounds=await moved.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+35,bounds.y+bounds.height/2,{steps:5});await page.mouse.up();
 assert.ok(Number((await page.locator('.motion-timecode').innerText()).split(' ')[0])>time+1/30);
 await page.getByRole('button',{name:'Code',exact:true}).click();
 await checkTooltip(page.getByRole('tab',{name:'CSS',exact:true}),'CSS');
 await page.getByRole('tab',{name:'HTML',exact:true}).focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.getByRole('tab',{name:'CSS',exact:true}).getAttribute('aria-selected'),'true');
 await checkTooltip(page.getByRole('button',{name:'Apply to scene',exact:true}),'Apply to scene','focus');
 await page.keyboard.press('Escape');
 if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
 await page.evaluate(()=>window.showAssistant());
 await checkTooltip(page.getByRole('button',{name:'Use Claude or Codex through MCP',exact:true}),'Use Claude or Codex through MCP');
 await page.getByLabel('Prompt',{exact:true}).fill('Local tooltip fixture');
 await checkTooltip(page.getByRole('button',{name:'Create scene with AI',exact:true}),'Create scene with AI','focus');
 await page.screenshot({path:`${output}/assistant-focus.png`});
 assert.deepEqual(report.errors,[]);
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,...report}));
}finally{await browser.close();}
