import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/artifacts/actual';
const modelPickerOnly = process.env.ONUN_TEST_SCOPE === 'model-picker';
const reportName = modelPickerOnly ? 'model-picker-smoke' : 'browser-smoke';
const headers = { 'Content-Type': 'application/json', 'X-Onun-Client': 'studio' };
const report = { baseURL, checkedAt: new Date().toISOString(), checks: [], captures: [], accessibility: [], errors: [], requestFailures: [] };
await mkdir(output, { recursive: true });

async function request(path, init = {}) {
  if (path.startsWith('/projects/onun-studio') && init.method && init.method !== 'GET') throw new Error('QA must never mutate the active user project.');
  const response = await fetch(`${baseURL}/api${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const value = await response.json();
  assert.ok(response.ok, `${init.method || 'GET'} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value.project || value;
}

const original = await request('/projects/onun-studio');
const projectId = `qa-canvas-${Date.now()}`;
await request('/projects', { method: 'POST', body: JSON.stringify({ ...original, id: projectId, name: '[QA] Verificação do editor', revision: 0 }) });
report.fixture = { projectId, sourceProjectReadOnly: 'onun-studio' };
const fixtureURL = route => `${baseURL}${route}?project=${projectId}&qa=1`;
let browser;
let context;
let page;
let failure;

async function settle() {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(180);
}

async function capture(name) {
  await settle();
  const path = `${output}/${name}.png`;
  const bytes = await page.screenshot({ path, animations: 'disabled' });
  const viewport = page.viewportSize();
  report.captures.push({ name, path, viewport, deviceScaleFactor: 1, sha256: createHash('sha256').update(bytes).digest('hex'), route: new URL(page.url()).pathname });
}

function passed(name, notes) { report.checks.push({ name, status: 'passed', notes }); }

function monitorPage(target) {
  target.on('pageerror', error => report.errors.push(error.message));
  target.on('requestfailed', failed => { if (failed.failure()?.errorText !== 'net::ERR_ABORTED') report.requestFailures.push({ url: failed.url(), error: failed.failure()?.errorText }); });
}

async function accessibility(name) {
  let audit = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (name === 'motion') audit = audit.exclude('.motion-stage iframe');
  const result = await audit.analyze();
  report.accessibility.push({ name, url: page.url(), scope: name === 'motion' ? 'Editor controls; excludes editable user-authored composition iframe, which is visually captured without exclusions.' : 'Page UI', violations: result.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description, help: item.help, nodes: item.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary, html: node.html })) })), incomplete: result.incomplete.map(item => ({ id: item.id, nodeCount: item.nodes.length })) });
  console.log(`${name}: ${result.violations.length} accessibility violations`);
}

async function closeDialog() { await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click(); }

async function captureSourceDimensions(sourceIds) {
  const { screenshots } = JSON.parse(await readFile('.figma-app/implementation.json', 'utf8'));
  const primaryPage = page;
  for (const source of screenshots.filter(source => !sourceIds || sourceIds.includes(source.id))) {
    page = await context.newPage();
    monitorPage(page);
    try {
      await page.setViewportSize(source.pixelSize);
      const route = source.id === 'motion-editor' ? '/motion' : '/';
      await page.goto(fixtureURL(route), { waitUntil: 'networkidle' });
      await page.locator('.local-badge[data-save-state="Salvo neste dispositivo"]').waitFor();
      const generator = page.locator('[data-node-id="generator"]');
      if (source.id !== 'motion-editor') {
        await generator.waitFor();
        await page.getByRole('button', { name: 'Ajustar ao conteúdo', exact: true }).click();
      }
      if (source.id === 'model-menu') await generator.locator('.model-trigger').click();
      if (source.id === 'aspect-menu') await generator.getByRole('button', { name: /^Proporção: / }).click();
      if (source.id === 'model-library') {
        await generator.getByRole('button', { name: 'Editar nó', exact: true }).click();
        await page.locator('.inspector-model').click();
      }
      if (source.id === 'node-menu') await generator.getByRole('button', { name: 'Opções do nó' }).click();
      if (source.id === 'status-menu') {
        await generator.getByRole('button', { name: 'Opções do nó' }).click();
        await page.getByRole('menuitem', { name: 'Alterar status', exact: true }).hover();
        await page.getByRole('menuitemradio', { name: 'Aprovado', exact: true }).waitFor();
      }
      if (source.id === 'add-menu') await page.getByRole('button', { name: 'Adicionar nó', exact: true }).click();
      if (source.id === 'motion-editor') {
        await page.locator('.motion-editor').waitFor();
        await page.waitForTimeout(700);
      }
      await capture(`source-${source.id}`);
    } finally { await page.close(); }
  }
  page = primaryPage;
  passed('source-size-captures', `${sourceIds ? sourceIds.length : screenshots.length} supplied states captured at the original native pixel dimensions, with an explicit DPR 1 assumption and no source resizing.`);
}

