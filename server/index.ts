import { resolve } from 'node:path';
import { createApp } from './app.js';

try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const port = Number(process.env.ONUN_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ONUN_PORT deve ser uma porta entre 1024 e 65535.');
const app = createApp({ staticDirectory: process.env.ONUN_STATIC_DIR ? resolve(process.env.ONUN_STATIC_DIR) : resolve('dist') });
app.server.listen(port, '127.0.0.1', () => process.stdout.write(`Onun runtime disponível em http://127.0.0.1:${port}\n`));
app.server.on('error', error => { process.stderr.write(`Não foi possível iniciar o runtime: ${error.message}\n`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { app.server.close(); setTimeout(() => process.exit(0), 2000).unref(); });
