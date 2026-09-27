import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { describeHiggsfield } from '../server/higgsfield.ts';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/model-options';
const snapshot = JSON.parse(await readFile('server/higgsfield-catalog.json', 'utf8'));
const soul = describeHiggsfield(snapshot.models.find(model => model.id === 'higgsfield-ai/soul/standard'));
const report = { checkedAt: new Date().toISOString(), checks: [], errors: [], isolation: 'All APIs intercepted; official SOUL schema read locally, projects and generation responses held in memory only.', soul: { id: soul.id, capabilities: soul.capabilities } };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failure;

async function fixture(name, model, run, initialNode = {}) {
  const id = `qa-options-${name}`;
  let project = { id, name: '[QA] Model options', revision: 1, edges: [], nodes: [{ id: 'generator', title: 'QA generator', kind: model.kind, model: model.id, provider: model.provider, x: 160, y: 100, width: 350, prompt: 'Synthetic options check.', aspectRatio: '21:9', resolution: '4K', count: 3, status: 'none', generationStatus: 'idle' }], motion: { id: 'qa-motion', name: 'QA motion', width: 1920, height: 1080, duration: 6, fps: 30, background: '#111111', layers: [] } };
  project.nodes[0] = { ...project.nodes[0], ...initialNode };
  const original = structuredClone(project), writes = [], generations = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/settings') return json({ providers: { higgsfield: { configured: true, source: 'session' }, openrouter: { configured: false, source: 'none' } } });
    if (url.pathname === '/api/models') return json({ source: 'live', models: url.searchParams.get('provider') === model.provider && url.searchParams.get('kind') === model.kind ? [model] : [] });
    if (url.pathname === `/api/projects/${id}` && request.method() === 'GET') return json(project);
    if (url.pathname === `/api/projects/${id}` && request.method() === 'PUT') { project = { ...request.postDataJSON().project, revision: project.revision + 1 }; writes.push(structuredClone(project)); return json(project); }
    if (url.pathname === '/api/generate') { generations.push(request.postDataJSON()); return json({ id: 'qa-intercepted', status: 'error', error: 'Synthetic generation response' }); }
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated options fixture"}' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  try {
    await page.goto(`${baseURL}/?project=${id}`);
    const node = page.locator('[data-node-id="generator"]');
    if (initialNode.generatedFrom) await node.locator('.node-media').waitFor();
    else await node.locator('.model-trigger').getByText(model.canonicalId || model.name, { exact: true }).waitFor();
    await node.getByRole('button', { name: 'Edit node', exact: true }).click();
    const inspector = page.locator('.node-inspector');
    await inspector.waitFor();
    if (!initialNode.generatedFrom) await inspector.locator('.inspector-model').getByText(model.canonicalId || model.name, { exact: true }).waitFor();
    await run({ page, node, inspector, original, writes, generations, project: () => project, patchRemote: patch => { project = { ...project, revision: project.revision + 1, nodes: project.nodes.map(node => ({ ...node, ...patch })) }; }, waitSave: () => page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${id}` && response.request().method() === 'PUT' && response.ok()) });
  } finally { await context.close(); }
}

try {
  await fixture('soul', soul, async ({ page, node, inspector, writes, generations, original, project, waitSave }) => {
    assert.equal(await node.locator('.resolution-label').textContent(), '720p·1 image');
    assert.equal(await node.locator('.aspect-ratio-select').innerText(), '4:3');
    assert.equal(await inspector.getByRole('button', { name: 'Generation resolution', exact: true }).innerText(), '720p');
    await inspector.getByRole('button', { name: 'Generation resolution', exact: true }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), soul.capabilities.resolutions);
    assert.equal(await page.getByRole('menuitem', { name: '4K', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await node.locator('.aspect-ratio-select').click();
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), soul.capabilities.aspectRatios);
    await page.keyboard.press('Escape');
    await inspector.getByRole('button', { name: /^Generation aspect ratio:/ }).click();
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), soul.capabilities.aspectRatios);
    await page.keyboard.press('Escape');
    assert.doesNotMatch(await inspector.innerText(), /4K/);
    await inspector.getByRole('button', { name: 'Generation quantity', exact: true }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), soul.capabilities.counts.map(String));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    assert.equal(writes.length, 0);
    assert.deepEqual(project(), original);
    report.checks.push({ name: 'Official SOUL capabilities show only real aspect ratios and 720p/1080p, no 4K, without modifying the saved node' });
    const saved = waitSave();
    await node.locator('.generate-button').click();
    await saved;
    assert.deepEqual(generations, []);
    assert.equal(project().nodes[0].resolution, '720p');
    assert.equal(project().nodes[0].aspectRatio, '4:3');
    assert.equal(project().nodes[0].count, 1);
    await page.getByText('Options adjusted to this model’s capabilities. Review them before generating.', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/soul-capabilities.png` });
    report.checks.push({ name: 'First Generate normalizes legacy options, opens Inspector and requests review without any /generate request' });
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/generate' && response.ok());
    await inspector.getByRole('button', { name: 'Start generation', exact: true }).click();
    await submitted;
    assert.equal(generations.length, 1);
    assert.equal(generations[0].model, soul.id);
    assert.equal(generations[0].resolution, '720p');
    assert.equal(generations[0].aspectRatio, '4:3');
    assert.equal(generations[0].count, 1);
    report.checks.push({ name: 'Second Generate sends the reviewed options to an intercepted synthetic endpoint', realGeneration: false });
  });
  await fixture('hidden-fields', { id: 'qa/no-size-controls', name: 'QA raw route', canonicalId: 'QA fixed image', kind: 'image', provider: 'higgsfield', supported: true, capabilities: { aspectRatios: [], resolutions: [], counts: [1], defaults: { count: 1 } } }, async ({ node, inspector, writes, generations }) => {
    assert.equal(await node.locator('.aspect-ratio-select').count(), 0);
    assert.equal(await inspector.locator('.aspect-ratio-select').count(), 0);
    assert.equal(await inspector.getByRole('button', { name: 'Generation resolution', exact: true }).count(), 0);
    assert.equal(await node.locator('.quality-select').count(), 0);
    assert.equal(await node.locator('.resolution-label').textContent(), '1 image');
    assert.doesNotMatch(await inspector.innerText(), /4K|Generation resolution/);
    assert.equal(writes.length, 0); assert.equal(generations.length, 0);
    report.checks.push({ name: 'Models that offer no aspect ratio or resolution hide both controls and the resolution caption' });
  });
  await fixture('video-count', { id: 'qa/video-route', name: 'QA raw video route', canonicalId: 'QA Video', kind: 'video', provider: 'higgsfield', supported: true, capabilities: { aspectRatios: ['16:9'], resolutions: ['720p'], counts: [1, 2], defaults: { aspectRatio: '16:9', resolution: '720p', count: 1 } } }, async ({ page, node, inspector, writes, generations, project, waitSave }) => {
    assert.equal(await node.locator('.resolution-label').textContent(), '720p·1 video');
    await inspector.getByRole('button', { name: 'Generation quantity', exact: true }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['1', '2']);
    const saved = waitSave();
    await page.getByRole('menuitem', { name: '2', exact: true }).click();
    await saved;
    assert.equal(project().nodes[0].count, 2);
    assert.equal(await node.locator('.resolution-label').textContent(), '720p·2 videos');
    assert.equal(writes.length, 1); assert.equal(generations.length, 0);
    report.checks.push({ name: 'Video captions use video/videos, and quantity selector exposes and saves only supported counts' });
  });
  await fixture('grok-quality', { id: 'x-ai/grok-imagine-image', name: 'Grok Imagine Image — Text to image', canonicalId: 'Grok Imagine Image', kind: 'image', provider: 'higgsfield', supported: true, capabilities: { aspectRatios: ['1:1', '16:9'], resolutions: ['1k', '2k'], counts: [1], defaults: { aspectRatio: '1:1', resolution: '1k', count: 1 } } }, async ({ page, node, inspector, project, patchRemote, generations, waitSave }) => {
    const quality = node.getByRole('button', { name: 'Generation quality', exact: true });
    assert.equal(await quality.innerText(), '1k');
    const style = await quality.evaluate(element => ({ height: parseFloat(getComputedStyle(element).height), radius: getComputedStyle(element).borderRadius }));
    assert.ok(style.height <= 28);
    assert.equal(style.radius, '999px');
    await quality.click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['1k', '2k']);
    const saved = waitSave();
    await page.getByRole('menuitem', { name: '2k', exact: true }).click();
    await saved;
    assert.equal(project().nodes[0].resolution, '2k');
    assert.equal(await quality.innerText(), '2k');
    assert.equal(await inspector.getByRole('button', { name: 'Generation resolution', exact: true }).innerText(), '2k');
    await page.screenshot({ path: `${output}/grok-inline-quality.png` });
    report.checks.push({ name: 'Compact inline Grok quality selector offers 1k/2k, saves 2k and synchronizes Inspector', style });
    patchRemote({ generationStatus: 'running' });
    await page.reload();
    await node.locator('.model-trigger').getByText('Grok Imagine Image', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.quality-select button')?.matches(':disabled'));
    assert.equal(await quality.isDisabled(), true);
    await quality.evaluate(element => element.click());
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(project().nodes[0].resolution, '2k');
    assert.equal(generations.length, 0);
    report.checks.push({ name: 'Inline quality selector is disabled during generation and cannot open or alter resolution' });
  });
  const outputImage = `data:image/png;base64,${(await readFile('public/assets/providers/qwen.png')).toString('base64')}`;
  const outputVideo = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEl7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEBZAAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYg7fIf9XtsbvZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAX14QDgkLCBELqBEJqBAlWwhFW5gQESVMNn3HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAyc3O2Y8CLY8WIO3yH/V7bG71nyKVFo4dFTkNPREVSRIeYTGF2YzYyLjI4LjEwMiBsaWJ2cHgtdnA5H0O2daXngQCjoIEAAICCSYNCAADwAPYAOCQcGEoAADBgAAAQv//9SIwA';
  for (const [kind, media] of [['image', outputImage], ['video', outputVideo]]) {
    await fixture(`generated-${kind}`, { ...soul, kind }, async ({ page, node, inspector, writes, generations }) => {
      assert.equal(await node.locator('.node-compose').count(), 0);
      assert.equal(await node.locator('textarea,.model-trigger,.quality-select').count(), 0);
      assert.equal(await node.locator('.status-badge').count(), 1);
      assert.equal(await node.locator('.port-in,.port-out').count(), 2);
      assert.equal(await inspector.locator('textarea,.inspector-model,.inspector-footer,.aspect-ratio-select').count(), 0);
      await node.getByRole('button', { name: 'Node options', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Create variation', exact: true }).waitFor();
      assert.equal(await page.getByRole('menuitem', { name: 'Run', exact: true }).count(), 0);
      await page.keyboard.press('Escape');
      await node.getByRole('button', { name: 'Open preview', exact: true }).click();
      const preview = page.locator('.media-preview');
      await preview.waitFor();
      if (kind === 'image') await preview.locator('img').evaluate(element => element.decode());
      else await page.waitForFunction(() => { const video = document.querySelector('.media-preview video'); return video && video.videoWidth > 0 && video.readyState >= 1; });
      assert.equal(await node.getByRole('button', { name: 'Generate', exact: true }).count(), 0);
      assert.equal(writes.length, 0); assert.equal(generations.length, 0);
      report.checks.push({ name: `Generated ${kind} is media-only with status/ports; primary action opens working preview, variation remains, no generation controls or request` });
    }, { generatedFrom: 'qa-origin-generator', media, generationStatus: 'complete' });
  }
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally {
  await browser.close();
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