async function modelPickerChecks(generator) {
  async function open(trigger, kind) {
    const responses = ['openrouter', 'higgsfield'].map(provider => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/models' && url.searchParams.get('provider') === provider && url.searchParams.get('kind') === kind;
    }));
    await trigger.click();
    await Promise.all(responses);
    await settle();
  }
  async function verifyKinds(kind) {
    const dialog = page.getByRole('dialog', { name: 'Modelos', exact: true });
    for (const provider of ['OpenRouter', 'Higgsfield']) {
      await dialog.getByRole('button', { name: provider, exact: true }).click();
      const rows = page.locator('.model-list > button');
      assert.ok(await rows.count() > 0, `${provider} ${kind} models should exist`);
      assert.ok((await rows.locator('small').allTextContents()).every(value => value === provider));
      assert.ok((await rows.locator('em').allTextContents()).every(value => value === (kind === 'video' ? 'Vídeo' : 'Imagem')));
    }
    await dialog.getByRole('button', { name: 'Todos os modelos', exact: true }).click();
  }
  await open(generator.locator('.model-trigger'), 'image');
  await verifyKinds('image');
  await capture('model-menu');
  await accessibility('model-picker');
  await closeDialog();
  await generator.getByRole('button', { name: 'Editar nó', exact: true }).click();
  await open(page.locator('.inspector-model'), 'image');
  await verifyKinds('image');
  await capture('model-library');
  await closeDialog();
  await page.getByRole('button', { name: 'Fechar propriedades' }).click();
  passed('image-provider-catalog', 'Both actual provider catalog endpoints queried with kind=image. Each provider filter contains image entries only; model modal and inspector opening recaptured. No paid generation call.');

  await page.getByRole('button', { name: 'Adicionar nó', exact: true }).click();
  await page.locator('.add-panel').getByRole('button', { name: 'Gerar vídeo Vídeo', exact: true }).click();
  const video = page.locator('.canvas-node.kind-video').last();
  await open(video.locator('.model-trigger'), 'video');
  await verifyKinds('video');
  await capture('model-video-catalog');
  await closeDialog();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.waitForTimeout(1200);
  passed('video-provider-catalog', 'Both actual provider catalog endpoints queried with kind=video. Each provider filter contains video entries only; temporary video node undone.');

  await page.route('**/api/models?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled QA catalog unavailable' }) }));
  await generator.locator('.node-visual').click();
  await open(generator.locator('.model-trigger'), 'image');
  await verifyKinds('image');
  await closeDialog();
  await page.getByRole('button', { name: 'Adicionar nó', exact: true }).click();
  await page.locator('.add-panel').getByRole('button', { name: 'Gerar vídeo Vídeo', exact: true }).click();
  await open(page.locator('.canvas-node.kind-video').last().locator('.model-trigger'), 'video');
  await verifyKinds('video');
  await closeDialog();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.unroute('**/api/models?**');
  passed('catalog-fallback', 'Controlled 503 responses for catalog GET requests verify both provider fallback catalogs remain filtered by image/video kind. No credentials or paid endpoints used.');
  await captureSourceDimensions(['model-menu', 'model-library']);
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.ONUN_CHROMIUM_PATH ? { executablePath: process.env.ONUN_CHROMIUM_PATH } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.addInitScript(()=>{if(window.top===window)localStorage.setItem('onun-space-locale','pt-BR');});
  page = await context.newPage();
  monitorPage(page);
  await page.goto(fixtureURL('/'), { waitUntil: 'networkidle' });
  await page.getByRole('main').waitFor();
  await page.locator('.local-badge[data-save-state="Salvo neste dispositivo"]').waitFor();
  const generator = page.locator('[data-node-id="generator"]');
  await generator.waitFor();
  assert.equal(await page.locator('.dev-status').count(), 0);
  if (modelPickerOnly) {
    await modelPickerChecks(generator);
  } else {
  await capture('canvas-1440');
  await accessibility('canvas');
  passed('canvas-load', 'Canvas loaded from the local API, with generation node, local status, and no development notice in QA capture.');

  await generator.locator('.model-trigger').click();
  await page.getByRole('dialog', { name: 'Modelos', exact: true }).waitFor();
  await capture('model-menu');
  await page.getByRole('textbox', { name: 'Pesquisar modelos' }).fill('no-model-found-onun-qa');
  assert.equal(await page.locator('.model-list > button').count(), 0);
  await page.getByRole('textbox', { name: 'Pesquisar modelos' }).fill('');
  await closeDialog();
  passed('model-picker', 'Model catalog opens, filters to zero results, and closes with dialog focus semantics.');

  await generator.getByRole('button', { name: /^Proporção: / }).click();
  await page.getByRole('menu').waitFor();
  await capture('aspect-menu');
  await page.keyboard.press('Escape');
  passed('aspect-menu', 'Custom ratio menu opens and Escape dismisses it.');

  await generator.locator('.node-visual').click();
  await generator.getByRole('button', { name: 'Editar nó', exact: true }).click();
  await page.getByRole('complementary', { name: 'Propriedades do nó' }).waitFor();
  await capture('inspector');
  await page.locator('.inspector-model').click();
  await page.getByRole('dialog').waitFor();
  await capture('model-library');
  await closeDialog();
  await page.getByRole('button', { name: 'Fechar propriedades' }).click();
  passed('inspector', 'Node properties and full model picker open from the inspector.');

  await generator.getByRole('button', { name: 'Opções do nó' }).click();
  await page.getByRole('menu').waitFor();
  await capture('node-menu');
  await page.keyboard.press('Escape');
  await generator.getByRole('button', { name: 'Alterar status' }).click();
  await page.getByRole('menu').waitFor();
  await capture('status-menu');
  const originalStatus = await generator.locator('.status-badge').innerText();
  await page.getByRole('menuitemradio', { name: 'Aprovado' }).click();
  assert.match(await generator.locator('.status-badge').innerText(), /Aprovado/);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  assert.equal(await generator.locator('.status-badge').innerText(), originalStatus);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  assert.match(await generator.locator('.status-badge').innerText(), /Aprovado/);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  assert.equal(await generator.locator('.status-badge').innerText(), originalStatus);
  passed('review-undo-redo', 'Review status changes, undo and redo update the node correctly.');

  await generator.locator('.node-visual').click();
  const count = await page.locator('.canvas-node').count();
  await generator.getByRole('button', { name: 'Duplicar nó', exact: true }).click();
  assert.equal(await page.locator('.canvas-node').count(), count + 1);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  assert.equal(await page.locator('.canvas-node').count(), count);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  assert.equal(await page.locator('.canvas-node').count(), count + 1);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  assert.equal(await page.locator('.canvas-node').count(), count);
  await page.waitForTimeout(1200);
  assert.equal((await request(`/projects/${projectId}`)).nodes.length, count);
  passed('duplicate-undo-redo', 'Duplicating a node creates a distinct node and undo/redo restores the expected count.');

  await page.getByRole('button', { name: 'Adicionar nó', exact: true }).click();
  await page.locator('.add-panel').waitFor();
  await capture('add-menu');
  await page.getByRole('textbox', { name: 'Pesquisar ferramentas' }).fill('motion');
  assert.equal(await page.locator('.add-panel .add-item').count(), 3);
  await page.getByRole('button', { name: 'Fechar ferramentas' }).click();
  passed('add-palette', 'Add-node palette opens, searches the motion tool, and closes.');

  await page.getByRole('button', { name: 'Conectar API', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await capture('settings-providers');
  assert.equal(await page.getByRole('button', { name: 'Conectar provedor' }).isDisabled(), true);
  await page.getByRole('button', { name: /Higgsfield/ }).click();
  await page.getByText('Cole a API key completa copiada do painel Higgsfield.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').locator('input[type="password"]').count(), 1);
  assert.equal(await page.getByLabel('API secret', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Conectar provedor' }).isDisabled(), true);
  await page.getByRole('dialog').getByRole('button', { name: 'Conexão MCP', exact: true }).click();
  await page.getByText('CONFIGURAÇÃO STDIO').waitFor();
  await capture('settings-mcp');
  await accessibility('settings-mcp');
  await closeDialog();
  passed('settings', 'Provider form requires one API key; Higgsfield complete-key helper and MCP configuration are reachable. No credentials submitted.');

  for (const width of [1920, 1024, 761, 760]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
    await page.getByRole('button', { name: 'Ajustar ao conteúdo', exact: true }).click();
    await settle();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, header: document.querySelector('.app-header').getBoundingClientRect().width }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, `Document overflow at ${width}: ${JSON.stringify(geometry)}`);
    assert.equal(await page.getByRole('button', { name: 'Adicionar nó', exact: true }).isVisible(), true);
    await capture(`canvas-${width}`);
  }
  passed('responsive', 'Canvas checked at 760, 761, 1024, 1440 and 1920 CSS pixels with no page-level horizontal overflow.');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureURL('/motion'), { waitUntil: 'networkidle' });
  await page.locator('.motion-editor').waitFor();
  await page.locator('iframe[title="Prévia da cena de motion"]').waitFor();
  await page.waitForTimeout(700);
  await capture('motion-editor');
  await accessibility('motion');
  passed('motion-deep-link', 'Direct /motion route renders layers, sandboxed scene, inspector, and timeline. Editing/render behavior is covered separately.');
  await captureSourceDimensions();
  }
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert.deepEqual(report.requestFailures, [], 'Browser request failures');
  const violations = report.accessibility.flatMap(result => result.violations.map(item => `${result.name}: ${item.id} (${item.nodes.length} nodes)`));
  assert.deepEqual(violations, [], 'Accessibility violations');
} catch (error) {
  failure = error;
  report.failure = error.stack || String(error);
  if (page) await capture('failure').catch(() => {});
} finally {
  await context?.close();
  await browser?.close();
  try {
    const current = await request(`/projects/${projectId}`);
    assert.deepEqual(current.nodes, original.nodes);
    assert.deepEqual(current.edges, original.edges);
    assert.deepEqual(current.motion, original.motion);
    report.fixtureFinalState = { id: current.id, revision: current.revision, reversibilityVerified: true, activeUserProjectUntouched: true };
  } catch (error) {
    report.fixtureFinalStateFailure = String(error);
    failure ||= error;
  }
  try {
    const fixtureRoot=resolve(process.env.ONUN_TEST_PROJECT_DIR || '.onun/projects');
    for(const fixturePath of [resolve(fixtureRoot, `${projectId}.json`),resolve(fixtureRoot,projectId,'project.json')]){
      try{const stored=JSON.parse(await readFile(fixturePath,'utf8'));assert.equal(stored.id,projectId);await rm(fixturePath.endsWith('/project.json')?resolve(fixtureRoot,projectId):fixturePath,{recursive:fixturePath.endsWith('/project.json')});}
      catch(error){if(error.code!=='ENOENT'){failure ||= error;report.fixture.cleanupNote=String(error);}}
    }
    report.fixture.cleanedUp = !report.fixture.cleanupNote;
  } catch (error) {
    report.fixture.cleanupNote = error.code === 'ENOENT' ? 'Runtime data directory differs; configure ONUN_TEST_PROJECT_DIR for fixture cleanup.' : String(error);
  }
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/${reportName}.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (modelPickerOnly && !failure) {
    const primaryPath = `${output}/browser-smoke.json`;
    try {
      const primary = JSON.parse(await readFile(primaryPath, 'utf8'));
      const updates = new Map(report.captures.map(item => [item.name, item]));
      primary.captures = primary.captures.map(item => updates.has(item.name) ? { ...updates.get(item.name), checkedAt: report.checkedAt, verificationFollowup: `${output}/${reportName}.json`, supersedesSha256: item.sha256 } : item);
      primary.followups = [{ report: `${output}/${reportName}.json`, checkedAt: report.checkedAt, status: report.status, notes: 'Focused final model picker verification; matching capture records now refer to the recaptured files.' }];
      await writeFile(primaryPath, `${JSON.stringify(primary, null, 2)}\n`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        failure ||= error;
        report.status = 'failed';
        report.captureLedgerUpdateFailure = String(error);
        await writeFile(`${output}/${reportName}.json`, `${JSON.stringify(report, null, 2)}\n`);
      }
    }
  }
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.captures.length, accessibility: report.accessibility.map(item => ({ name: item.name, violations: item.violations.length })), report: `${output}/${reportName}.json` }));
