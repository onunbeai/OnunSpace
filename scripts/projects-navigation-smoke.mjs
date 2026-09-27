import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/projects-navigation';
const focusedScenarios = process.env.ONUN_PROJECTS_CASES?.split(',');
const currentId = 'qa-projects-current';
const otherId = 'qa-projects-other';
const makeProject = (id, name) => ({
  id, name, revision: 1, updatedAt: '2026-09-26T16:00:00.000Z', edges: [],
  nodes: [{ id: 'generator', kind: 'image', title: 'QA source', x: 120, y: 120, width: 350, prompt: 'Original authored prompt', model: 'qa/image', provider: 'higgsfield', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none', generationStatus: 'idle' }],
  motion: { id: `motion-${id}`, name: 'QA scene', width: 1920, height: 1080, duration: 6, fps: 30, background: '#111111', layers: [] },
});
const report = { ...(focusedScenarios ? { focusedScenarios } : {}), checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], scenarios: [], isolation: 'All API calls and project storage are mocked inside each browser context. No real project, credential, provider or generation is accessed. Archive transport is simulated; archive contents are covered by backend tests.' };
const zipBytes = Buffer.from([80, 75, 5, 6, ...Array(18).fill(0)]);
const browser = await chromium.launch({ headless: true });
let failure;
await mkdir(output, { recursive: true });
const check = text => report.checks.push(text);
async function scenario(name, run, options = {}) {
  if (focusedScenarios && !focusedScenarios.includes(name)) return;
  const projects = new Map([[currentId, makeProject(currentId, 'QA Current')], [otherId, makeProject(otherId, 'QA Other')]]);
  const events = [], downloads = [], externalRequests = [];
  const behavior = { failHealth: false, failPut: false, failBackup: false, failDownload: false, invalidDownloadUrl: false, holdBackup: false };
  let releaseBackup = () => {};
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(({ locale, cachedProject }) => { if (window.top === window) { localStorage.setItem('onun-space-locale', locale); if (cachedProject) localStorage.setItem(`onun-space-project-v1-${cachedProject.id}`, JSON.stringify(cachedProject)); } }, { locale: options.locale || 'en', cachedProject: options.cacheProject ? projects.get(currentId) : null });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL).origin) { externalRequests.push(url.origin); return route.abort(); }
    return route.fallback();
  });
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const event = { path, method, ...(method === 'POST' || method === 'PUT' ? { body: request.headers()['content-type']?.includes('json') ? request.postDataJSON() : '[binary archive]' } : {}) };
    events.push(event);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/health') return behavior.failHealth ? json({ error: 'Mock runtime unavailable' }, 503) : json({ status: 'ok' });
    if (path === '/api/settings') return json({ providers: { higgsfield: { configured: false }, openrouter: { configured: false } } });
    if (path === '/api/models') return json({ models: [], source: 'cached' });
    if (path === '/api/projects' && method === 'GET') return json({ projects: [...projects.values()].map(project => ({ id: project.id, name: project.name, revision: project.revision, updatedAt: project.updatedAt, nodes: project.nodes.length })) });
    if (path === '/api/projects' && method === 'POST') { const project = { ...request.postDataJSON(), revision: 1 }; assert.ok(!projects.has(project.id)); projects.set(project.id, project); return json(project, 201); }
    if (path === '/api/backups/restore' && method === 'POST') { const project = { ...makeProject('qa-restored-copy', 'QA Restored'), nodes: [], edges: [] }; projects.set(project.id, project); return json(project, 201); }
    const backup = /^\/api\/projects\/([^/]+)\/backups$/.exec(path);
    if (backup && method === 'POST') {
      if (behavior.holdBackup) await new Promise(resolve => { releaseBackup = resolve; });
      if (behavior.failBackup) return json({ error: 'Mock backup failed' }, 500);
      const format = request.postDataJSON().format;
      return json({ id: 'qa-backup', fileName: `QA Current.${format}`, path: `/mock/QA Current.${format}`, createdAt: '2026-09-26T16:00:00.000Z', bytes: zipBytes.length, downloadUrl: behavior.invalidDownloadUrl ? 'https://example.invalid/private-file' : `/api/projects/${backup[1]}/backups/qa-backup/file` }, 201);
    }
    if (/^\/api\/projects\/[^/]+\/backups\/[^/]+\/file$/.test(path)) return behavior.failDownload ? json({ error: 'Mock download failed' }, 500) : route.fulfill({ contentType: 'application/zip', body: zipBytes });
    const match = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (match) {
      const id = match[1];
      if (method === 'GET') return projects.has(id) ? json(projects.get(id)) : json({ error: 'Not found' }, 404);
      if (method === 'PUT') {
        if (behavior.failPut) return json({ error: 'Mock save failed' }, 503);
        const body = request.postDataJSON(), previous = projects.get(id);
        assert.equal(body.project.id, id);
        const project = { ...body.project, revision: (previous?.revision || 0) + 1 };
        projects.set(id, project); await json(project);
        events.push({ path, method: 'PUT_COMPLETED' }); return;
      }
    }
    report.errors.push(`Unexpected mocked API call ${method} ${path}`);
    return json({ error: 'Unexpected QA API request' }, 503);
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('download', download => downloads.push(download));
  const editor = async (id = currentId) => { await page.goto(`${baseURL}/?project=${id}`); await page.locator('.canvas-area').waitFor(); await page.waitForFunction(name => document.querySelector('.project-name')?.textContent?.includes(name), projects.get(id).name); };
  const leave = async (back = false) => { await (back ? page.locator('.project-back') : page.getByRole('navigation', { name: 'Editor modes', exact: true }).getByRole('button', { name: 'Projects', exact: true })).click(); const modal = page.getByRole('dialog', { name: 'Leave the editor?', exact: true }); await modal.waitFor(); return modal; };
  try {
    await run({ page, projects, events, behavior, downloads, editor, leave, release: () => releaseBackup() });
    assert.deepEqual(externalRequests, []);
    assert.equal(events.filter(event => event.path === '/api/generate').length, 0);
    report.scenarios.push({ name, locale: options.locale || 'en', viewport: options.viewport || { width: 1440, height: 1000 }, writes: events.filter(event => event.method === 'PUT' || event.method === 'POST').map(({ path, method }) => ({ path, method })), downloads: downloads.length });
  } catch (error) { await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {}); throw error; }
  finally { releaseBackup(); await context.close(); }
}

