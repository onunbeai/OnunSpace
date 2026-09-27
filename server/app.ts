import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { validateMotionScene, type MotionLayer } from '../shared/motion.js';
import { Credentials, providerSchema } from './credentials.js';
import { HttpError, publicError } from './errors.js';
import { GenerationJobs } from './jobs.js';
import { generationSchema, Providers } from './providers.js';
import { RenderQueue } from './render.js';
import { ProjectStore, identifier, projectSchema } from './store.js';
import { applyOperations, batchSchema } from './operations.js';
import { Backups, backupOptionsSchema } from './backups.js';

const allowedOrigins = new Set(['http://127.0.0.1:5178', 'http://localhost:5178', 'http://127.0.0.1:4178', 'http://localhost:4178', 'http://127.0.0.1:4318', 'http://localhost:4318']);
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif':'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf':'font/ttf','.otf':'font/otf','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.zip':'application/zip','.onun':'application/zip' };

async function readJson(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Envie JSON.', 'unsupported_content_type');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 20_000_000) throw new HttpError(413, 'O projeto ultrapassou o limite de 20 MB por solicitação.', 'payload_too_large');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new HttpError(400, 'JSON inválido.', 'invalid_json'); }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function secureRequest(request: IncomingMessage) {
  const host = request.headers.host?.split(':')[0];
  if (!host || !['127.0.0.1', 'localhost'].includes(host)) throw new HttpError(403, 'Host não permitido.', 'host_forbidden');
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin) && origin !== `http://${request.headers.host}`) throw new HttpError(403, 'Origem não permitida.', 'origin_forbidden');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Solicitação entre sites bloqueada.', 'origin_forbidden');
  if (!['GET', 'HEAD'].includes(request.method ?? '') && request.headers['x-onun-client'] !== 'studio') throw new HttpError(403, 'Identificação do cliente necessária.', 'client_header_required');
}

async function serveFile(response: ServerResponse, path: string, download = false) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'Arquivo não encontrado.', 'file_not_found');
  response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'private, max-age=300', ...(download ? { 'Content-Disposition': `attachment; filename="${path.split(sep).pop()}"` } : {}) });
  createReadStream(path).pipe(response);
}

export interface AppOptions { dataDirectory?: string; staticDirectory?: string; credentials?: Credentials; fetch?: typeof fetch }

