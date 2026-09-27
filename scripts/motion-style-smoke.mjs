import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/motion-style';
const id = 'qa-motion-style';
let project = { id, name: 'Style workspace', revision: 1, nodes: [], edges: [], motion: { id: 'qa-style-scene', name: 'Typography study', width: 1920, height: 1080, fps: 30, duration: 6, background: '#111111', layers: [] } };
const report = { checks: [], errors: [], writes: 0, isolation: 'All API requests mocked in a private browser context; no real project, provider or credential accessed.' };
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
await page.route('**/api/**', route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/api/health') return json({ status: 'ok' });
  if (path === '/api/settings') return json({ providers: { higgsfield: { configured: false }, openrouter: { configured: false } } });
  if (path === '/api/models') return json({ models: [], source: 'cached' });
  if (path === `/api/projects/${id}` && req.method() === 'GET') return json(project);
  if (path === `/api/projects/${id}` && req.method() === 'PUT') { project = { ...req.postDataJSON().project, revision: project.revision + 1 }; report.writes++; return json(project); }
  report.errors.push(`Unexpected API ${req.method()} ${path}`);
  return route.fulfill({ status: 503, body: '{}' });
});
const check = name => report.checks.push(name);
const saved = async predicate => { for (let n = 0; n < 100 && !predicate(project); n++) await page.waitForTimeout(80); assert.ok(predicate(project), 'Expected scene must persist through mocked project PUT'); };
const inspector = () => page.locator('.motion-inspector');
const styleTab = () => inspector().getByRole('tab', { name: 'Style', exact: true });
const motionTab = () => inspector().getByRole('tab', { name: 'Motion', exact: true });
async function frame() {
  await page.waitForFunction(() => document.querySelector('.motion-stage iframe')?.srcdoc.includes('@font-face'));
  for (let n = 0; n < 40; n++) {
    const handle = await page.locator('.motion-stage iframe').elementHandle();
    const f = handle && await handle.contentFrame();
    if (f && !f.isDetached()) { try { await f.waitForFunction(() => window.__ONUN_MOTION__?.ready, undefined, { timeout: 1500 }); if (!f.isDetached()) return f; } catch (error) { if (!f.isDetached()) throw error; } }
    await page.waitForTimeout(50);
  }
  throw new Error('Motion preview did not settle after font replacement');
}
async function layerStyle(layerId) { return (await frame()).evaluate(layerId => { const el = document.getElementById(layerId), s = getComputedStyle(el); return { text: el.textContent, color: s.color, background: s.backgroundColor, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, align: s.textAlign, line: s.lineHeight, spacing: s.letterSpacing, border: s.borderTopWidth, radius: s.borderTopLeftRadius, padding: s.paddingTop, width: el.getBoundingClientRect().width }; }, layerId); }
async function number(label, value) { const input = inspector().getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab'); }
async function hex(label, value) { const input = inspector().getByRole('textbox', { name: `Hex value for ${label}`, exact: true }); await input.fill(value); await input.press('Tab'); }
try {
  await page.goto(`${baseURL}/motion?project=${id}`);
  await page.locator('.motion-editor').waitFor();
  await styleTab().waitFor();
  assert.equal(await page.locator('.motion-layer-row').count(), 0);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await inspector().getByRole('textbox', { name: 'Layer content', exact: true }).fill('Make it yours.');
  await saved(p => p.motion.layers.length === 1);
  const textId = project.motion.layers[0].id;
  assert.equal(await styleTab().getAttribute('aria-selected'), 'true');
  assert.ok((await layerStyle(textId)).width > 0);
  check('New text is visible, selected, and opens Style automatically.');
  const initialX = project.motion.layers[0].x;
  const xField = inspector().getByRole('spinbutton', { name: 'X position', exact: true });
  await xField.click(); await xField.press('ControlOrMeta+A'); await xField.pressSequentially('-20');
  assert.equal(await xField.inputValue(), '-20'); await xField.press('Enter');
  await saved(p => p.motion.layers[0].x === -20);
  const scaleField = inspector().getByRole('spinbutton', { name: 'Scale', exact: true });
  await scaleField.click(); await scaleField.press('ControlOrMeta+A'); await scaleField.pressSequentially('0.5');
  assert.equal(await scaleField.inputValue(), '0.5'); await scaleField.press('Tab');
  await saved(p => p.motion.layers[0].scale === .5);
  await scaleField.fill('8'); await scaleField.press('Escape'); assert.equal(await scaleField.inputValue(), '0.5');
  await number('X position', initialX); await number('Scale', 1);
  await saved(p => p.motion.layers[0].x === initialX && p.motion.layers[0].scale === 1);
  check('Sequential negative and decimal typing commits the intended number; Escape cancels numeric drafts.');
  await inspector().getByRole('textbox', { name: 'Layer content', exact: true }).fill('Ideas in color.');
  await inspector().getByRole('textbox', { name: 'Font family', exact: true }).fill('Arial');
  await number('Size', 84);
  await hex('Text color', '#46d9ac');
  await number('Line height', 1.4);
  await number('Letter spacing', 2);
  await saved(p => p.motion.layers[0].text === 'Ideas in color.' && p.motion.layers[0].color === '#46d9ac' && p.motion.layers[0].letterSpacing === 2);
  const edited = await layerStyle(textId);
  assert.equal(edited.text, 'Ideas in color.'); assert.equal(edited.color, 'rgb(70, 217, 172)'); assert.equal(edited.size, '84px'); assert.ok(edited.font.includes('Arial')); assert.equal(edited.spacing, '2px');
  check('Text, font family, font size, fill, line height and tracking persist and render.');
  await inspector().getByRole('textbox', { name: 'Font family', exact: true }).fill('Georgia');
  await page.keyboard.press('Escape');
  assert.equal(await inspector().getByRole('textbox', { name: 'Font family', exact: true }).inputValue(), 'Arial');
  assert.ok((await layerStyle(textId)).font.includes('Arial'));
  check('Escape cancels a font draft without committing it.');
  await inspector().locator('.motion-inspector-panel').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: `${output}/style-text-desktop.png` });
  await motionTab().click();
  await inspector().getByRole('button', { name: /Add keyframe/ }).click();
  await page.getByRole('slider', { name: 'Timeline position', exact: true }).fill('1');
  await inspector().getByRole('button', { name: /Add keyframe/ }).click();
  await saved(p => p.motion.layers[0].keyframes.length === 2);
  const frames = structuredClone(project.motion.layers[0].keyframes);
  const keys = page.locator(`.motion-keyframe[data-layer-id="${textId}"]`);
  await keys.nth(0).click(); await keys.nth(1).click({ modifiers: ['Shift'] });
  assert.equal(await motionTab().getAttribute('aria-selected'), 'true');
  await styleTab().click();
  await inspector().getByRole('textbox', { name: 'Layer content', exact: true }).fill('Style with keyframes.');
  await saved(p => p.motion.layers[0].text === 'Style with keyframes.');
  assert.deepEqual(project.motion.layers[0].keyframes, frames);
  check('Style stays editable with multiple selected keyframes and preserves their timing/values.');
  await inspector().locator('.motion-layer-code > summary').click();
  await inspector().getByRole('textbox', { name: 'Layer HTML code', exact: true }).fill('<div class="lettering">Custom <em>style</em></div>');
  await motionTab().click(); await styleTab().click();
  assert.equal(await inspector().getByRole('textbox', { name: 'Layer HTML code', exact: true }).inputValue(), '<div class="lettering">Custom <em>style</em></div>');
  check('Unapplied HTML/CSS drafts survive Style/Motion tab switches.');
  await inspector().locator('.motion-layer-code-tabs').getByRole('tab', { name: 'CSS', exact: true }).click();
  await inspector().getByRole('textbox', { name: 'Layer CSS code', exact: true }).fill('.lettering { font-size: 78px; color: #ff87f7; } em { color: #ffffff; font-style: italic; } body { background: red; }');
  await inspector().getByRole('button', { name: 'Apply to layer', exact: true }).click();
  await saved(p => !!p.motion.layers[0].customContent);
  assert.deepEqual(project.motion.layers[0].keyframes, frames);
  const content = await (await frame()).evaluate(layerId => { const root = document.getElementById(layerId).querySelector('.motion-custom-content').shadowRoot; return { text: root.querySelector('.lettering').textContent, em: getComputedStyle(root.querySelector('em')).color, background: getComputedStyle(document.body).backgroundColor }; }, textId);
  assert.equal(content.text, 'Custom style'); assert.equal(content.em, 'rgb(255, 255, 255)'); assert.equal(content.background, 'rgb(17, 17, 17)');
  await page.screenshot({ path: `${output}/advanced-css-desktop.png` });
  check('Advanced layer HTML/CSS applies inside scoped content while keeping animation and scene background.');
  await page.reload(); await page.locator('.motion-editor').waitFor(); await frame();
  assert.equal(await styleTab().getAttribute('aria-selected'), 'true');
  assert.equal(await (await frame()).locator('.lettering').innerText(), 'Custom style');
  check('Saved typography, scoped HTML/CSS and keyframes survive reopening.');
  await inspector().locator('.motion-layer-code > summary').click();
  await inspector().getByRole('button', { name: 'Reset', exact: true }).click();
  await saved(p => !p.motion.layers[0].customContent);
  assert.equal((await layerStyle(textId)).text, 'Style with keyframes.');
  assert.deepEqual(project.motion.layers[0].keyframes, frames);
  check('Reset restores authored native text without removing keyframes.');
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await saved(p => p.motion.layers.length === 2);
  const shapeId = project.motion.layers[1].id;
  assert.equal((await layerStyle(shapeId)).background, 'rgb(255, 135, 247)');
  await hex('Background color', '#5577dd');
  await number('Radius', 32); await inspector().locator('section').filter({ has: page.getByRole('heading', { name: 'Border', exact: true }) }).getByRole('spinbutton', { name: 'Width', exact: true }).fill('4'); await inspector().locator('section').filter({ has: page.getByRole('heading', { name: 'Border', exact: true }) }).getByRole('spinbutton', { name: 'Width', exact: true }).press('Tab');
  await saved(p => p.motion.layers[1].backgroundColor === '#5577dd' && p.motion.layers[1].radius === 32 && p.motion.layers[1].borderWidth === 4);
  const shape = await layerStyle(shapeId);
  assert.equal(shape.background, 'rgb(85, 119, 221)'); assert.equal(shape.radius, '32px'); assert.equal(shape.border, '4px');
  check('New shapes have a real fill; color, border width and rounded corners persist and render.');
  await inspector().getByRole('button', { name: 'Background color', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Background color', exact: true });
  await picker.getByRole('button', { name: '#66D8BB', exact: true }).click();
  await picker.getByRole('slider', { name: 'Red', exact: true }).fill('85');
  await saved(p => p.motion.layers[1].backgroundColor === '#55d8bb');
  await page.screenshot({ path: `${output}/color-picker.png` });
  await picker.getByRole('textbox', { name: 'Hex value for Background color', exact: true }).fill('FF0000');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  assert.equal((await layerStyle(shapeId)).background, 'rgb(85, 216, 187)');
  check('Custom color palette and RGB slider edit fill; Escape discards uncommitted HEX.');
  const axe = await new AxeBuilder({ page }).include('.motion-inspector').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  report.accessibility = { violations: axe.violations, incomplete: axe.incomplete.map(item => item.id) };
  assert.deepEqual(axe.violations, []);
  check('Inspector automated accessibility checks report no violations.');
  await styleTab().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await motionTab().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowLeft'); assert.equal(await styleTab().getAttribute('aria-selected'), 'true');
  check('Style/Motion tabs support keyboard navigation.');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width < 850 && !(await inspector().isVisible())) await page.getByRole('button', { name: 'Edit properties', exact: true }).click();
    await inspector().waitFor();
    await inspector().locator('.motion-inspector-panel').evaluate(el => el.scrollTop = 0);
    const rect = await inspector().boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/style-${viewport.width}.png` });
    check(`Inspector fits ${viewport.width}px without document overflow.`);
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