try {
  await scenario('entrypoints-and-cancel', async ({ page, editor, leave, events, projects }) => {
    await editor(); const original = structuredClone(projects.get(currentId));
    for (const back of [false, true]) {
      const modal = await leave(back);
      assert.ok((await modal.innerText()).includes(original.name));
      assert.equal(await modal.getByRole('button', { name: 'Project file format', exact: true }).innerText(), '.onun');
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      await modal.waitFor({ state: 'hidden' }); assert.equal(new URL(page.url()).pathname, '/');
    }
    assert.deepEqual(projects.get(currentId), original);
    assert.equal(events.filter(event => ['PUT', 'POST'].includes(event.method)).length, 0);
    check('Both Projects entry points open the leave dialog with .onun selected; Cancel stays in the editor without mutation');
    await leave(); await page.screenshot({ path: `${output}/leave-editor-desktop.png` });
  });

  for (const format of ['onun', 'zip']) await scenario(`save-download-${format}`, async ({ page, editor, leave, projects, events, downloads }) => {
    await editor();
    await page.locator('[data-node-id="generator"] textarea').fill(`Dirty prompt for ${format}`);
    const modal = await leave();
    if (format === 'zip') { await modal.getByRole('button', { name: 'Project file format', exact: true }).click(); await page.getByRole('menuitem', { name: 'ZIP', exact: true }).click(); }
    const downloaded = page.waitForEvent('download');
    await modal.getByRole('button', { name: format === 'onun' ? 'Save and download .onun' : 'Save and download ZIP', exact: true }).click();
    const download = await downloaded; await page.waitForURL(url => url.pathname === '/projects');
    assert.equal(download.suggestedFilename(), `QA Current.${format}`);
    assert.equal(downloads.length, 1);
    assert.equal(projects.get(currentId).nodes[0].prompt, `Dirty prompt for ${format}`);
    const saved = events.findIndex(event => event.method === 'PUT_COMPLETED'), backup = events.findIndex(event => event.path.endsWith('/backups') && event.method === 'POST');
    assert.ok(saved >= 0 && backup > saved, 'Backup starts only after dirty project save completed');
    assert.equal(events[backup].body.format, format);
    assert.equal(new URL(page.url()).searchParams.get('project'), currentId);
    check(`${format}: dirty editor saves before backup POST, downloads once, then opens Projects with the same current project ID`);
  });

  await scenario('save-only', async ({ page, editor, leave, events }) => {
    await editor(); await page.locator('[data-node-id="generator"] textarea').fill('Saved without download');
    const modal = await leave(); await modal.getByRole('button', { name: 'Save and go to Projects', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/projects');
    assert.equal(events.filter(event => event.path.endsWith('/backups')).length, 0);
    assert.ok(events.some(event => event.method === 'PUT_COMPLETED'));
    check('Save and go to Projects waits for save and does not create a backup');
  });

  await scenario('browser-storage-quota', async ({ page, editor, leave, behavior, events, projects }) => {
    behavior.failHealth = true;
    const original = structuredClone(projects.get(currentId));
    await editor();
    await page.waitForFunction(() => document.querySelector('.local-badge')?.getAttribute('data-save-state') === 'Browser draft');
    await page.evaluate(() => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('onun-space-project-v1-')) throw new DOMException('Mock quota exceeded', 'QuotaExceededError'); return originalSet.call(this, key, value); };
    });
    await page.locator('[data-node-id="generator"] textarea').fill('Unsaved browser-only draft');
    const modal = await leave();
    await modal.getByRole('button', { name: 'Save and go to Projects', exact: true }).click();
    await modal.getByRole('alert').waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('[data-node-id="generator"] textarea').inputValue(), 'Unsaved browser-only draft');
    assert.deepEqual(projects.get(currentId), original);
    assert.equal(events.filter(event => ['PUT', 'POST'].includes(event.method)).length, 0);
    await page.screenshot({ path: `${output}/browser-storage-quota.png` });
    check('Browser-only storage quota failure prevents leaving, retains the unsaved editor draft and reports a save error without backup or project writes');
  }, { cacheProject: true });

  for (const failureType of ['failPut', 'failBackup', 'failDownload', 'invalidDownloadUrl']) await scenario(failureType, async ({ page, editor, leave, behavior, downloads, events }) => {
    await editor(); behavior[failureType] = true;
    if (failureType === 'failPut') await page.locator('[data-node-id="generator"] textarea').fill('Pending unsaved draft');
    const modal = await leave(); await modal.getByRole('button', { name: 'Save and download .onun', exact: true }).click();
    await modal.getByRole('alert').waitFor();
    assert.equal(new URL(page.url()).pathname, '/'); assert.equal(downloads.length, 0);
    assert.equal(await modal.isVisible(), true);
    if (failureType === 'failPut') assert.equal(events.filter(event => event.path.endsWith('/backups')).length, 0);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    check(`${failureType}: failure keeps the editor and leave dialog open, reports error, and never downloads or navigates`);
  });

  await scenario('busy-controls', async ({ page, editor, leave, behavior, release, events, downloads }) => {
    await editor(); behavior.holdBackup = true;
    const modal = await leave(); const action = modal.getByRole('button', { name: 'Save and download .onun', exact: true });
    await action.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.disabled));
    await page.keyboard.press('Escape'); assert.equal(await modal.isVisible(), true);
    assert.equal(await modal.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
    assert.ok(await modal.locator('button:disabled').count() >= 3);
    assert.equal(events.filter(event => event.path.endsWith('/backups')).length, 1);
    release(); await page.waitForURL(url => url.pathname === '/projects'); assert.equal(downloads.length, 1);
    check('Busy save/download blocks escape, closing and repeated actions until its single request completes');
  });

  await scenario('projects-page-search-open', async ({ page, editor, projects, events }) => {
    const original = structuredClone(projects.get(currentId));
    await page.goto(`${baseURL}/projects?project=${currentId}`);
    await page.locator('.projects-page').waitFor(); await page.locator('.projects-records[aria-busy="false"]').waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Editor modes', exact: true }).getByRole('button', { name: 'Projects', exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.projects-row').count(), 2);
    assert.ok((await page.locator(`[data-project-id="${currentId}"]`).innerText()).includes('Current project'));
    await page.screenshot({ path: `${output}/projects-desktop.png` });
    const search = page.getByRole('searchbox', { name: 'Search projects', exact: true });
    await search.fill('Other'); assert.equal(await page.locator('.projects-row').count(), 1);
    await page.locator('.projects-open[aria-label="Open QA Other"]').click();
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('project') === otherId);
    await page.waitForFunction(() => document.querySelector('.project-name')?.textContent?.includes('QA Other'));
    assert.deepEqual(projects.get(currentId), original);
    await page.goto(`${baseURL}/projects?project=${currentId}`); await page.locator('.projects-page').waitFor(); await page.locator('.projects-records[aria-busy="false"]').waitFor();
    await page.locator('.projects-open[aria-label="Open QA Current"]').click();
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('project') === currentId);
    await editor();
    assert.equal(events.filter(event => event.method === 'POST' || event.method === 'PUT').length, 0);
    check('Projects highlights its active navigation and current project; searching/opening current or other saved projects never overwrites them');
  });

  await scenario('create-empty-project', async ({ page, projects, events }) => {
    const original = structuredClone(projects.get(currentId));
    await page.goto(`${baseURL}/projects?project=${currentId}`); await page.locator('.projects-page').waitFor(); await page.locator('.projects-records[aria-busy="false"]').waitFor();
    await page.locator('.projects-page').getByRole('button', { name: 'New project', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('textbox', { name: 'Project name', exact: true }).fill('QA New Empty');
    await modal.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/' && ![currentId, otherId].includes(url.searchParams.get('project')));
    const created = projects.get(new URL(page.url()).searchParams.get('project'));
    assert.equal(created.name, 'QA New Empty'); assert.deepEqual(created.nodes, []); assert.deepEqual(created.edges, []); assert.deepEqual(created.motion.layers, []); assert.equal(created.motion.customCode, undefined);
    assert.ok(created.motion.id && created.motion.id !== original.motion.id);
    assert.deepEqual(projects.get(currentId), original);
    assert.equal(events.filter(event => event.path === '/api/projects' && event.method === 'POST').length, 1);
    check('New project creates one new ID with empty canvas and Motion, preserves existing projects and opens its editor');
  });

  await scenario('restore-onun-new-project', async ({ page, projects, events }) => {
    const original = structuredClone(projects.get(currentId));
    await page.goto(`${baseURL}/projects?project=${currentId}`); await page.locator('.projects-records[aria-busy="false"]').waitFor();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore project', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'QA Portable.onun', mimeType: 'application/zip', buffer: zipBytes });
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('project') === 'qa-restored-copy');
    assert.deepEqual(projects.get(currentId), original);
    assert.ok(projects.has('qa-restored-copy'));
    assert.equal(events.filter(event => event.path === '/api/backups/restore' && event.method === 'POST').length, 1);
    assert.equal(events.filter(event => event.method === 'PUT').length, 0);
    check('Restoring a .onun archive calls restore once and opens its new project ID without overwriting the current project');
  });

  for (const locale of ['en', 'pt-BR']) await scenario(`responsive-${locale}`, async ({ page, editor }) => {
    await page.goto(`${baseURL}/projects?project=${currentId}`); await page.locator('.projects-page').waitFor(); await page.locator('.projects-records[aria-busy="false"]').waitFor();
    const title = locale === 'en' ? 'Projects' : 'Projetos';
    await page.locator('.projects-page').getByRole('heading', { name: title, exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/projects-390-${locale}.png` });
    await editor(); await page.locator('.project-back').click();
    const modal = page.getByRole('dialog', { name: locale === 'en' ? 'Leave the editor?' : 'Sair do editor?', exact: true }); await modal.waitFor();
    const box = await modal.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.ok(box.y >= 0 && box.y + box.height <= 844);
    await page.screenshot({ path: `${output}/leave-editor-390-${locale}.png` });
    check(`390px ${locale}: Projects and leave dialog remain visible without horizontal overflow`);
  }, { viewport: { width: 390, height: 844 }, locale });
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally { await browser.close(); report.status = failure ? 'failed' : 'passed'; await writeFile(`${output}/${focusedScenarios ? 'report-focused' : 'report'}.json`, `${JSON.stringify(report, null, 2)}\n`); }
if (failure) { console.error(failure); process.exitCode = 1; } else console.log(JSON.stringify(report));