export function createApp(options: AppOptions = {}) {
  const dataDirectory = resolve(options.dataDirectory || process.env.ONUN_DATA_DIR || '.onun');
  const credentials = options.credentials ?? new Credentials(process.env, join(dataDirectory,'private','credentials.json'));
  const projects = new ProjectStore(join(dataDirectory, 'projects'));
  const providers = new Providers(credentials, options.fetch);
  const generation = new GenerationJobs(providers, projects, join(dataDirectory, 'assets'));
  const renders = new RenderQueue(join(dataDirectory, 'renders'));
  const backups = new Backups(projects, dataDirectory);

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      secureRequest(request);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1:4318');
      const path = url.pathname;
      const method = request.method;
      if (method === 'GET' && path === '/api/health') return json(response, 200, { status: 'ok', runtime: 'local', version: '0.1.0', persistence: 'filesystem', mcp: 'stdio', render: 'chromium-ffmpeg', capabilities: ['project-revisions', 'project-folders', 'portable-zip-backups', 'portable-onun-projects', 'backup-restore', 'atomic-batch', 'canvas-graph', 'scene-layers', 'keyframe-timeline', 'custom-html-css-gsap', 'asset-import', 'provider-generation', 'render-queue'], limits: { projectBytes: 20000000, nodes: 1000, layers: 200, batchOperations: 200, concurrentGeneration: 4, queuedRenders: 4 } });
      if (method === 'GET' && path === '/api/mcp/config') return json(response, 200, { mcpServers: { 'onun-space': { command: process.versions.electron ? 'node' : process.execPath, args: ['--import', fileURLToPath(import.meta.resolve('tsx')), fileURLToPath(new URL('./mcp.ts', import.meta.url))], env: { ONUN_RUNTIME_URL: `http://127.0.0.1:${process.env.ONUN_PORT || 4318}` } } } });
      if (path === '/api/settings') {
        if (method === 'GET') return json(response, 200, credentials.status());
        if (method === 'POST') return json(response, 200, credentials.set(await readJson(request)));
      }
      if (method === 'GET' && path === '/api/models') return json(response, 200, await providers.models(providerSchema.parse(url.searchParams.get('provider') ?? 'openrouter'), generationSchema.shape.kind.parse(url.searchParams.get('kind') ?? 'image')));
      if (path === '/api/projects') {
        if (method === 'GET') return json(response, 200, { projects: await projects.list() });
        if (method === 'POST') return json(response, 201, await projects.save(await readJson(request), undefined, true));
      }
      if (path === '/api/backups/restore' && method === 'POST') {
        const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
        if (!['application/zip','application/octet-stream','application/x-onun-project'].includes(contentType ?? '')) throw new HttpError(415, 'Send an .onun or .zip project archive.', 'unsupported_content_type');
        const fileName = request.headers['x-onun-filename'];
        if (Array.isArray(fileName)) throw new HttpError(400, 'Send one project archive filename.', 'invalid_backup');
        return json(response, 201, await backups.restore(request, fileName));
      }
      const backupSettingsMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/backup-settings$/);
      if (backupSettingsMatch) {
        if (method === 'GET') return json(response, 200, await backups.settings(backupSettingsMatch[1]));
        if (method === 'PUT') { const input = z.object({ destination:z.string() }).parse(await readJson(request)); return json(response, 200, await backups.setDestination(backupSettingsMatch[1], input.destination)); }
      }
      const backupsMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/backups$/);
      if (backupsMatch && method === 'POST') { const input = backupOptionsSchema.parse(await readJson(request)); return json(response, 201, await backups.create(backupsMatch[1], input)); }
      const backupDownloadMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/backups\/([a-zA-Z0-9_-]+)\/file$/);
      if (backupDownloadMatch && method === 'GET') return await serveFile(response, await backups.download(backupDownloadMatch[1], backupDownloadMatch[2]), true);
      const projectAssetMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/assets\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf))$/);
      if (projectAssetMatch && method === 'GET') {
        await projects.get(projectAssetMatch[1]);
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return await serveFile(response, join(projects.projectDirectory(projectAssetMatch[1]), 'assets', projectAssetMatch[2]));
      }
      const projectMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
      if (projectMatch) {
        const id = identifier.parse(projectMatch[1]);
        if (method === 'GET') return json(response, 200, await projects.get(id));
        if (method === 'PUT') {
          const input = z.object({ project: projectSchema, expectedRevision: z.number().int().min(0).optional() }).parse(await readJson(request));
          if (input.project.id !== id) throw new HttpError(400, 'ID do projeto não corresponde à URL.', 'id_mismatch');
          return json(response, 200, await projects.save(input.project, input.expectedRevision));
        }
      }
      const sceneMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/scene$/);
      const batchMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/batch$/);
      if (batchMatch && method === 'POST') {
        const input = batchSchema.parse(await readJson(request));
        const project = await projects.get(batchMatch[1]);
        return json(response, 200, await projects.save(applyOperations(project, input.operations), input.expectedRevision));
      }
      if (method === 'POST' && path === '/api/validate') { projectSchema.parse(await readJson(request)); return json(response, 200, { valid: true }); }
      if (sceneMatch) {
        if (method === 'GET') return json(response, 200, (await projects.get(sceneMatch[1])).motion);
        if (method === 'PUT') {
          const scene = validateScene(await readJson(request));
          return json(response, 200, await projects.mutate(sceneMatch[1], project => ({ ...project, motion: scene })));
        }
      }
      const layerMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/layers\/([a-zA-Z0-9_-]+)$/);
      if (layerMatch && method === 'PUT') {
        const patch = z.record(z.string(), z.unknown()).parse(await readJson(request));
        if (Object.keys(patch).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new HttpError(400, 'Propriedade inválida.', 'invalid_property');
        return json(response, 200, await projects.mutate(layerMatch[1], project => {
          if (!project.motion.layers.some(layer => layer.id === layerMatch[2])) throw new HttpError(404, 'Camada não encontrada.', 'layer_not_found');
          const motion = validateScene({ ...project.motion, layers: project.motion.layers.map(layer => layer.id === layerMatch[2] ? { ...layer, ...patch, id: layer.id } : layer) });
          return { ...project, motion };
        }));
      }
      const timelineMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/timeline$/);
      if (timelineMatch && method === 'PUT') {
        const input = z.object({ duration: z.number().optional(), fps: z.number().optional(), tracks: z.array(z.object({ layerId: identifier, keyframes: z.array(z.record(z.string(), z.unknown())).max(100) })).max(200).default([]) }).parse(await readJson(request));
        return json(response, 200, await projects.mutate(timelineMatch[1], project => ({ ...project, motion: validateScene({ ...project.motion, duration: input.duration ?? project.motion.duration, fps: input.fps ?? project.motion.fps, layers: project.motion.layers.map(layer => ({ ...layer, keyframes: input.tracks.find(track => track.layerId === layer.id)?.keyframes as MotionLayer['keyframes'] ?? layer.keyframes })) }) })));
      }
      if (method === 'POST' && path === '/api/generate') return json(response, 202, await generation.create(generationSchema.parse(await readJson(request))));
      if(method==='GET'&&path==='/api/jobs')return json(response,200,{jobs:await generation.list(url.searchParams.get('projectId')??undefined)});
      const jobMatch = path.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)$/);
      if (jobMatch) {
        if (method === 'GET') return json(response, 200, await generation.get(jobMatch[1]));
        if (method === 'DELETE') return json(response, 200, await generation.cancel(jobMatch[1]));
      }
      if (method === 'POST' && path === '/api/renders') {
        const input = z.object({ projectId: identifier.optional(), scene: z.unknown().optional(), options: z.object({ format: z.enum(['mp4', 'webm']).optional(), quality: z.enum(['draft', 'high']).optional(), width: z.number().int().min(64).max(4096).optional(), height: z.number().int().min(64).max(4096).optional(), fps: z.number().int().min(1).max(60).optional() }).optional() }).parse(await readJson(request));
        const scene = validateScene(input.scene ?? (input.projectId ? (await projects.get(input.projectId)).motion : undefined));
        try { return json(response, 202, renders.publicJob(renders.enqueue(scene, input.options))); }
        catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Não foi possível criar o render.', 'render_request_invalid'); }
      }
      if (method === 'GET' && path === '/api/renders') return json(response, 200, { jobs: renders.list().map(job => renders.publicJob(job)) });
      const renderMatch = path.match(/^\/api\/renders\/([a-zA-Z0-9_-]+)(\/file)?$/);
      if (renderMatch) {
        const job = renders.get(renderMatch[1]);
        if (!job) throw new HttpError(404, 'Render não encontrado.', 'render_not_found');
        if (method === 'GET' && renderMatch[2]) {
          if (!job.filePath || !resolve(job.filePath).startsWith(join(dataDirectory, 'renders') + sep)) throw new HttpError(404, 'O render ainda não está disponível.', 'render_not_ready');
          return await serveFile(response, job.filePath, true);
        }
        if (method === 'GET') return json(response, 200, renders.publicJob(job));
        if (method === 'DELETE') { await renders.cancel(job.id); return json(response, 200, renders.publicJob(job)); }
      }
      if (path === '/api/assets' && method === 'GET') {
        await mkdir(generation.assetDirectory, { recursive: true, mode: 0o700 });
        const names = (await readdir(generation.assetDirectory)).filter(name => /^[a-zA-Z0-9_-]+\.(png|jpg|webp|mp4|webm)$/.test(name)).slice(0, 1000);
        return json(response, 200, { assets: await Promise.all(names.map(async name => ({ name, url: `/api/assets/${name}`, bytes: (await stat(join(generation.assetDirectory, name))).size }))) });
      }
      if (path === '/api/assets' && method === 'POST') {
        const input = z.object({ dataUrl: z.string().max(16000000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) }).parse(await readJson(request));
        const [, format, encoded] = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(input.dataUrl)!;
        const bytes = Buffer.from(encoded, 'base64');
        const valid = format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : format === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) throw new HttpError(400, 'Arquivo não corresponde ao formato de imagem.', 'invalid_asset');
        const name = `${randomUUID()}.${format === 'jpeg' ? 'jpg' : format}`;
        await mkdir(generation.assetDirectory, { recursive: true, mode: 0o700 });
        await writeFile(join(generation.assetDirectory, name), bytes, { mode: 0o600 });
        return json(response, 201, { name, url: `/api/assets/${name}`, bytes: bytes.length });
      }
      const assetMatch = path.match(/^\/api\/assets\/([a-zA-Z0-9_-]+\.(png|jpg|webp|mp4|webm))$/);
      if (method === 'GET' && assetMatch) return await serveFile(response, join(dataDirectory, 'assets', assetMatch[1]));
      if (method === 'GET' && options.staticDirectory && !path.startsWith('/api/')) {
        const root = resolve(options.staticDirectory);
        const candidate = resolve(root, `.${decodeURIComponent(path)}`);
        if (candidate !== root && !candidate.startsWith(root + sep)) throw new HttpError(403, 'Caminho inválido.', 'path_forbidden');
        const isFile = await stat(candidate).then(info => info.isFile()).catch(() => false);
        return await serveFile(response, isFile ? candidate : join(root, 'index.html'));
      }
      throw new HttpError(404, 'Rota não encontrada.', 'not_found');
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const result = publicError(error);
      json(response, result.status, result.body);
    }
  });
  server.requestTimeout = 130_000;
  server.headersTimeout = 15_000;
  server.on('close',()=>{void generation.dispose();});
  return { server, projects, credentials, generation, renders, backups };
}

function validateScene(value: unknown) {
  try { return validateMotionScene(value); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Cena inválida.', 'invalid_scene'); }
}
