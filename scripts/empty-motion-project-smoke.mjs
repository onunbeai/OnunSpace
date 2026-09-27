import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { defaultScene, validateMotionScene } from '../shared/motion.ts';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/empty-motion-project';
const existing = { id: 'qa-existing-motion', name: '[QA] Existing composition', revision: 1, nodes: [], edges: [], motion: structuredClone(defaultScene) };
const projects = new Map([[existing.id, structuredClone(existing)]]);
const created = [], writes = [], requests = [];
const report = { checkedAt: new Date().toISOString(), baseURL, isolation: 'All /api requests intercepted; synthetic projects live only in this script. No real project writes or generation requests.', checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
let failure;
await mkdir(output, { recursive: true });

function checkEmpty(scene) {
  assert.deepEqual(scene.layers, []);
  assert.equal('customCode' in scene, false);
  assert.deepEqual(validateMotionScene(scene), scene);
  assert.deepEqual({ width: scene.width, height: scene.height, fps: scene.fps, duration: scene.duration }, { width: 1920, height: 1080, fps: 30, duration: 6 });
}
async function inspectMotion(page, count) {
  await page.locator('.motion-editor').waitFor();
  await page.waitForFunction(expected => document.querySelectorAll('.motion-layer-row').length === expected, count);
  assert.equal(await page.locator('.motion-track-row').count(), count);
  await page.waitForFunction(() => document.querySelector('.motion-stage iframe')?.srcdoc.includes('data:'));
  const frame = await (await page.locator('.motion-stage iframe').elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.__ONUN_MOTION__?.ready);
  const preview = await frame.evaluate(() => ({ children: document.querySelector('#scene').children.length, width: document.querySelector('#scene').getBoundingClientRect().width, height: document.querySelector('#scene').getBoundingClientRect().height }));
  assert.equal(preview.children, count);
  assert.ok(preview.width > 0 && preview.height > 0);
  return preview;
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    requests.push({ path: url.pathname, method });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/settings') return json({ providers: { higgsfield: { configured: false, source: 'none' }, openrouter: { configured: false, source: 'none' } } });
    if (url.pathname === '/api/models') return json({ source: 'fixture', models: [] });
    if (url.pathname === '/api/projects' && method === 'GET') return json({ projects: [...projects.values()].map(({ id, name }) => ({ id, name })) });
    if (url.pathname === '/api/projects' && method === 'POST') {
      const project = { ...request.postDataJSON(), revision: 1 };
      if (projects.has(project.id)) return json({ error: 'Synthetic project already exists' }, 409);
      created.push(structuredClone(project)); projects.set(project.id, project); return json(project);
    }
    if (url.pathname.startsWith('/api/projects/')) {
      const id = url.pathname.slice('/api/projects/'.length);
      if (method === 'GET') return projects.has(id) ? json(projects.get(id)) : json({ error: 'Synthetic missing project' }, 404);
      if (method === 'PUT') { writes.push(request.postDataJSON()); return json({ error: 'Unexpected fixture mutation' }, 409); }
    }
    return json({ error: 'Blocked by isolated project fixture' }, 503);
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${baseURL}/?project=${existing.id}`);
  await page.locator('.project-name').getByText(existing.name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  const before = await inspectMotion(page, existing.motion.layers.length);
  report.checks.push({ name: 'Existing project loads its original nine layers and visible preview', preview: before });

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('textbox').fill('[QA] New empty motion');
  await dialog.getByRole('button', { name: 'New project', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('project') !== existing.id);
  await page.locator('.project-name').getByText('[QA] New empty motion', { exact: true }).waitFor();
  assert.equal(created.length, 1);
  const newProject = created[0];
  assert.deepEqual(newProject.nodes, []); assert.deepEqual(newProject.edges, []);
  checkEmpty(newProject.motion);
  report.checks.push({ name: 'Creating a project through the UI submits an empty Motion scene without customCode', motion: newProject.motion });
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  const emptyPreview = await inspectMotion(page, 0);
  assert.match(await page.locator('.motion-timecode').innerText(), /^0\.00/);
  assert.equal(await page.getByRole('button', { name: 'Delete layer', exact: true }).isDisabled(), true);
  await page.waitForTimeout(800);
  assert.equal(writes.length, 0);
  await page.screenshot({ path: `${output}/new-empty-motion.png` });
  report.checks.push({ name: 'New Motion editor opens at zero with no layers, tracks or preview content and performs no save', preview: emptyPreview });

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('dialog', { name: 'Projects', exact: true }).getByRole('button', { name: existing.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('project') === existing.id);
  await page.locator('.project-name').getByText(existing.name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await inspectMotion(page, existing.motion.layers.length);
  assert.deepEqual(projects.get(existing.id), existing);
  await page.waitForTimeout(800);
  assert.equal(writes.length, 0);
  await page.screenshot({ path: `${output}/existing-motion-preserved.png` });
  report.checks.push({ name: 'Reopening the existing project through the UI preserves every layer, keyframe and scene property without writes' });

  await page.goto(`${baseURL}/motion?project=qa-fresh-seed`);
  await page.waitForFunction(() => document.querySelector('.local-badge')?.getAttribute('data-save-state') === 'Saved on this device');
  const seed = projects.get('qa-fresh-seed');
  assert.ok(seed); checkEmpty(seed.motion);
  await inspectMotion(page, 0);
  report.checks.push({ name: 'Fresh project created after a mocked 404 also receives an empty valid Motion scene', motion: seed.motion });
  assert.equal(writes.length, 0);
  assert.deepEqual(requests.filter(request => /generate|renders/.test(request.path)), []);
  assert.deepEqual(report.errors, []);
  report.apiRequestCount = requests.length;
  report.createdProjectCount = created.length;
  report.projectUpdateCount = writes.length;
  await context.close();
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally {
  await browser.close();
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
