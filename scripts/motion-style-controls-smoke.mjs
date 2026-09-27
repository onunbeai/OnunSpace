import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/motion-style-controls';
const report = { checkedAt: new Date().toISOString(), fixture: 'Isolated inspector; all API calls blocked; in-memory scene only', checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 1000 } });
await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated inspector fixture"}' }));
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
await mkdir(output, { recursive: true });
const check = name => report.checks.push(name);
let failure;
try {
  await page.goto(baseURL);
  await page.locator('.app-header').waitFor();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const react = await import(resources.find(url => /\/react\.js\?/.test(url)));
    const dom = await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)));
    const React = react.default || react;
    const [{ MotionInspector }, { defaultScene }, { TooltipProvider }] = await Promise.all([import('/src/features/motion/MotionInspector.tsx'), import('/shared/motion.ts'), import('/src/components/Tooltip.tsx')]);
    await import('/src/features/motion/motion.css');
    await import('/src/features/motion/motion-inspector.css');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    host.id = 'inspector-fixture';
    host.className = 'motion-editor has-mobile-inspector';
    host.style.cssText = 'height:100vh;display:flex;justify-content:flex-end;max-width:420px;margin:0 auto';
    document.body.append(host);
    window.__stylePatches = [];
    function Fixture() {
      const [scene, setScene] = React.useState(structuredClone(defaultScene));
      const [mode, setMode] = React.useState('style');
      const [selectedId, setSelectedId] = React.useState('title');
      const history = React.useRef([]);
      window.__styleScene = scene;
      window.__styleSelectLayer = setSelectedId;
      window.__styleUndo = () => { const previous = history.current.pop(); if (previous) setScene(previous); };
      const layer = scene.layers.find(item => item.id === selectedId);
      return React.createElement(TooltipProvider, null, React.createElement(MotionInspector, {
        scene, layer, mode, onModeChange: setMode, time: 2.8, onChange: setScene, onKeyframe: () => {},
        selection: [{ layerId: 'title', index: 0 }, { layerId: 'title', index: 1 }],
        onLayerChange: patch => { window.__stylePatches.push(structuredClone(patch)); setScene(current => { history.current.push(structuredClone(current)); return { ...current, layers: current.layers.map(item => item.id === layer.id ? { ...item, ...patch } : item) }; }); },
      }));
    }
    (dom.createRoot || dom.default.createRoot)(host).render(React.createElement(Fixture));
  });
  await page.locator('.motion-inspector').waitFor();
  const field = label => page.getByRole('textbox', { name: label, exact: true });
  const layer = () => page.evaluate(() => window.__styleScene.layers.find(item => item.id === 'title'));
  const patches = () => page.evaluate(() => window.__stylePatches.length);
  const initial = await layer();
  const hex = field('Hex value for Text color');
  await hex.fill('112233');
  await hex.press('Escape');
  assert.equal((await layer()).color, initial.color);
  assert.equal(await patches(), 0);
  await hex.fill('112233');
  await hex.press('Enter');
  assert.equal((await layer()).color, '#112233');
  assert.equal(await patches(), 1);
  check('Inline HEX Escape cancels; Enter commits exactly once');

  const font = field('Font family');
  await font.fill('Georgia,serif');
  await font.press('Escape');
  assert.equal((await layer()).fontFamily, undefined);
  assert.equal(await patches(), 1);
  await font.fill('');
  await font.press('Tab');
  assert.equal(await font.inputValue(), 'Inter,Arial,sans-serif');
  assert.equal(await patches(), 1);
  await font.fill('Georgia,serif');
  await font.press('Enter');
  assert.equal((await layer()).fontFamily, 'Georgia,serif');
  assert.equal(await patches(), 2);
  check('Font family supports editable drafts, empty fallback, Escape cancel and one commit');

  await page.getByRole('button', { name: 'Text color', exact: true }).click();
  let popover = page.getByRole('dialog', { name: 'Text color', exact: true });
  await popover.waitFor();
  const popupHex = () => popover.getByRole('textbox', { name: 'Hex value for Text color' });
  await popupHex().fill('AABBCC');
  await popupHex().press('Escape');
  await popover.waitFor({ state: 'hidden' });
  assert.equal((await layer()).color, '#112233');
  assert.equal(await patches(), 2);
  await page.getByRole('button', { name: 'Text color', exact: true }).click();
  popover = page.getByRole('dialog', { name: 'Text color', exact: true });
  await popover.getByRole('button', { name: '#FF87F7', exact: true }).click();
  assert.equal((await layer()).color, '#ff87f7');
  await popover.getByRole('slider', { name: 'Red', exact: true }).fill('100');
  assert.equal((await layer()).color, '#6487f7');
  await popupHex().fill('123456');
  const before = await patches();
  await popupHex().press('Enter');
  assert.equal((await layer()).color, '#123456');
  assert.equal(await patches(), before + 1);
  const axe = await new AxeBuilder({ page }).include('.motion-color-popover').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
  await page.screenshot({ path: output + '/custom-color-picker.png' });
  await page.keyboard.press('Escape');
  check('Custom color palette, RGB sliders and HEX work; popup Escape cancels drafts; zero axe violations');

  await page.locator('.motion-layer-code summary').click();
  const html = field('Layer HTML code');
  const native = await html.inputValue();
  assert.ok(native.includes('Ideas into'));
  await html.fill('<strong class="sample">Draft retained</strong>');
  await page.getByRole('tab', { name: 'Motion', exact: true }).click();
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  assert.equal(await html.inputValue(), '<strong class="sample">Draft retained</strong>');
  assert.equal((await layer()).customContent, undefined);
  await page.evaluate(() => window.__styleSelectLayer('title-pink'));
  await page.locator('.motion-layer-code summary').click();
  await html.fill('<em>Independent second-layer draft</em>');
  await page.evaluate(() => window.__styleSelectLayer('title'));
  await page.locator('.motion-layer-code summary').click();
  assert.equal(await html.inputValue(), '<strong class="sample">Draft retained</strong>');
  await page.evaluate(() => window.__styleSelectLayer('title-pink'));
  await page.locator('.motion-layer-code summary').click();
  assert.equal(await html.inputValue(), '<em>Independent second-layer draft</em>');
  await page.evaluate(() => window.__styleSelectLayer('title'));
  await page.locator('.motion-layer-code summary').click();
  check('Unapplied drafts remain independent and survive A→B→A layer switches');
  await page.getByRole('button', { name: 'Apply to layer', exact: true }).click();
  assert.equal((await layer()).customContent.html, '<strong class="sample">Draft retained</strong>');
  assert.deepEqual((await layer()).keyframes, initial.keyframes);
  check('Style works with multiple selected keyframes; code drafts survive mode changes and Apply preserves keyframes');

  await html.fill('<p>Unapplied draft based on the applied content</p>');
  await page.evaluate(() => window.__styleSelectLayer('title-pink'));
  await page.evaluate(() => window.__styleUndo());
  await page.evaluate(() => window.__styleSelectLayer('title'));
  await page.locator('.motion-layer-code summary').click();
  assert.equal((await layer()).customContent, undefined);
  assert.equal(await html.inputValue(), native);
  assert.equal(await page.getByRole('button', { name: 'Apply to layer', exact: true }).isDisabled(), true);
  check('Undo of applied content invalidates a stale cached draft and displays the actual source');
  await html.fill('<strong class="sample">Draft retained</strong>');
  await page.getByRole('button', { name: 'Apply to layer', exact: true }).click();

  await html.fill('x'.repeat(100001));
  await page.getByRole('button', { name: 'Apply to layer', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal((await layer()).customContent.html, '<strong class="sample">Draft retained</strong>');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal((await layer()).customContent, undefined);
  assert.equal(await html.inputValue(), native);
  assert.deepEqual((await layer()).keyframes, initial.keyframes);
  check('Invalid custom content stays a draft; Reset restores native content without changing animation');
  assert.deepEqual(report.errors, []);
} catch (error) {
  failure = error;
  report.failure = error.stack;
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
if (failure) throw failure;
console.log('Motion style controls passed: ' + report.checks.length + ' checks. ' + output + '/report.json');
