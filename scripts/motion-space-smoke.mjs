import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/motion-space';
const id = `qa-motion-space-${Date.now()}`;
const fixture = {
  id, name: '[QA] Motion Space', revision: 1, nodes: [], edges: [],
  motion: {
    id: 'qa-scene', name: 'QA Space', width: 1600, height: 900, fps: 30, duration: 12, background: '#111111',
    layers: [{ id: 'title-pink', name: 'QA text', type: 'text', text: 'QA motion', fontSize: 100, fontWeight: 500, x: 120, y: 300, width: 900, height: 160, rotation: 0, opacity: 1, scale: 1, color: '#ff87f7', start: 0, end: 12, ease: 'none', keyframes: [{ time: 0, x: 120 }, { time: 4, x: 220 }, { time: 12, x: 120 }] }],
  },
};
let project = structuredClone(fixture);
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], isolation: 'Synthetic native-layer composition and all API requests mocked in a fresh browser context. No real project, credentials, generation or export accessed.' };
let browser, failure;
await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/settings' && request.method() === 'GET') return json({ providers: { higgsfield: { configured: false }, openrouter: { configured: false } } });
    if (path === '/api/models') return json({ source: 'cached', models: [] });
    if (path === `/api/projects/${id}` && request.method() === 'GET') return json(project);
    if (path === `/api/projects/${id}` && request.method() === 'PUT') { project = { ...structuredClone(request.postDataJSON().project), revision: project.revision + 1 }; return json(project); }
    report.errors.push(`Unexpected API request: ${request.method()} ${path}`);
    return route.fulfill({ status: 503, body: '{}' });
  });
  await page.goto(`${baseURL}/motion?project=${id}`);
  const viewport = page.getByRole('region', { name: 'Composition viewport', exact: true });
  const slider = page.getByRole('slider', { name: 'Timeline position', exact: true });
  const play = page.locator('.motion-play-button');
  await viewport.waitFor();
  await page.waitForFunction(() => document.querySelector('.motion-scene-crumb')?.textContent?.includes('QA Space'));
  const time = async () => Number(await slider.inputValue());
  const expectPlaying = async playing => {
    await page.waitForFunction(value => document.querySelector('.motion-play-button')?.getAttribute('aria-label') === (value ? 'Pause animation' : 'Play animation'), playing);
  };
  const advance = async from => { await page.waitForFunction(value => Number(document.querySelector('.motion-ruler input')?.value) > value + .08, from); };
  const seek = async value => { await slider.fill(String(value)); await expectPlaying(false); };
  const tap = async target => { await target.focus(); await page.keyboard.press('Space'); };
  const check = name => report.checks.push(name);

  await page.waitForFunction(() => Number(document.querySelector('.motion-ruler input')?.value) === 2.8);
  await seek(1);
  await tap(viewport); await expectPlaying(true); await advance(1);
  await tap(viewport); await expectPlaying(false);
  const pausedTime = await time(); await page.waitForTimeout(120); assert.equal(await time(), pausedTime);
  check('Space tap on composition plays, advances the timeline, and pauses on the next tap');

  await seek(1); await viewport.focus(); await page.keyboard.down('Space');
  await page.keyboard.down('Space'); await page.waitForTimeout(120); await expectPlaying(false);
  await page.keyboard.up('Space'); await expectPlaying(true); await advance(1);
  await tap(viewport); await expectPlaying(false);
  check('Key repeat while Space is held does not toggle; release toggles exactly once');

  const keyframe = page.locator('.motion-keyframe[data-layer-id="title-pink"][data-keyframe-index="1"]');
  await keyframe.click(); await seek(1);
  const selection = await page.locator('.motion-keyframe.is-keyframe-selected').count();
  await tap(keyframe); await expectPlaying(true); await advance(1);
  assert.ok(await time() < 2, 'Space must not activate the keyframe native click and seek to4s');
  assert.equal(await page.locator('.motion-keyframe.is-keyframe-selected').count(), selection);
  await tap(keyframe); await expectPlaying(false);
  check('Focused keyframe Space toggles playback without changing selection or seeking to the keyframe');

  await seek(1);
  await tap(page.getByRole('button', { name: 'Go to end', exact: true })); await expectPlaying(true); await advance(1);
  assert.ok(await time() < 2, 'Focused transport button must not also fire its native end action');
  await tap(play); await expectPlaying(false);
  check('Space on focused timeline transport buttons toggles once without their native action');

  const pan = async () => {
    await viewport.focus(); const box = await viewport.boundingBox();
    await page.keyboard.down('Space');
    await page.mouse.move(box.x + 50, box.y + 80); await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 125, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Space');
  };
  await seek(1); const beforePan = await page.locator('.motion-stage-stack').boundingBox();
  await pan(); await expectPlaying(false);
  const afterPan = await page.locator('.motion-stage-stack').boundingBox();
  assert.ok(Math.abs(afterPan.x - beforePan.x - 80) < 2 && Math.abs(afterPan.y - beforePan.y - 45) < 2);
  assert.equal(await time(), 1);
  await tap(viewport); await expectPlaying(true); await pan(); await expectPlaying(true);
  await tap(viewport); await expectPlaying(false);
  check('Space with a pointer drag pans without changing paused or playing state');

  await seek(1);
  const input = page.locator('.motion-inspector-title input');
  await input.focus(); await page.keyboard.press('Space'); await expectPlaying(false); await input.fill('QA text');
  const textarea = page.getByRole('textbox', { name: 'Layer content', exact: true });
  await textarea.focus(); await page.keyboard.press('Space'); await expectPlaying(false); await textarea.fill('QA motion');
  await page.evaluate(() => { const el = document.createElement('div'); el.id = 'qa-editable'; el.contentEditable = 'true'; el.textContent = 'Editable'; document.querySelector('.motion-editor').append(el); el.focus(); });
  await page.keyboard.press('End'); await page.keyboard.press('Space'); await expectPlaying(false);
  assert.match(await page.locator('#qa-editable').innerText(), /Editable\s/);
  await page.locator('#qa-editable').evaluate(el => el.remove());
  check('Inputs, textareas and contenteditable keep Space as text input without playback');

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Scene code', exact: true }); await dialog.waitFor();
  await dialog.locator('textarea').focus(); await page.keyboard.press('Space'); await expectPlaying(false);
  await dialog.getByRole('tab', { name: 'CSS', exact: true }).focus(); await page.keyboard.press('Space'); await expectPlaying(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.getByRole('menu').focus(); await page.keyboard.press('Space'); await expectPlaying(false); await page.keyboard.press('Escape');
  check('Dialog and menu keyboard controls do not start motion playback');

  await viewport.focus(); await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('Space'); await expectPlaying(false);
  assert.equal(await viewport.evaluate(el => el.classList.contains('is-navigation')), false);
  check('Window blur cancels a pending Space gesture without toggling playback or leaving hand mode stuck');

  await page.waitForTimeout(750);
  assert.deepEqual(project.motion, fixture.motion, 'Shortcut checks must not alter authored motion');
  await page.screenshot({ path: `${output}/keyboard-playback.png` });

  project = { ...structuredClone(fixture), motion: { ...structuredClone(fixture.motion), id: 'qa-empty-scene', name: 'QA Empty', layers: [] } };
  const emptyScene = structuredClone(project.motion);
  await page.reload(); await viewport.waitFor();
  await page.waitForFunction(() => document.querySelector('.motion-scene-crumb')?.textContent?.includes('QA Empty'));
  await page.waitForFunction(() => Number(document.querySelector('.motion-ruler input')?.value) === 0);
  assert.equal(await page.locator('.motion-layer-row').count(), 0);
  await tap(viewport); await expectPlaying(true); await advance(0);
  await tap(viewport); await expectPlaying(false);
  await page.waitForTimeout(750);
  assert.deepEqual(project.motion, emptyScene, 'Empty-scene shortcuts must not add or alter layers');
  check('An empty composition loads at 0s and Space toggles playback without creating layers; authored compositions retain the 2.8s preview');
  await page.screenshot({ path: `${output}/empty-keyboard-playback.png` });
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally { await browser?.close(); report.status = failure ? 'failed' : 'passed'; await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`); }
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
