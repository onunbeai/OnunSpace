import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/motion-preview';
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], apiRequestsBlocked: 0, fixture: 'In-memory React fixture; all API requests blocked' };
const browser = await chromium.launch({ headless: true });
let failure;
await mkdir(output, { recursive: true });
const check = (name, details) => report.checks.push({ name, details });
const readPreview = frame => frame.evaluate(() => {
  const runtime = window.__ONUN_MOTION__;
  const scene = document.getElementById('scene');
  const title = document.getElementById('title-pink');
  const rect = element => { const value = element.getBoundingClientRect(); return { width: value.width, height: value.height }; };
  return { ready: runtime?.ready, time: runtime?.timeline.time(), scene: rect(scene), title: rect(title), opacity: Number(title.style.opacity), transform: title.style.transform };
});
async function currentFrame(page) {
  const handle = await page.locator('.motion-stage iframe').elementHandle();
  assert.ok(handle);
  const frame = await handle.contentFrame();
  assert.ok(frame);
  return { handle, frame };
}
async function waitAt(frame, time) {
  await frame.waitForFunction(expected => {
    const runtime = window.__ONUN_MOTION__;
    const title = document.getElementById('title-pink');
    return runtime?.ready && Math.abs(runtime.timeline.time() - expected) < .0001 && title?.getBoundingClientRect().width > 0 && document.getElementById('scene').getBoundingClientRect().height > 0;
  }, time);
  return readPreview(frame);
}

