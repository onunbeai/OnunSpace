import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/guided-tour-empty';
const focus = process.env.ONUN_TOUR_FOCUS;
const steps = [
  ['workspace', '.app-header'], ['canvas', '.canvas-area'], ['tools', '.canvas-tools', '.add-panel'],
  ['node', '.canvas-node.selected', '.dropdown'], ['connections', '.canvas-node.selected .port-out'],
  ['properties', '.canvas-node.selected .node-toolbar', '.node-inspector'],
  ['models', '.canvas-node.selected .model-trigger', '.modal:has(.model-list)'],
  ['motion', '.motion-editor'], ['timeline', '.motion-timeline'], ['library', '.file-library'],
  ['mcp', '.local-badge', '.modal:has(.mcp-content)'], ['backup', '.avatar', '.modal:has(.backup-dialog)'],
];
const makeProject = kind => {
  const project = { id: `qa-tour-${kind}`, name: `QA tour ${kind}`, revision: 7, updatedAt: '2026-09-26T16:00:00.000Z', nodes: [], edges: [], motion: { id: `qa-motion-${kind}`, name: 'Authored scene name', width: 1920, height: 1080, duration: 6, fps: 30, background: '#111111', layers: [] } };
  const base = { kind: 'image', width: 350, prompt: 'Keep this authored prompt exactly.', model: 'qa/image', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'review', generationStatus: 'idle' };
  if (kind === 'existing') {
    project.nodes = [{ ...base, id: 'authored-reference', kind: 'reference', title: 'Authored reference', x: -1500, y: 120, width: 250, artwork: 'orb' }, { ...base, id: 'authored-generator', title: 'Authored generator', x: -1130, y: 140 }];
    project.edges = [{ id: 'authored-edge', source: 'authored-reference', target: 'authored-generator' }];
    project.motion.layers = [{ id: 'authored-layer', name: 'Authored text', type: 'text', x: 200, y: 200, width: 800, height: 150, color: '#eeeeee', text: 'Keep this authored text.', fontSize: 80, fontWeight: 500, rotation: 0, opacity: 1, scale: 1, start: 0, end: 6, ease: 'none', keyframes: [{ time: 0, opacity: 0 }, { time: 2, opacity: 1 }] }];
  } else if (kind === 'note-only') project.nodes = [{ ...base, id: 'authored-note', kind: 'text', title: 'Authored note', x: 80, y: 80, prompt: 'A note must not become a generator.' }];
  return project;
};
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], targets: [], captures: [], errors: [], scenarios: [], isolation: 'Every API request is intercepted in a fresh browser context. Read-only in-memory project fixtures; any POST/PUT/DELETE fails this test. No user projects, credentials, provider requests, disk fixture storage or paid generation.' };
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
let failure;
const check = text => report.checks.push(text);
async function scenario(kind, locale, viewport, run) {
  const fixture = makeProject(kind), original = structuredClone(fixture), events = [], unexpected = [];
  const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.addInitScript(locale => { if (window.top === window) localStorage.setItem('onun-space-locale', locale); }, locale);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL).origin) { unexpected.push(`External request ${url.origin}`); return route.abort(); }
    return route.fallback();
  });
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    events.push({ path, method });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method !== 'GET') { unexpected.push(`Mutation ${method} ${path}`); return json({ error: 'Tour must not mutate the project' }, 503); }
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/settings') return json({ providers: { higgsfield: { configured: false, source: 'none' }, openrouter: { configured: false, source: 'none' } } });
    if (path === '/api/models') { const provider = url.searchParams.get('provider'), kind = url.searchParams.get('kind'); return json({ source: 'live', models: [{ id: `qa/${kind}`, name: `QA ${kind}`, canonicalId: `QA ${kind}`, provider, kind, supported: true }] }); }
    if (path === `/api/projects/${fixture.id}`) return json(fixture);
    if (path === `/api/projects/${fixture.id}/backup-settings`) return json({ destination: '/mock/backups', defaultDestination: '/mock/backups', projectDirectory: '/mock/project', lastBackup: null });
    if (path === '/api/mcp/config') return json({ mcpServers: { 'onun-space': { command: 'node', args: ['/mock/server/mcp.ts'] } } });
    unexpected.push(`Unexpected GET ${path}`); return json({ error: 'Unexpected QA request' }, 503);
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const url = `${baseURL}/?project=${fixture.id}`;
  const capture = async name => { const path = `${output}/${name}.png`; await page.screenshot({ path, animations: 'disabled' }); report.captures.push({ path, locale, viewport }); };
  try {
    await page.goto(url); await page.locator('.canvas-area').waitFor();
    await page.waitForFunction(name => document.querySelector('.project-name')?.textContent?.includes(name), fixture.name);
    await run({ page, fixture, capture, url });
    await page.waitForTimeout(700);
    assert.deepEqual(fixture, original);
    assert.deepEqual(unexpected, []);
    const cache = await page.evaluate(id => localStorage.getItem(`onun-space-project-v1-${id}`), fixture.id);
    assert.ok(!cache || !cache.includes('tour-example-'), 'Temporary examples must never enter the browser project cache');
    report.scenarios.push({ kind, locale, viewport, requests: events.length, mutations: events.filter(event => event.method !== 'GET') });
  } catch (error) { await capture(`${kind}-${locale}-${viewport.width}-failure`).catch(() => {}); throw error; }
  finally { await context.close(); }
}
async function start(page) { await page.getByRole('button', { name: /^(Guided tour|Guia interativo)$/, exact: true }).click(); await page.locator('.guided-tour-card').waitFor(); }
async function next(page) { await page.locator('.guided-tour-next').click(); }
async function back(page) { await page.locator('.guided-tour-back').click(); }
async function demoIds(page) { return page.locator('.canvas-node[data-node-id^="tour-example-"]').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId).sort()); }
async function visibleStep(page, step, advanced, scenario) {
  const [id, basic, detailed] = step;
  await page.locator(`.guided-tour[data-tour-step="${id}"][data-tour-advanced="${advanced}"]`).waitFor();
  let selector = advanced && detailed || basic;
  if (!advanced && ['mcp', 'backup'].includes(id) && !(await page.locator(basic).isVisible())) selector = '.header-actions';
  // Wait through viewport motion and spotlight measurement so a previous step's rect cannot satisfy this check.
  await page.waitForFunction(({ selector }) => {
    const target = document.querySelector(selector), highlight = document.querySelector('.guided-tour-highlight'), card = document.querySelector('.guided-tour-card');
    if (!target || !highlight || !card) return false;
    const rect = target.getBoundingClientRect(), spot = highlight.getBoundingClientRect(), panel = card.getBoundingClientRect();
    const expected = { x: Math.max(6, rect.left - 5), y: Math.max(6, rect.top - 5), width: Math.min(innerWidth - 6, rect.right + 5) - Math.max(6, rect.left - 5), height: Math.min(innerHeight - 6, rect.bottom + 5) - Math.max(6, rect.top - 5) };
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight && panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1 && Object.keys(expected).every(key => Math.abs(expected[key] - spot[key]) < 2);
  }, { selector }, { timeout: 6000 });
  report.targets.push({ scenario, step: id, advanced, selector, status: 'visible-and-spotlight-matched' });
  if (['node', 'connections', 'properties', 'models'].includes(id)) {
    assert.equal(await page.locator('.canvas-node.selected.generator-node').count(), 1, `${id} must select a genuine generator`);
    assert.equal(await page.locator('.canvas-node.selected .generate-button').count(), 1);
  }
  if (id === 'connections') {
    const geometry = await page.locator('.canvas-node').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { id: node.dataset.nodeId, visible: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight }; }));
    assert.ok(await page.locator('.canvas-edge').count() >= 1, 'Connections step needs a real example wire');
    assert.ok(geometry.filter(node => node.visible).length >= 2, `Connected pair must be framed: ${JSON.stringify(geometry)}`);
    assert.equal(await page.locator('.guided-tour-highlight').evaluate(element => getComputedStyle(element).borderTopLeftRadius), '999px');
  }
  if (id === 'timeline') assert.ok(await page.locator('.motion-keyframe').count() >= 2, 'Empty Motion needs an editable animation example');
}
async function assertCleanup(page, fixture, url) {
  await page.locator('.guided-tour').waitFor({ state: 'hidden' });
  assert.equal(page.url(), url);
  await page.locator('.canvas-area').waitFor();
  assert.deepEqual(await demoIds(page), []);
  assert.equal(await page.locator('.canvas-node').count(), fixture.nodes.length);
  assert.equal(await page.locator('.canvas-edge').count(), fixture.edges.length);
  assert.equal(await page.getByRole('button', { name: /^(Undo|Desfazer)$/, exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /^(Redo|Refazer)$/, exact: true }).isDisabled(), true);
}
try {
  if (focus === 'node') {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 390, height: 667 }]) await scenario('empty', 'pt-BR', viewport, async ({ page, fixture, capture, url }) => {
      await start(page);
      for (let index = 1; index <= 3; index++) await next(page);
      await visibleStep(page, steps[3], false, `node-focus-${viewport.width}x${viewport.height}`);
      await page.getByRole('switch', { name: 'Modo avançado', exact: true }).click();
      await visibleStep(page, steps[3], true, `node-focus-${viewport.width}x${viewport.height}`);
      const menu = await page.locator('.dropdown').boundingBox(), card = await page.locator('.guided-tour-card').boundingBox();
      const overlap = Math.max(0, Math.min(menu.x + menu.width, card.x + card.width) - Math.max(menu.x, card.x)) * Math.max(0, Math.min(menu.y + menu.height, card.y + card.height) - Math.max(menu.y, card.y));
      assert.equal(overlap, 0, `Demonstrated menu and guide card must not overlap: ${JSON.stringify({ menu, card })}`);
      assert.ok(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= viewport.width && menu.y + menu.height <= viewport.height);
      await capture(`node-refined-${viewport.width}x${viewport.height}`);
      if (viewport.width <= 480) {
        await page.mouse.move(menu.x + menu.width / 2, menu.y + menu.height / 2); await page.mouse.wheel(0, 230);
        await page.waitForFunction(() => document.querySelector('.dropdown').scrollTop > 0);
        await page.mouse.wheel(0, -1000); await page.waitForFunction(() => document.querySelector('.dropdown').scrollTop === 0);
        const session = await page.context().newCDPSession(page), x = menu.x + menu.width / 2, y = menu.y + menu.height - 24;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => document.querySelector('.dropdown').scrollTop > 0);
        await capture(`node-scroll-${viewport.width}x${viewport.height}`); await session.detach();
      }
      await next(page); await visibleStep(page, steps[4], true, 'node-focus-following-step');
      await capture(`connection-refined-${viewport.width}x${viewport.height}`);
      await back(page); await visibleStep(page, steps[3], true, 'node-focus-return');
      await page.getByRole('switch', { name: 'Modo avançado', exact: true }).click();
      await visibleStep(page, steps[3], false, 'node-focus-basic-restored');
      assert.equal(await page.locator('.dropdown').count(), 0);
      await page.keyboard.press('Escape'); await assertCleanup(page, fixture, url);
      check(`${viewport.width}x${viewport.height}: basic/advanced node spotlight works; menu and card never overlap; ${viewport.width <= 480 ? 'mouse wheel and touch scroll the menu; ' : ''}neighboring step, revisit, mode toggle and cleanup work`);
    });
  } else {
  for (const kind of ['empty', 'existing', 'note-only']) await scenario(kind, 'en', { width: 1440, height: 1000 }, async ({ page, fixture, capture, url }) => {
    for (const advanced of [false, true]) {
      await start(page);
      if (advanced) await page.getByRole('switch', { name: 'Advanced mode', exact: true }).click();
      let previousDemoIds;
      for (let index = 0; index < steps.length; index++) {
        if (index) await next(page);
        const id = steps[index][0];
        await visibleStep(page, steps[index], advanced, `${kind}-desktop`);
        if (kind === 'existing' && index <= 6) assert.deepEqual(await demoIds(page), [], 'Existing suitable nodes must be reused');
        if (id === 'node' && kind !== 'existing') { assert.equal((await demoIds(page)).length, 1); await page.locator('.guided-tour-example-note').waitFor(); }
        if (id === 'connections') { previousDemoIds = await demoIds(page); await back(page); await visibleStep(page, steps[index - 1], advanced, `${kind}-revisit`); await next(page); await visibleStep(page, steps[index], advanced, `${kind}-revisit`); assert.deepEqual(await demoIds(page), previousDemoIds); }
        if (id === 'models' && kind === 'empty') { await capture(`empty-models-${advanced ? 'advanced' : 'basic'}`); }
        if (id === 'connections' && kind === 'empty' && !advanced) await capture('empty-connected-pair');
        if (id === 'timeline' && kind === 'empty' && advanced) await capture('empty-motion-example');
        if (id === 'timeline' && kind === 'existing') assert.equal(await page.locator('.motion-keyframe[data-layer-id="authored-layer"]').count(), 2);
      }
      await next(page); await assertCleanup(page, fixture, url);
      check(`${kind}, ${advanced ? 'advanced' : 'basic'}: every step targets its actual UI; demos are framed and reused on revisit; Finish removes only demos without undo history`);
    }
    // Restart in the same context must not retain previous transient examples. Escape must clean them too.
    await start(page); for (let i = 1; i <= 4; i++) await next(page);
    await visibleStep(page, steps[4], false, `${kind}-restart`);
    if (kind === 'empty') assert.equal((await demoIds(page)).length, 2);
    await page.keyboard.press('Escape'); await assertCleanup(page, fixture, url);
    check(`${kind}: restart creates no duplicate examples and Escape restores the original editor contents`);
  });
  await scenario('empty', 'pt-BR', { width: 390, height: 844 }, async ({ page, fixture, capture, url }) => {
    for (const advanced of [false, true]) {
      await start(page);
      if (advanced) await page.getByRole('switch', { name: 'Modo avançado', exact: true }).click();
      for (let index = 0; index < steps.length; index++) { if (index) await next(page); await visibleStep(page, steps[index], advanced, 'empty-390-pt'); if ([3, 4].includes(index)) await capture(`empty-390-${steps[index][0]}-${advanced ? 'advanced' : 'basic'}`); }
      await next(page); await assertCleanup(page, fixture, url);
    }
    check('390px PT-BR: all twelve basic and advanced steps retain a visible target and bounded card, then clean up ephemeral examples');
  });
  }
  assert.deepEqual(report.errors, []);
  check('All tour interactions preserve authored project fields, revision and browser project cache; zero mutation or generation requests');
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally { await browser.close(); report.status = failure ? 'failed' : 'passed'; await writeFile(`${output}/${focus ? `report-${focus}` : 'report'}.json`, `${JSON.stringify(report, null, 2)}\n`); }
if (failure) { console.error(failure); process.exitCode = 1; } else console.log(JSON.stringify({ status: report.status, checks: report.checks.length, targets: report.targets.length, captures: report.captures.length, report: `${output}/${focus ? `report-${focus}` : 'report'}.json` }));
