const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

let runtimeProcess;
let window;
const runtimePort = Number(process.env.ONUN_PORT || 4318);
if (!Number.isInteger(runtimePort) || runtimePort < 1024 || runtimePort > 65535) throw new Error('Invalid ONUN_PORT.');
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const root = join(__dirname, '..');

async function isReady() {
  try { const response = await fetch(`${runtimeUrl}/api/health`, { signal: AbortSignal.timeout(1000) }); const data = await response.json(); return response.ok && data.version === '0.1.0' && data.runtime === 'local'; }
  catch { return false; }
}

async function start() {
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Execute npm run build antes de abrir o aplicativo desktop.');
  if (!await isReady()) {
    runtimeProcess = spawn(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'server', 'index.ts')], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ONUN_STATIC_DIR: join(root, 'dist'), ONUN_DATA_DIR: process.env.ONUN_DATA_DIR || join(app.getPath('userData'), 'data') }, stdio: 'ignore' });
    for (let attempt = 0; attempt < 60 && !await isReady(); attempt++) await new Promise(resolve => setTimeout(resolve, 250));
    if (!await isReady()) throw new Error('O runtime local não respondeu. Confira se a porta 4318 está disponível.');
  }
  window = new BrowserWindow({ width: 1512, height: 982, minWidth: 800, minHeight: 600, backgroundColor: '#101012', title: 'Onun Space', autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  ipcMain.handle('onun:choose-backup-directory', async (event, currentPath) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== runtimeUrl) throw new Error('Untrusted folder-picker request.');
    if (typeof currentPath !== 'string' || currentPath.length > 4096 || /[\0\r\n]/.test(currentPath)) throw new Error('Invalid folder path.');
    const selection = await dialog.showOpenDialog(window, { title: 'Choose backup folder', defaultPath: currentPath || undefined, properties: ['openDirectory', 'createDirectory'] });
    return selection.canceled ? null : selection.filePaths[0] || null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { const destination = new URL(url); if (destination.protocol === 'https:' && ['openrouter.ai', 'open.higgsfield.ai', 'console.higgsfield.ai', 'docs.higgsfield.ai'].includes(destination.hostname)) void shell.openExternal(url); } catch { /* Refuse malformed navigation. */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, destination) => { if (!destination.startsWith(runtimeUrl + '/')) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadURL(runtimeUrl);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Onun Space', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => runtimeProcess?.kill('SIGTERM'));
}
