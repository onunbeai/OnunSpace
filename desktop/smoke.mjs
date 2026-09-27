import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const application = await electron.launch({ args: [resolve('.')], cwd: resolve('.'), timeout: 30000 });
try {
  const window = await application.firstWindow();
  await window.waitForSelector('#root button', { timeout: 30000 });
  const runtime = await window.evaluate(async () => (await fetch('/api/health')).json());
  const security = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity };
  });
  if (!security.contextIsolation || !security.sandbox || security.nodeIntegration || !security.webSecurity) throw new Error('Electron security preferences differ from the required configuration.');
  if (runtime.status !== 'ok') throw new Error('Local runtime is not ready.');
  const artifactDirectory = resolve('artifacts');
  await mkdir(artifactDirectory, { recursive: true });
  await window.screenshot({ path: resolve(artifactDirectory, 'desktop-smoke.png') });
  const evidence = { timestamp: new Date().toISOString(), url: window.url(), title: await window.title(), security, runtime, controls: await window.locator('button').count() };
  await writeFile(resolve(artifactDirectory, 'desktop-smoke.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally { await application.close(); }
