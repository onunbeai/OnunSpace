import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/projects-ui';
const report = { checkedAt: new Date().toISOString(), fixture: 'Isolated Projects component; every API request mocked; callbacks only recorded in memory', checks: [], errors: [], requests: [] };
const records = [
  { id: 'current', name: 'Universo Onun', revision: 7, updatedAt: '2026-09-26T17:20:00Z' },
  { id: 'film', name: 'Explorações visuais — lançamento de uma coleção com um nome muito longo para verificar a leitura e o alinhamento dos controles', revision: 2, updatedAt: '2026-09-25T13:10:00Z' },
  { id: 'brand', name: 'Direção de marca', revision: 1, updatedAt: '2026-09-21T10:20:00Z' },
];
let mode = 'loading';
let releaseLoading;
const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
await context.route('**/api/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  report.requests.push({ path, method: request.method() });
  if (path === '/api/projects' && request.method() === 'GET') {
    if (mode === 'loading') await loadingGate;
    return route.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'error' ? { error: 'Fixture list error' } : { projects: mode === 'empty' ? [] : records }) });
  }
  return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated Projects fixture"}' });
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const check = (name, detail) => report.checks.push({ name, detail });
let failure;
await mkdir(output, { recursive: true });
try {
  await page.goto(baseURL);
  await page.locator('.app-header').waitFor();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const react = await import(resources.find(url => /\/react\.js\?/.test(url)));
    const dom = await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)));
    const React = react.default || react;
    const [{ Projects }, { TooltipProvider }] = await Promise.all([import('/src/features/projects/Projects.tsx'), import('/src/components/Tooltip.tsx')]);
    document.getElementById('root').style.display = 'none';
    const fixture = document.createElement('div');
    fixture.id = 'projects-fixture';
    fixture.style.cssText = 'height:100dvh;display:flex;flex-direction:column';
    document.body.append(fixture);
    window.__projectsActions = [];
    window.__createMode = 'fail';
    const onCreate = async name => {
      window.__projectsActions.push({ action: 'create', name });
      if (window.__createMode === 'fail') throw new Error('Fixture create error');
      if (window.__createMode === 'hold') await new Promise(resolve => { window.__releaseCreate = resolve; });
    };
    (dom.createRoot || dom.default.createRoot)(fixture).render(React.createElement(TooltipProvider, null, React.createElement(Projects, {
      currentProject: { id: 'current', name: 'Universo Onun' },
      onOpen: id => window.__projectsActions.push({ action: 'open', id }),
      onBackup: () => window.__projectsActions.push({ action: 'backup' }),
      onRestore: () => window.__projectsActions.push({ action: 'restore' }),
      onCreate,
    })));
  });
  await page.getByRole('status').filter({ hasText: 'Loading projects' }).waitFor();
  assert.equal(await page.locator('.projects-records').getAttribute('aria-busy'), 'true');
  check('Loading state is announced and holds until the actual response');
  mode = 'ready';
  releaseLoading();
  await page.locator('.projects-row').first().waitFor();
  assert.equal(await page.locator('.projects-row').count(), 3);
  assert.equal(await page.locator('.projects-current').innerText(), 'Current project');
  assert.equal(await page.locator('.projects-open').first().innerText(), 'Open');
  assert.equal(await page.locator('.projects-date time').count(), 3);
  await page.getByRole('button', { name: 'Export backup of Universo Onun', exact: true }).click();
  await page.getByRole('button', { name: 'Restore project', exact: true }).click();
  await page.locator('[data-project-id="brand"] .projects-open').click();
  assert.deepEqual(await page.evaluate(() => window.__projectsActions), [{ action: 'backup' }, { action: 'restore' }, { action: 'open', id: 'brand' }]);
  check('Real metadata and current project indicator; open, backup, restore callbacks fire once');

  const search = page.getByRole('searchbox', { name: 'Search projects' });
  await search.fill('direcao');
  assert.equal(await page.locator('.projects-row').count(), 1);
  assert.equal(await page.locator('.projects-row').getAttribute('data-project-id'), 'brand');
  await search.fill('missing project');
  await page.getByRole('heading', { name: 'No projects found.' }).waitFor();
  await page.locator('.projects-search').getByRole('button', { name: 'Clear search' }).click();
  assert.equal(await page.locator('.projects-row').count(), 3);
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  check('Search ignores diacritics, empty results are distinct, clear restores all projects');

  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Project name', exact: true });
  await name.waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  assert.equal(await name.evaluate(element => element === document.activeElement), true);
  const create = page.getByRole('button', { name: 'Create project', exact: true });
  assert.equal(await create.isDisabled(), true);
  await name.fill('  New fixture project  ');
  await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Fixture create error' }).waitFor();
  assert.equal(await name.inputValue(), '  New fixture project  ');
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  await page.evaluate(() => { window.__createMode = 'hold'; });
  await create.click();
  await page.getByRole('button', { name: 'Creating…', exact: true }).waitFor();
  assert.equal(await name.isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'New project' }).count(), 1);
  await page.evaluate(() => window.__releaseCreate());
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.__projectsActions)).filter(item => item.action === 'create').length, 2);
  assert.equal(await page.getByRole('button', { name: 'New project', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  assert.equal(await name.inputValue(), '');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check('Create modal focuses name, blocks empty/double submissions, preserves failure, waits for success, restores focus');

  mode = 'error';
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByRole('heading', { name: 'Could not load projects.' }).waitFor();
  mode = 'empty';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('heading', { name: 'No projects yet.' }).waitFor();
  mode = 'ready';
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.locator('.projects-row').first().waitFor();
  check('List failure retries; empty library has its own creation action');

  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.locator('.projects-page').evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, buttons: [...element.querySelectorAll('.projects-row button')].map(button => { const rect = button.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: rect.width }; }) }));
    assert.ok(geometry.scroll <= geometry.client + 1, `Horizontal overflow at ${width}`);
    for (const button of geometry.buttons) assert.ok(button.x >= 0 && button.right <= width, `Clipped action at ${width}`);
    const axe = await new AxeBuilder({ page }).include('#projects-fixture').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/projects-${width}.png` });
    check(`No overflow or clipped controls; long names and accessibility at ${width}px`, geometry);
  }
  // Use the public storage event so a Vite HMR module URL cannot create a second
  // i18n singleton solely for this isolated fixture's dynamic import.
  await page.evaluate(() => {
    localStorage.setItem('onun-space-locale', 'pt-BR');
    window.dispatchEvent(new StorageEvent('storage', { key: 'onun-space-locale', newValue: 'pt-BR' }));
  });
  await page.getByRole('heading', { name: 'Projetos', exact: true }).waitFor();
  assert.equal(await page.locator('.projects-current').innerText(), 'Projeto atual');
  await page.getByRole('searchbox', { name: 'Pesquisar projetos' }).fill('missing');
  await page.getByRole('heading', { name: 'Nenhum projeto encontrado.' }).waitFor();
  await page.locator('.projects-search').getByRole('button', { name: 'Limpar busca' }).click();
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do projeto', exact: true }).fill('Projeto de exemplo');
  await page.screenshot({ path: `${output}/create-project-390-pt.png` });
  await page.keyboard.press('Escape');
  check('English and Portuguese labels, metadata formatting, search and creation modal');
  assert.deepEqual(report.errors, []);
  assert.equal(report.requests.filter(request => request.method !== 'GET').length, 0);
  check('No runtime errors or network mutations; all callbacks are fixture-only');
} catch (error) {
  failure = error;
  report.failure = error.stack;
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  releaseLoading();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (failure) throw failure;
console.log(`Projects UI smoke passed: ${report.checks.length} checks. ${output}/report.json`);
