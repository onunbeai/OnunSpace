import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/credentials-ui';
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], interceptedRequests: 0, mockedSubmissions: [], isolation: 'All API requests intercepted. Synthetic credentials and in-memory settings only; no real keys, settings writes, project reads or provider requests.' };
const copy = {
  en: { open: 'Connect API', title: 'Settings', key: 'API key', connect: 'Connect provider', configured: 'Configured', success: 'Key saved. It will stay connected when you reopen OnunSpace.', placeholder: 'Paste your complete API key', helper: 'Paste the complete API key copied from your Higgsfield dashboard.', note: 'Your key is saved on this device and stays connected after restarting.' },
  'pt-BR': { open: 'Conectar API', title: 'Configurações', key: 'Chave da API', connect: 'Conectar provedor', configured: 'Configurado', success: 'Chave salva. Ela continuará ativa ao reabrir o OnunSpace.', placeholder: 'Cole sua API key completa', helper: 'Cole a API key completa copiada do painel Higgsfield.', note: 'A chave fica salva neste dispositivo e permanece ativa após reiniciar.' },
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failure;
try {
  for (const locale of ['en', 'pt-BR']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(value => { if (window.top === window) localStorage.setItem('onun-space-locale', value); }, locale);
    const state = { providers: { openrouter: { configured: false, source: 'none' }, higgsfield: { configured: false, source: 'none' } } };
    const submissions = [];
    await context.route('**/api/**', async route => {
      report.interceptedRequests++;
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/settings' && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
      if (path === '/api/settings' && request.method() === 'POST') {
        const body = request.postDataJSON();
        submissions.push(body);
        if (!['openrouter', 'higgsfield'].includes(body.provider)) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Invalid fixture provider"}' });
        state.providers[body.provider] = { configured: !body.clear, source: body.clear ? 'none' : 'stored' };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
      }
      if (path === '/api/mcp/config') return route.fulfill({ contentType: 'application/json', body: '{"mcpServers":{}}' });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated credentials fixture"}' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    try {
      const labels = copy[locale];
      await page.goto(baseURL);
      await page.getByRole('button', { name: labels.open, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: labels.title, exact: true });
      await dialog.waitFor();
      for (const provider of ['higgsfield', 'openrouter']) {
        const providerName = provider === 'higgsfield' ? 'Higgsfield' : 'OpenRouter';
        await dialog.locator('.provider-options button').filter({ hasText: providerName }).click();
        const input = dialog.getByLabel(labels.key, { exact: true });
        const connect = dialog.getByRole('button', { name: labels.connect, exact: true });
        assert.equal(await dialog.locator('input[type="password"]').count(), 1);
        assert.equal(await dialog.getByLabel('API secret', { exact: true }).count(), 0);
        assert.doesNotMatch(await dialog.innerText(), /API secret/i);
        assert.equal(await connect.isDisabled(), true);
        await input.fill('   ');
        assert.equal(await connect.isDisabled(), true);
        await input.fill('');
        assert.equal(await dialog.locator('.credential-note p').innerText(), labels.note);
        if (provider === 'higgsfield') {
          assert.equal(await input.getAttribute('placeholder'), labels.placeholder);
          assert.equal(await input.getAttribute('aria-describedby'), 'higgsfield-key-help');
          assert.equal(await dialog.locator('#higgsfield-key-help').innerText(), labels.helper);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: `${output}/higgsfield-${locale}.png` });
        } else {
          assert.equal(await input.getAttribute('placeholder'), 'sk-or-v1-…');
          assert.equal(await dialog.locator('#higgsfield-key-help').count(), 0);
        }
        report.checks.push({ locale, provider, name: 'Exactly one password field, localized copy, blank and whitespace disabled' });
        const fakeKey = provider === 'higgsfield' ? `qa-single-higgsfield-key-${locale}` : `sk-or-v1-qa-ui-key-${locale}`;
        await input.fill(fakeKey);
        assert.equal(await connect.isEnabled(), true);
        await connect.click();
        await dialog.getByRole('status').filter({ hasText: labels.success }).waitFor();
        assert.deepEqual(submissions.at(-1), { provider, apiKey: fakeKey, clear: false });
        assert.deepEqual(Object.keys(submissions.at(-1)).sort(), ['apiKey', 'clear', 'provider']);
        assert.equal(await input.inputValue(), '');
        assert.equal(await connect.isDisabled(), true);
        assert.match(await dialog.locator('.provider-options button.selected').innerText(), new RegExp(labels.configured));
        report.mockedSubmissions.push({ locale, provider, fields: Object.keys(submissions.at(-1)).sort(), clear: false, syntheticKeyOnly: true });
        report.checks.push({ locale, provider, name: 'Single synthetic key enables connect; payload omits apiSecret; success clears input' });
      }
      assert.equal(submissions.length, 2);
    } finally { await context.close(); }
  }
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
