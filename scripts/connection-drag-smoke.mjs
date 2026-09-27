import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/artifacts/actual';
const projectId = `qa-connections-${Date.now()}`;
const headers = { 'Content-Type': 'application/json', 'X-Onun-Client': 'studio' };
const report = { baseURL, checkedAt: new Date().toISOString(), fixture: { projectId, sourceProjectReadOnly: 'onun-studio' }, checks: [], captures: [], errors: [], requestFailures: [] };
await mkdir(output, { recursive: true });

async function request(path, init = {}) {
  const method = init.method || 'GET';
  if (method !== 'GET') {
    const body = JSON.parse(init.body || '{}');
    assert.ok(path === `/projects/${projectId}` || (path === '/projects' && method === 'POST' && body.id === projectId), 'QA may only mutate its own fixture.');
  }
  const response = await fetch(`${baseURL}/api${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return value.project || value;
}
const original = await request('/projects/onun-studio');
const makeNode = (id, title, x, y) => ({ id, title, x, y, kind: 'image', width: 260, prompt: '', model: 'google/gemini-2.5-flash-image', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', artwork: 'brand' });
const fixture = { ...original, id: projectId, name: '[QA] Conexões por arraste', revision: 0, nodes: [makeNode('qa-source-a', 'Origem A', 140, 120), makeNode('qa-target-a', 'Destino A', 730, 120), makeNode('qa-source-b', 'Origem B', 140, 510), makeNode('qa-target-b', 'Destino B', 730, 510)], edges: [] };
await request('/projects', { method: 'POST', body: JSON.stringify(fixture) });
let browser;
let context;
let page;
let failure;
function passed(name, notes) { report.checks.push({ name, status: 'passed', notes }); }
const port = (id, direction) => page.locator(`[data-port="${direction}"][data-node="${id}"]`);
async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Port has a visible bounding box.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const path = `${output}/${name}.png`;
  const bytes = await page.screenshot({ path, animations: 'disabled' });
  report.captures.push({ name, path, sha256: createHash('sha256').update(bytes).digest('hex'), viewport: page.viewportSize(), deviceScaleFactor: 1 });
}
async function persistedEdges(count) {
  let current;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    current = await request(`/projects/${projectId}`);
    if (current.edges.length === count) return current.edges;
    await page.waitForTimeout(120);
  }
  assert.equal(current.edges.length, count, 'Expected persisted connection count.');
  return current.edges;
}
async function waitProject(predicate, message) {
  let current;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    current = await request(`/projects/${projectId}`);
    if (predicate(current)) return current;
    await page.waitForTimeout(120);
  }
  assert.ok(predicate(current), message);
  return current;
}
async function drag(source, target, preview = false) {
  const from = await center(port(source, 'out'));
  const to = typeof target === 'string' ? await center(port(target, 'in')) : target;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.waitForTimeout(60);
  if (preview) {
    assert.ok(await page.locator('.canvas-edges path:not(.edge-hit):not(.edge-flow)').count() > 0, 'Dragging exposes a connection preview before pointer release.');
    await capture('connection-drag-preview');
  }
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
async function checkEndpoints(edges) {
  const rendered = await page.locator('.canvas-edges g > path:not(.edge-hit):not(.edge-flow)').evaluateAll(paths => paths.map(path => {
    const matrix = path.getScreenCTM();
    const start = path.getPointAtLength(0).matrixTransform(matrix);
    const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }));
  assert.equal(rendered.length, edges.length);
  for (const [index, edge] of edges.entries()) {
    const source = await center(port(edge.source, 'out'));
    const target = await center(port(edge.target, 'in'));
    const startError = Math.hypot(rendered[index].start.x - source.x, rendered[index].start.y - source.y);
    const endError = Math.hypot(rendered[index].end.x - target.x, rendered[index].end.y - target.y);
    assert.ok(startError < 3 && endError < 3, `Connection endpoints must remain at port centers: ${JSON.stringify({ edge, startError, endError })}`);
  }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.ONUN_CHROMIUM_PATH ? { executablePath: process.env.ONUN_CHROMIUM_PATH } : {}) });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.addInitScript(()=>{if(window.top===window)localStorage.setItem('onun-space-locale','pt-BR');});
  await context.route('**/api/projects/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' && url.pathname !== `/api/projects/${projectId}`) {
      report.errors.push(`Prevented unexpected mutation: ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('requestfailed', failed => { if (failed.failure()?.errorText !== 'net::ERR_ABORTED') report.requestFailures.push({ url: failed.url(), error: failed.failure()?.errorText }); });
  await page.goto(`${baseURL}/?project=${projectId}&qa=1`, { waitUntil: 'networkidle' });
  await page.locator('.local-badge[data-save-state="Salvo neste dispositivo"]').waitFor();
  await page.getByRole('button', { name: 'Ajustar ao conteúdo', exact: true }).click();
  await port('qa-source-a', 'out').waitFor();
  assert.equal(await page.locator('.canvas-node').count(), 4);
  passed('fixture-loaded', 'Four deterministic QA nodes and no edges loaded from the local API; active project is read-only.');

  await drag('qa-source-a', 'qa-target-a', true);
  const first = await persistedEdges(1);
  assert.deepEqual(first.map(({ source, target }) => ({ source, target })), [{ source: 'qa-source-a', target: 'qa-target-a' }]);
  await checkEndpoints(first);
  passed('drag-connect', 'Holding the source output and releasing on target input creates a persistent edge; preview visible during drag and endpoints align with port centers.');

  await drag('qa-source-a', 'qa-target-a');
  await page.waitForTimeout(750);
  const duplicate = await persistedEdges(1);
  assert.deepEqual(duplicate, first, 'Duplicate attempt should not replace or add an edge.');
  passed('duplicate-rejected', 'Repeated drag onto the same target leaves the existing edge unchanged.');

  await drag('qa-source-a', 'qa-source-a');
  await page.waitForTimeout(750);
  assert.deepEqual(await persistedEdges(1), first);
  assert.equal(await page.locator('.canvas-edges path:not(.edge-hit):not(.edge-flow)').count(), 1, 'Self-drop clears its preview.');
  passed('self-rejected', 'Dropping on the source node input does not add a self-edge and clears the transient path.');

  const area = await page.locator('.canvas-area').boundingBox();
  await drag('qa-source-a', { x: area.x + area.width * 0.6, y: area.y + 25 });
  assert.equal(await page.locator('.canvas-edges path:not(.edge-hit):not(.edge-flow)').count(), 1, 'Empty drop clears its preview.');
  await port('qa-target-b', 'in').click();
  await page.waitForTimeout(750);
  assert.deepEqual(await persistedEdges(1), first, 'Canceled drag must not arm the following input click.');
  passed('empty-drop-cancel', 'Release on empty canvas cancels the gesture; a later input click cannot complete that canceled connection.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.connection-preview').count(), 0, 'Clear the independent input-click state before the click-to-click check.');

  await port('qa-source-b', 'out').click();
  assert.equal((await request(`/projects/${projectId}`)).edges.length, 1, 'Output click alone must only arm the connection.');
  await port('qa-target-b', 'in').click();
  const two = await persistedEdges(2);
  assert.ok(two.some(edge => edge.source === 'qa-source-b' && edge.target === 'qa-target-b'));
  await checkEndpoints(two);
  passed('click-to-click', 'Clicking an output followed by an input remains supported and persists the expected second edge.');

  await page.getByRole('button', { name: 'Diminuir zoom', exact: true }).click();
  await page.getByRole('button', { name: 'Diminuir zoom', exact: true }).click();
  await page.mouse.move(area.x + area.width / 2, area.y + 20);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 65, area.y + 45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await drag('qa-source-b', 'qa-target-a');
  const three = await persistedEdges(3);
  assert.ok(three.some(edge => edge.source === 'qa-source-b' && edge.target === 'qa-target-a'));
  await checkEndpoints(three);
  passed('zoom-pan-connect', 'Drag-to-connect still targets the correct node after zoom and pan; all three rendered SVG curves end at the actual transformed port centers.');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const wire = page.locator('.canvas-edges g.canvas-edge').first();
  const wirePoint = await wire.locator('.edge-line').evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(wirePoint.x, wirePoint.y);
  await page.waitForTimeout(80);
  const readFlow = () => wire.locator('.edge-flow').evaluate(path => {
    const style = getComputedStyle(path);
    return { animation: style.animationName, offset: style.strokeDashoffset, opacity: Number(style.opacity) };
  });
  assert.equal((await readFlow()).opacity,0,'Hover alone must not animate unselected connections.');
  await page.locator('[data-node-id="qa-source-a"] .node-visual').click();
  await page.mouse.move(area.x+area.width-30,area.y+30);
  await page.waitForTimeout(80);
  const flowStart = await readFlow();
  await page.waitForTimeout(200);
  const flowEnd = await readFlow();
  assert.notEqual(flowStart.animation, 'none', 'Selected node connections animate without hover.');
  assert.ok(flowEnd.opacity > 0, 'Selected connection stroke is visible.');
  assert.notEqual(flowStart.offset, flowEnd.offset, 'Dashed highlight moves along the wire over time.');
  report.wireFlow = { start: flowStart, end: flowEnd };
  const lineStyle=await wire.locator('.edge-line').evaluate(path=>({opacity:getComputedStyle(path).opacity}));
  assert.equal(lineStyle.opacity,'0','Selected stroke has no gray underlay.');
  await wire.locator('.edge-hit').focus();
  const focusStyle=await wire.locator('.edge-hit').evaluate(path=>({outline:getComputedStyle(path).outlineStyle,stroke:getComputedStyle(path).stroke,background:getComputedStyle(path).backgroundColor}));
  assert.equal(focusStyle.outline,'none');assert.equal(focusStyle.stroke,'rgba(0, 0, 0, 0)');assert.equal(focusStyle.background,'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.canvas-edge:not(.highlighted) .edge-flow').first().evaluate(path=>getComputedStyle(path).opacity),'0');
  await capture('connection-wire-selected');
  passed('wire-selection-flow', 'Only connections of the selected node animate; stroke dash offset changes over200ms with no gray underlay or SVG focus outline. Unrelated and hover-only edges remain static.');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(80);
  const reducedStart = await readFlow();
  await page.waitForTimeout(200);
  const reducedEnd = await readFlow();
  assert.equal(reducedStart.animation, 'none');
  assert.equal(reducedStart.offset, reducedEnd.offset, 'Reduced-motion preference keeps the selected stroke static.');
  report.wireFlow.reduced = reducedEnd;
  passed('wire-reduced-motion', 'prefers-reduced-motion disables the wire animation and its dash offset remains static.');

  const sourceOriginal = fixture.nodes.find(node => node.id === 'qa-source-a');
  const beforeBody = await center(port('qa-source-a', 'out'));
  const body = await center(page.locator('[data-node-id="qa-source-a"] .node-visual'));
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x + 48, body.y + 26, { steps: 10 });
  await page.mouse.up();
  const moved = await waitProject(project => project.nodes.find(node => node.id === 'qa-source-a').x !== sourceOriginal.x, 'Body drag persists the moved node.');
  const sourceMoved = moved.nodes.find(node => node.id === 'qa-source-a');
  assert.ok(sourceMoved.x > sourceOriginal.x && sourceMoved.y > sourceOriginal.y);
  const afterBody = await center(port('qa-source-a', 'out'));
  assert.ok(Math.abs(afterBody.x - beforeBody.x - 48) < 3 && Math.abs(afterBody.y - beforeBody.y - 26) < 3, 'Node body follows the drag in screen coordinates under zoom.');
  assert.equal(await page.getByRole('complementary', { name: 'Propriedades do nó' }).count(), 0, 'Body drag must not open the inspector.');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Body drag must not open image preview.');
  await checkEndpoints(three);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await waitProject(project => project.nodes.find(node => node.id === 'qa-source-a').x === sourceOriginal.x, 'Undo restores node body position.');
  await checkEndpoints(three);
  passed('body-drag-undo', 'Dragging the image body moves the node48×26screen pixels, persists without opening inspector/preview, and keeps edges attached; undo restores the node and edge geometry.');

  const current = await request(`/projects/${projectId}`);
  assert.deepEqual(current.nodes, fixture.nodes, 'Connection gestures and undone body drag preserve all original nodes.');
  assert.deepEqual(current.motion, fixture.motion);
  passed('nodes-preserved', 'Connection gestures did not move any node or mutate the motion composition.');
  report.fixtureFinalState = { edgeCount: current.edges.length, revision: current.revision, activeUserProjectUntouched: true };
  await capture('connection-drag-final');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.requestFailures, []);
} catch (error) {
  failure = error;
  report.failure = error.stack || String(error);
  if (page) await capture('connection-drag-failure').catch(() => {});
} finally {
  await context?.close();
  await browser?.close();
  try {
    const fixtureRoot=resolve(process.env.ONUN_TEST_PROJECT_DIR || '.onun/projects');
    for(const fixturePath of [resolve(fixtureRoot, `${projectId}.json`),resolve(fixtureRoot,projectId,'project.json')]){
      try{const stored=JSON.parse(await readFile(fixturePath,'utf8'));assert.equal(stored.id,projectId);await rm(fixturePath.endsWith('/project.json')?resolve(fixtureRoot,projectId):fixturePath,{recursive:fixturePath.endsWith('/project.json')});}
      catch(error){if(error.code!=='ENOENT'){failure ||= error;report.fixture.cleanupNote=String(error);}}
    }
    report.fixture.cleanedUp = !report.fixture.cleanupNote;
  } catch (error) {
    report.fixture.cleanupNote = error.code === 'ENOENT' ? 'Runtime data directory differs; configure ONUN_TEST_PROJECT_DIR for fixture cleanup.' : String(error);
    if (error.code !== 'ENOENT') failure ||= error;
  }
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/connection-drag-smoke.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.captures.length, report: `${output}/connection-drag-smoke.json` }));
