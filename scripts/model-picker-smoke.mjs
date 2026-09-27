import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/model-picker';
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], scenarios: [], isolation: 'Every API request is mocked. Synthetic catalogs and in-memory projects; no provider calls, paid generation or user data access.', catalogDisclaimer: 'Model names and provider routes below are deliberately synthetic grouping fixtures. They do not establish that Higgsfield or OpenRouter offers these IDs.' };
const catalogs = {
  higgsfield: [
    { id: 'flux-pro/kontext/max/text-to-image', name: 'FLUX Kontext Max', kind: 'image' },
    { id: 'openai/gpt-image-1/text-to-image', name: 'GPT Image 1 Text-to-Image', canonicalId: 'GPT Image 1', kind: 'image' },
    { id: 'google/nano-banana-pro/text-to-image', name: 'Nano Banana Pro', kind: 'image' },
    { id: 'edit-only/image-to-image', name: 'Edit only', kind: 'image', supported: false, unavailableReason: 'Este modelo requer entradas adicionais.' },
    { id: 'bytedance/seedance-2.0/text-to-video', name: 'Seedance 2.0', kind: 'video', capabilities: { referenceFields: [] } },
    { id: 'bytedance/seedance-2.5/text-to-video', name: 'QA text video route', canonicalId: 'Seedance 2.5', kind: 'video', capabilities: { aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], counts: [1], defaults: { aspectRatio: '16:9', resolution: '720p', count: 1 } } },
    { id: 'bytedance/seedance-2.5/image-to-video', name: 'QA image video route', canonicalId: 'Seedance 2.5', kind: 'video', capabilities: { requiredInputs: ['image_url'], referenceFields: ['image_url'], aspectRatios: ['16:9'], resolutions: ['720p'], counts: [1] } },
  ],
  openrouter: [
    { id: 'openai/gpt-image-1', name: 'OpenAI: GPT Image 1', kind: 'image' },
    { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro', kind: 'image' },
    { id: 'bytedance-seed/seedance-2.5', name: 'Seedance 2.5', kind: 'video' },
  ],
};
function fixture(id) {
  return { id, name: '[QA] Model routing', revision: 1, edges: [], nodes: [{ id: 'generator', kind: 'image', title: 'QA image', x: 160, y: 100, width: 350, prompt: 'Synthetic routing check.', model: 'openai/gpt-image-1', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', generationStatus: 'idle' }], motion: { id: 'qa-motion', name: 'QA motion', width: 1920, height: 1080, fps: 30, duration: 6, background: '#111111', layers: [] } };
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failure;
const check = (name, detail) => report.checks.push({ name, detail });
async function assertProviderTags(dialog, modelName, activeProvider) {
  const row = dialog.locator('.model-list>button').filter({ hasText: modelName });
  assert.equal(await row.count(), 1, `${modelName} has one visible item`);
  assert.deepEqual(new Set(await row.locator('.model-provider-tag').allTextContents()), new Set(['Higgsfield', 'OpenRouter']));
  assert.equal(await row.locator('.model-provider-tag.is-active').count(), 1);
  assert.equal(await row.locator('.model-provider-tag.is-active').innerText(), activeProvider);
}

async function scenario(name, connected, run, initialNode = {}) {
  const id = `qa-model-${name}`;
  let project = fixture(id);
  project.nodes[0] = { ...project.nodes[0], ...initialNode };
  const requests = [], generations = [], writes = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push({ path, query: url.search, method: request.method() });
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/settings') return json({ providers: Object.fromEntries(['higgsfield', 'openrouter'].map(provider => [provider, { configured: connected.includes(provider), source: connected.includes(provider) ? 'session' : 'none' }])) });
    if (path === '/api/models') {
      const provider = url.searchParams.get('provider'), kind = url.searchParams.get('kind');
      return json({ source: 'live', models: (catalogs[provider] || []).filter(model => model.kind === kind).map(model => ({ ...model, provider })) });
    }
    if (path === `/api/projects/${id}` && request.method() === 'GET') return json(project);
    if (path === `/api/projects/${id}` && request.method() === 'PUT') {
      const body = request.postDataJSON();
      project = { ...structuredClone(body.project), revision: project.revision + 1 };
      writes.push(structuredClone(project));
      return json(project);
    }
    if (path === '/api/generate') { generations.push(request.postDataJSON()); return json({ id: 'qa-blocked', status: 'error', error: 'Generation intercepted by isolated test' }); }
    if (path === '/api/mcp/config') return json({ mcpServers: {} });
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated model picker fixture"}' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  try {
    await page.goto(`${baseURL}/?project=${id}`);
    await page.locator('[data-node-id="generator"]').waitFor();
    await page.waitForFunction(() => document.querySelector('.canvas-world')?.getAttribute('style')?.includes('scale'));
    const open = async () => { await page.locator('[data-node-id="generator"] .model-trigger').click(); const dialog = page.getByRole('dialog', { name: 'Models', exact: true }); await dialog.locator('.model-list[aria-busy="false"]').waitFor(); return dialog; };
    const save = async action => {
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${id}` && response.request().method() === 'PUT' && response.ok());
      await action(); await saved;
      return project.nodes.find(node => node.id === 'generator');
    };
    await run({ page, open, save, requests, generations, project: () => project });
    assert.deepEqual(generations, [], 'No real or synthetic generation should be needed to select model routes');
    report.scenarios.push({ name, connected, catalogRequests: requests.filter(request => request.path === '/api/models'), mockedProjectWrites: writes.length, generationRequests: generations.length });
  } finally { await context.close(); }
}

try {
  await scenario('higgsfield-only', ['higgsfield'], async ({ page, open, save, requests, generations, project }) => {
    await page.locator('[data-node-id="generator"] .generate-button').click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.waitFor();
    assert.equal(await settings.locator('.provider-options .selected strong').innerText(), 'OpenRouter');
    assert.deepEqual(generations, []);
    assert.equal(project().nodes[0].provider, 'openrouter');
    check('Generating with an unconnected saved route opens that provider in Settings without /generate');
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const dialog = await open();
    assert.equal(await dialog.locator('.model-list>button').count(), 6);
    assert.ok((await dialog.locator('.model-list>button:enabled .model-provider-tag.is-active').allTextContents()).every(label => label === 'Higgsfield'));
    assert.equal(await dialog.locator('.provider-filter>button').count(), 3);
    assert.equal(await dialog.locator('.provider-filter>button.active').innerText(), 'All models');
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' }).locator('strong').innerText(), 'GPT Image 1');
    await assertProviderTags(dialog, 'GPT Image 1', 'Higgsfield');
    const fetchedProviders = new Set(requests.filter(request => request.path === '/api/models').map(request => new URLSearchParams(request.query).get('provider')));
    assert.deepEqual(fetchedProviders, new Set(['higgsfield', 'openrouter']));
    await dialog.locator('.provider-filter').getByRole('button', { name: 'All models', exact: true }).click();
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' }).count(), 1);
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'Nano Banana Pro' }).count(), 1);
    await assertProviderTags(dialog, 'GPT Image 1', 'Higgsfield');
    await assertProviderTags(dialog, 'Nano Banana Pro', 'Higgsfield');
    check('Public catalogs for both providers load with All models selected; the connected Higgsfield provider wins equivalent routes');
    await dialog.locator('.provider-filter').getByRole('button', { name: 'OpenRouter', exact: true }).click();
    await assertProviderTags(dialog, 'GPT Image 1', 'OpenRouter');
    await dialog.locator('.provider-filter').getByRole('button', { name: 'All models', exact: true }).click();
    await assertProviderTags(dialog, 'GPT Image 1', 'Higgsfield');
    check('Equivalent model shows both provider tags in every filter; OpenRouter filter switches its active route, All restores connected Higgsfield');
    const selected = await save(() => dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' }).click());
    assert.equal(selected.provider, 'higgsfield');
    assert.equal(selected.model, 'openai/gpt-image-1/text-to-image');
    check('Selecting the deduplicated row persists the connected Higgsfield route and native fixture ID');

    const before = project().nodes.length;
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await save(() => page.locator('.add-panel .add-item').filter({ hasText: 'Generate image' }).click());
    assert.equal(project().nodes.length, before + 1);
    const added = project().nodes.at(-1);
    assert.equal(added.provider, 'higgsfield');
    assert.equal(added.model, 'flux-pro/kontext/max/text-to-image');
    check('A new image block defaults to a configured Higgsfield model', { provider: added.provider, model: added.model });
    const reopened = await open();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/higgsfield-only.png` });
    await reopened.getByRole('button', { name: 'Close', exact: true }).click();
  });

  for (const [name, model] of [['orphan-higgsfield', 'old-flux/native-id-removed'], ['unsupported-higgsfield', 'edit-only/image-to-image']]) {
    await scenario(name, ['higgsfield'], async ({ page, requests, generations, project }) => {
      const previousFetches = requests.filter(request => request.path === '/api/models').length;
      await page.locator('[data-node-id="generator"] .generate-button').click();
      const dialog = page.getByRole('dialog', { name: 'Models', exact: true });
      await dialog.locator('.model-list[aria-busy="false"]').waitFor();
      assert.ok(requests.filter(request => request.path === '/api/models').length > previousFetches);
      assert.deepEqual(generations, []);
      assert.equal(project().nodes[0].provider, 'higgsfield');
      assert.equal(project().nodes[0].model, model);
      assert.ok(await dialog.locator('.model-list>button:enabled').count() > 0);
      check(`${name}: generation checks the current catalog and opens the picker without /generate`, { savedModelPreserved: model });
      if (name === 'orphan-higgsfield') await page.screenshot({ path: `${output}/orphan-higgsfield.png` });
    }, { provider: 'higgsfield', model });
  }

  await scenario('both-providers', ['higgsfield', 'openrouter'], async ({ page, open, save }) => {
    let dialog = await open();
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: /GPT Image 1/ }).count(), 1);
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: /Nano Banana Pro/ }).count(), 1);
    await assertProviderTags(dialog, 'GPT Image 1', 'OpenRouter');
    check('Both configured providers produce one row with both provider tags and the preferred active route');
    await dialog.locator('.provider-filter').getByRole('button', { name: 'Higgsfield', exact: true }).click();
    await assertProviderTags(dialog, 'GPT Image 1', 'Higgsfield');
    let selected = await save(() => dialog.locator('.model-list>button').filter({ hasText: /GPT Image 1/ }).click());
    assert.equal(selected.provider, 'higgsfield');
    assert.equal(selected.model, 'openai/gpt-image-1/text-to-image');
    dialog = await open();
    await dialog.locator('.provider-filter').getByRole('button', { name: 'OpenRouter', exact: true }).click();
    await assertProviderTags(dialog, 'GPT Image 1', 'OpenRouter');
    selected = await save(() => dialog.locator('.model-list>button').filter({ hasText: /GPT Image 1/ }).click());
    assert.equal(selected.provider, 'openrouter');
    assert.equal(selected.model, 'openai/gpt-image-1');
    check('Provider filters keep both tags visible and persist the active provider native ID');

    dialog = await open();
    await dialog.locator('.custom-model summary').click();
    await dialog.getByRole('button', { name: 'Generation provider', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Higgsfield', exact: true }).click();
    const custom = dialog.getByLabel('Another model ID', { exact: true });
    await custom.fill('qa/custom-image-v1');
    selected = await save(() => custom.press('Enter'));
    assert.equal(selected.provider, 'higgsfield');
    assert.equal(selected.model, 'qa/custom-image-v1');
    check('Custom model ID uses the explicitly selected configured provider');
    dialog = await open();
    await page.screenshot({ path: `${output}/both-providers.png` });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await scenario('no-providers', [], async ({ page, open, save, requests, generations, project }) => {
    let dialog = await open();
    assert.equal(await dialog.locator('.provider-filter>button.active').innerText(), 'All models');
    assert.equal(await dialog.locator('.model-list>button').count(), 6);
    assert.equal(await dialog.locator('.model-list>button:enabled').count(), 5);
    assert.equal(await dialog.locator('.custom-model').count(), 1);
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' }).count(), 1);
    await assertProviderTags(dialog, 'GPT Image 1', 'OpenRouter');
    const fetchedProviders = new Set(requests.filter(request => request.path === '/api/models').map(request => new URLSearchParams(request.query).get('provider')));
    assert.deepEqual(fetchedProviders, new Set(['higgsfield', 'openrouter']));
    await page.screenshot({ path: `${output}/no-providers.png` });
    check('Without credentials, both public catalogs appear with All models selected, deduplicated rows and custom model entry');

    for (const provider of ['higgsfield', 'openrouter']) {
      const label = provider === 'higgsfield' ? 'Higgsfield' : 'OpenRouter';
      if (provider === 'openrouter') dialog = await open();
      await dialog.locator('.provider-filter').getByRole('button', { name: label, exact: true }).click();
      await assertProviderTags(dialog, 'GPT Image 1', label);
      const selected = await save(() => dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' }).click());
      assert.equal(selected.provider, provider);
      assert.equal(selected.model, provider === 'higgsfield' ? 'openai/gpt-image-1/text-to-image' : 'openai/gpt-image-1');
      assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).count(), 0);
      assert.deepEqual(generations, []);
      await page.reload();
      await page.locator('[data-node-id="generator"]').waitFor();
      assert.equal(project().nodes[0].provider, provider);
      await page.locator('[data-node-id="generator"] .generate-button').click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.waitFor();
      assert.equal(await settings.locator('.provider-options .selected strong').innerText(), label);
      assert.equal(await page.getByRole('dialog', { name: 'Models', exact: true }).count(), 0);
      assert.deepEqual(generations, []);
      if (provider === 'higgsfield') await page.screenshot({ path: `${output}/connect-on-generation.png` });
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      check(`Without credentials, selecting ${label} saves and survives reload; only Generate opens ${label} Settings, with no /generate request`);
    }
  });
  await scenario('cross-kind-discovery', ['higgsfield'], async ({ page, open, save, project, requests }) => {
    const original = structuredClone(project().nodes[0]);
    const dialog = await open();
    assert.equal(await dialog.locator('.kind-filter>button.active').innerText(), 'All');
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'Current model' }).count(), 1);
    const kindsFetched = new Set(requests.filter(request => request.path === '/api/models').map(request => new URLSearchParams(request.query).get('kind')));
    assert.deepEqual(kindsFetched, new Set(['image', 'video']));
    await dialog.locator('.kind-filter').getByRole('button', { name: 'Images', exact: true }).click();
    assert.equal(await dialog.locator('.model-list>button').filter({ hasText: 'Seedance' }).count(), 0);
    await dialog.locator('.kind-filter').getByRole('button', { name: 'All', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Search models', exact: true }).fill('  SEEDANCE-2.5  ');
    await assertProviderTags(dialog, 'Seedance 2.5', 'Higgsfield');
    await dialog.locator('.kind-filter').getByRole('button', { name: 'Videos', exact: true }).click();
    await assertProviderTags(dialog, 'Seedance 2.5', 'Higgsfield');
    const row = dialog.locator('.model-list>button').filter({ hasText: 'Seedance 2.5' });
    assert.equal(await row.locator('.model-row-action').innerText(), 'Create video block');
    await page.screenshot({ path: `${output}/cross-kind-search.png` });
    await save(() => row.click());
    assert.deepEqual(project().nodes[0], original);
    const created = project().nodes.at(-1);
    assert.equal(created.kind, 'video'); assert.equal(created.provider, 'higgsfield');
    assert.equal(created.model, 'bytedance/seedance-2.5/text-to-video');
    assert.equal(created.prompt, original.prompt); assert.equal(created.aspectRatio, '16:9'); assert.equal(created.resolution, '720p'); assert.equal(created.count, 1);
    assert.ok(created.x >= original.x + original.width); assert.deepEqual(project().edges, []);
    check('All modalities load from an image block; normalized canonical search finds Seedance and creates a separate Higgsfield video block with matching settings, copied prompt and untouched original');
  }, { provider: 'higgsfield', model: 'openai/gpt-image-1/text-to-image' });

  await scenario('cross-kind-running-reference', ['higgsfield'], async ({ open, save, project }) => {
    const original = structuredClone(project().nodes[0]);
    const dialog = await open();
    const image = dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' });
    assert.equal(await image.isDisabled(), true);
    await dialog.locator('.custom-model summary').click();
    assert.equal(await dialog.getByLabel('Another model ID', { exact: true }).isDisabled(), true);
    const video = dialog.locator('.model-list>button').filter({ hasText: 'Seedance 2.5' });
    assert.equal(await video.isEnabled(), true);
    await save(() => video.click());
    assert.deepEqual(project().nodes[0], original);
    const created = project().nodes.at(-1);
    assert.equal(created.model, 'bytedance/seedance-2.5/image-to-video');
    assert.deepEqual(project().edges.map(({ source, target }) => ({ source, target })), [{ source: original.id, target: created.id }]);
    check('Running image block locks same-type models and manual IDs, but allows a new video block; image media creates a reference and picks image-to-video');
  }, { generationStatus: 'running', media: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' });

  await scenario('text-only-video-no-image-reference', ['higgsfield'], async ({ open, save, project }) => {
    const original = structuredClone(project().nodes[0]);
    const dialog = await open();
    await save(() => dialog.locator('.model-list>button').filter({ hasText: 'Seedance 2.0' }).click());
    assert.deepEqual(project().nodes[0], original);
    assert.equal(project().nodes.at(-1).kind, 'video');
    assert.equal(project().nodes.at(-1).model, 'bytedance/seedance-2.0/text-to-video');
    assert.equal(project().nodes.at(-1).prompt, original.prompt);
    assert.deepEqual(project().edges, []);
    check('A text-only video route with explicit empty referenceFields copies the prompt without connecting image media');
  }, { media: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' });

  await scenario('video-to-image-no-video-reference', ['higgsfield'], async ({ open, save, project }) => {
    const original = structuredClone(project().nodes[0]);
    const dialog = await open();
    const image = dialog.locator('.model-list>button').filter({ hasText: 'GPT Image 1' });
    assert.equal(await image.locator('.model-row-action').innerText(), 'Create image block');
    await save(() => image.click());
    assert.deepEqual(project().nodes[0], original);
    assert.equal(project().nodes.at(-1).kind, 'image'); assert.equal(project().nodes.at(-1).prompt, original.prompt);
    assert.deepEqual(project().edges, []);
    check('Choosing an image from a video block creates a separate image block without passing MP4 media as an image reference');
  }, { kind: 'video', provider: 'higgsfield', model: 'bytedance/seedance-2.0/text-to-video', media: '/api/assets/qa-source.mp4' });

  await scenario('absent-higgsfield-model', ['higgsfield'], async ({ page, open }) => {
    const dialog = await open();
    await dialog.locator('.provider-filter').getByRole('button', { name: 'Higgsfield', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Search models', exact: true }).fill('missing fixture model');
    assert.equal(await dialog.locator('.model-list>button').count(), 0);
    assert.ok((await dialog.locator('.catalog-empty').innerText()).includes('Its catalog may differ from the Higgsfield website.'));
    assert.equal(await dialog.getByRole('link', { name: 'View API catalog' }).getAttribute('href'), 'https://open.higgsfield.ai/explore');
    await page.screenshot({ path: `${output}/empty-api-catalog.png` });
    check('An empty Higgsfield search identifies the API catalog boundary and links its official explorer');
  });
  const aliasModel = catalogs.openrouter.find(model => model.id === 'google/gemini-3-pro-image-preview');
  const originalAliasName = aliasModel.name;
  aliasModel.name = 'Google Gemini 3 Pro Image Preview';
  try {
    await scenario('official-search-alias', ['openrouter'], async ({ open, project }) => {
      const original = structuredClone(project());
      const dialog = await open();
      await dialog.locator('.provider-filter').getByRole('button', { name: 'OpenRouter', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Search models', exact: true }).fill('  nano-banana PRO  ');
      const row = dialog.locator('.model-list>button');
      assert.equal(await row.count(), 1);
      assert.equal(await row.locator('strong').innerText(), 'Google Gemini 3 Pro Image Preview');
      assert.equal(await row.locator('.model-provider-tag.is-active').innerText(), 'OpenRouter');
      assert.deepEqual(project(), original);
      check('Nano Banana aliases search only verified returned OpenRouter IDs, without inserting a route or changing the project');
    });
  } finally { aliasModel.name = originalAliasName; }
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally {
  await browser.close();
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