try {
  for (const delay of [0, 120, 350]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
    await context.route('**/api/**', route => {
      report.apiRequestsBlocked++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated motion preview fixture"}' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    let releaseFont;
    const fontGate = new Promise(resolve => { releaseFont = resolve; });
    let fontRequests = 0;
    try {
      await page.goto(baseURL);
      await page.locator('.app-header').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.route('**/assets/inter-medium.woff2', async route => {
        fontRequests++;
        await fontGate;
        await route.continue();
      });
      await page.evaluate(async () => {
        const resources = performance.getEntriesByType('resource').map(entry => entry.name);
        const react = await import(resources.find(url => /\/react\.js\?/.test(url)));
        const dom = await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)));
        const React = react.default || react;
        const createRoot = dom.createRoot || dom.default.createRoot;
        const [{ MotionEditor }, { defaultScene }, { TooltipProvider }] = await Promise.all([
          import('/src/features/motion/MotionEditor.tsx'), import('/shared/motion.ts'), import('/src/components/Tooltip.tsx'),
        ]);
        document.getElementById('root').style.display = 'none';
        const fixture = document.createElement('div');
        fixture.style.height = '100vh';
        document.body.append(fixture);
        function Fixture() {
          const [scene, setScene] = React.useState(structuredClone(defaultScene));
          return React.createElement(TooltipProvider, null, React.createElement(MotionEditor, { scene, onChange: setScene }));
        }
        createRoot(fixture).render(React.createElement(Fixture));
      });
      await page.locator('.motion-stage iframe').waitFor();
      const initial = await currentFrame(page);
      const initialState = await waitAt(initial.frame, 2.8);
      assert.equal(initialState.opacity, 1);
      assert.ok(fontRequests > 0, 'The font replacement must actually be held back');
      check(`Cold mount before font replacement (${delay}ms)`, initialState);

      if (delay) await page.waitForTimeout(delay);
      releaseFont();
      await page.waitForFunction(element => !element.isConnected, initial.handle);
      const replacement = await currentFrame(page);
      const loaded = await waitAt(replacement.frame, 2.8);
      assert.equal(loaded.opacity, 1);
      assert.ok(await replacement.handle.evaluate(element => element.srcdoc.includes('data:')));
      check(`Font replacement creates a fresh iframe and restores visible playhead (${delay}ms)`, loaded);

      const slider = page.getByRole('slider', { name: 'Timeline position', exact: true });
      await slider.fill('0.8');
      const first = await waitAt(replacement.frame, .8);
      await slider.fill('4');
      await waitAt(replacement.frame, 4);
      await slider.fill('0.8');
      const repeated = await waitAt(replacement.frame, .8);
      assert.deepEqual(repeated, first);
      check(`Forward/backward seeking is deterministic (${delay}ms)`, { first, repeated });

      await page.getByRole('button', { name: 'Play animation', exact: true }).click();
      await replacement.frame.waitForFunction(() => window.__ONUN_MOTION__.timeline.time() > 1.15);
      await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
      const paused = Number.parseFloat(await page.locator('.motion-timecode').innerText());
      await replacement.frame.waitForFunction(expected => Math.abs(window.__ONUN_MOTION__.timeline.time() - expected) <= .011, paused);
      const pausedState = await readPreview(replacement.frame);
      await page.waitForTimeout(100);
      assert.equal((await readPreview(replacement.frame)).time, pausedState.time);
      check(`Playback advances, pause holds, UI and runtime agree (${delay}ms)`, pausedState);

      const beforeZoom = await page.locator('.motion-stage').boundingBox();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      const zoomed = await page.locator('.motion-stage').boundingBox();
      assert.ok(zoomed.width > beforeZoom.width * 1.19);
      assert.equal(await replacement.handle.evaluate(element => element.isConnected), true, 'Camera zoom must retain the live iframe');
      await replacement.frame.waitForFunction(width => document.getElementById('scene').getBoundingClientRect().width > width * 1.19, pausedState.scene.width);
      await page.getByRole('button', { name: 'Fit composition', exact: true }).click();
      const fitted = await page.locator('.motion-stage').boundingBox();
      assert.ok(Math.abs(fitted.width - beforeZoom.width) < 1);
      const afterFit = await readPreview(replacement.frame);
      assert.equal(afterFit.time, pausedState.time);
      check(`Zoom and fit preserve the live preview and playhead (${delay}ms)`, { beforeZoom, zoomed, fitted });
      await page.locator('.motion-layers').getByRole('button', { name: 'Ideas into', exact: true }).click();
      const selectedRect = await replacement.frame.evaluate(() => {
        const rect = document.getElementById('title').getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      await page.waitForFunction(expected => {
        const selection = document.querySelector('.motion-selection');
        return selection && Math.abs(parseFloat(selection.style.left) - expected.x) < 1 && Math.abs(parseFloat(selection.style.top) - expected.y) < 1 && Math.abs(parseFloat(selection.style.width) - expected.width) < 1 && Math.abs(parseFloat(selection.style.height) - expected.height) < 1;
      }, selectedRect);
      assert.ok(selectedRect.width > 0 && selectedRect.height > 0);
      check(`Layer selection matches the live composition after remount and zoom (${delay}ms)`, selectedRect);
      await page.locator('.motion-layers').getByRole('button', { name: 'motion.', exact: true }).click();
      if (delay === 350) {
        await slider.fill('2.8');
        await waitAt(replacement.frame, 2.8);
        await page.locator('.motion-stage-area').focus();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${output}/visible-preview.png` });
      }
    } finally {
      releaseFont();
      await context.close();
    }
  }

  // Hold only the child document's font readiness. This reproduces the ordering
  // where the host already sought to its playhead before fonts finish loading.
  const page = await browser.newPage();
  await page.route('**/api/**', route => {
    report.apiRequestsBlocked++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated motion runtime fixture"}' });
  });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(baseURL);
  const documentSource = await page.evaluate(async () => {
    const [{ buildSceneDocument }, { defaultScene }, source] = await Promise.all([
      import('/src/features/motion/sceneDocument.ts'), import('/shared/motion.ts'), import('/node_modules/gsap/dist/gsap.min.js?raw'),
    ]);
    return buildSceneDocument(defaultScene, source.default);
  });
  const controlled = documentSource.replace('<script>', '<script>Object.defineProperty(document.fonts,"ready",{value:new Promise(resolve=>{window.__releaseFonts=resolve})});</script><script>');
  await page.setContent('<iframe sandbox="allow-scripts" style="width:960px;height:540px;border:0"></iframe>');
  await page.locator('iframe').evaluate((element, html) => { element.srcdoc = html; }, controlled);
  const handle = await page.locator('iframe').elementHandle();
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => window.__ONUN_MOTION__ && window.__releaseFonts);
  await page.locator('iframe').evaluate(element => element.contentWindow.postMessage({ type: 'onun:seek', time: 2.8 }, '*'));
  await frame.waitForFunction(() => window.__ONUN_MOTION__.timeline.time() === 2.8);
  const beforeReady = await readPreview(frame);
  assert.equal(beforeReady.ready, false);
  await frame.evaluate(() => window.__releaseFonts());
  const afterReady = await waitAt(frame, 2.8);
  assert.equal(afterReady.opacity, 1);
  assert.equal(afterReady.transform, beforeReady.transform);
  check('Runtime font completion preserves a seek received before readiness', { beforeReady, afterReady });
  await page.close();
  assert.deepEqual(report.errors, []);
} catch (error) {
  failure = error;
  report.failure = error.stack || String(error);
} finally {
  await browser.close();
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
