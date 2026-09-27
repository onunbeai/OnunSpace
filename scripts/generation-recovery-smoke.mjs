import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/generation-recovery';
const fixture = {
  id: 'qa-generation-recovery', name: 'QA generation', revision: 1, edges: [],
  nodes: [{ id: 'generator', kind: 'image', title: 'QA generator', x: 100, y: 100, width: 350, prompt: 'Synthetic fixture only', provider: 'higgsfield', model: 'qa-model', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', generationStatus: 'complete', media: 'https://example.invalid/old.png', outputs: ['https://example.invalid/old.png'] }],
  motion: { id: 'qa-motion', name: 'QA', width: 1920, height: 1080, fps: 30, duration: 6, background: '#111111', layers: [] },
};
const completed = (source, suffix = 'new') => ({ ...structuredClone(source), revision: (source.revision || 0) + 1, nodes: source.nodes.map(node => ({ ...node, generationStatus: 'complete', media: `https://example.invalid/${suffix}.png`, outputs: [`https://example.invalid/${suffix}.png`], error: undefined })) });
const report = { checkedAt: new Date().toISOString(), checks: [], errors: [], isolation: 'React hook harness, synthetic in-memory projects and all API requests mocked. No real project, credentials or generation accessed.' };
let browser, failure;
await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let submissions = [], polls = [], postMode = 'running', pollMode = 'transient';
  await page.addInitScript(value => { window.__generationFixture = value; }, fixture);
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/generate') {
      submissions.push(request.postDataJSON());
      return postMode === 'error' ? json({ error: 'Mock rejected submission' }, 400) : json({ id: request.postDataJSON().requestId, status: postMode });
    }
    if (path.startsWith('/api/jobs/')) { polls.push(path); return pollMode === 'transient' ? json({ error: 'Mock temporary outage' }, 503) : json({ id: path.split('/').at(-1), status: pollMode, ...(pollMode === 'error' ? { error: 'Mock definitive provider failure' } : {}) }); }
    report.errors.push(`Unexpected API request ${request.method()} ${path}`);
    return json({}, 503);
  });
  await page.route('**/__qa-generation', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/fixtures/generation-harness.tsx"></script></body></html>' }));
  page.on('pageerror', error => report.errors.push(error.message));
  const load = async () => { await page.goto(`${baseURL}/__qa-generation`); await page.waitForFunction(() => !!window.__generationQA?.generate); };
  const state = () => page.evaluate(() => structuredClone(window.__generationQA.states));
  const start = () => page.evaluate(() => window.__generationQA.generate());
  const waitStatus = status => page.waitForFunction(value => window.__generationQA.states.generator?.generationStatus === value, status);
  const waitClear = () => page.waitForFunction(() => !window.__generationQA.states.generator);
  const replace = value => page.evaluate(next => window.__generationQA.replace(next), value);
  const waitUntil = async test => { for (let i = 0; i < 80; i++) { if (test()) return; await page.waitForTimeout(100); } throw new Error('Timed out waiting for mocked request'); };
  const check = text => report.checks.push(text);

  await load();
  await page.evaluate(() => window.__generationQA.hold());
  await start(); await waitStatus('running');
  await replace({ ...fixture, revision: 2, name: 'Unrelated saved change' });
  await start(); await page.waitForTimeout(100); assert.equal(submissions.length, 0);
  assert.equal((await state()).generator.generationStatus, 'running');
  await page.evaluate(() => window.__generationQA.release());
  await waitUntil(() => submissions.length === 1);
  await start(); await page.waitForTimeout(100); assert.equal(submissions.length, 1);
  assert.match(submissions[0].requestId, /^[a-f0-9-]{36}$/);
  check('Pending beforeStart retains its running overlay over an old completed result and duplicate actions submit once');

  await waitUntil(() => polls.length === 1);
  assert.equal((await state()).generator.generationStatus, 'running');
  const remote = completed(fixture);
  remote.nodes.push({ ...fixture.nodes[0], id: 'result', kind: 'reference', title: 'QA result', x: 8000, y: 100, media: 'https://example.invalid/new.png' });
  await replace(remote); await waitClear();
  const pollCount = polls.length; await page.waitForTimeout(4300); assert.equal(polls.length, pollCount, 'Authoritative completion cancels pending local polls');
  assert.equal(submissions.length, 1);
  const boxes = await page.locator('[data-node-id="result"]').evaluate(el => { const target = el.getBoundingClientRect(), area = el.parentElement.parentElement.getBoundingClientRect(); return { left: target.left, right: target.right, top: target.top, bottom: target.bottom, area: { left: area.left, right: area.right, top: area.top, bottom: area.bottom } }; });
  assert.ok(boxes.left >= boxes.area.left && boxes.right <= boxes.area.right && boxes.top >= boxes.area.top && boxes.bottom <= boxes.area.bottom);
  check('Transient job polling errors do not mark generation failed; authoritative completion clears overlays and polling');
  check('New result-node IDs received from the project are revealed by the existing viewport without mutating node coordinates');
  await page.screenshot({ path: `${output}/authoritative-result.png` });

  await load(); submissions = []; polls = []; postMode = 'complete'; pollMode = 'complete';
  await page.evaluate(next => window.__generationQA.setSync(next, 1), completed(fixture, 'sync'));
  await start(); await waitStatus('running');
  await page.waitForTimeout(150); assert.equal((await state()).generator.error, undefined);
  await waitClear();
  assert.equal(submissions.length, 1); assert.equal(polls.length, 0);
  assert.equal(await page.evaluate(() => window.__generationQA.syncCalls), 2);
  check('A completed job retries failed project synchronization and never resubmits generation or displays a generation failure');

  await load(); submissions = []; polls = []; postMode = 'error';
  await start(); await waitStatus('error');
  await replace(completed(fixture, 'recovered')); await waitClear();
  check('A later authoritative result clears a local submission-error overlay');

  await load(); submissions = []; polls = []; postMode = 'running'; pollMode = 'running';
  await start(); await waitStatus('running'); await waitUntil(() => submissions.length === 1);
  const other = { ...structuredClone(fixture), id: 'qa-other-project' };
  await replace(other); await waitClear();
  await page.waitForTimeout(2300); assert.equal(polls.length, 0);
  assert.equal(await page.evaluate(() => window.__generationQA.notices.length), 0);
  check('Changing projects cancels timers and prevents old-job state or notifications leaking into a same-ID node');

  await load(); submissions = []; polls = [];
  await page.evaluate(() => window.__generationQA.hold()); await start(); await waitStatus('running');
  await replace(other); await waitClear(); await page.evaluate(() => window.__generationQA.release());
  await page.waitForTimeout(100); assert.equal(submissions.length, 0);
  check('A project change during beforeStart prevents submitting the old project after its save resolves');

  await load(); submissions = []; polls = [];
  await start(); await waitUntil(() => submissions.length === 1);
  await page.evaluate(() => window.__generationQA.unmount());
  await page.waitForTimeout(2300); assert.equal(polls.length, 0);
  await load(); assert.deepEqual(await state(), {}); assert.equal(submissions.length, 1);
  check('Unmount and reload discard local overlays and timers without regenerating');
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally { await browser?.close(); report.status = failure ? 'failed' : 'passed'; await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`); }
if (failure) { console.error(failure); process.exitCode = 1; } else console.log(JSON.stringify(report));
