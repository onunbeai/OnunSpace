import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from './app.js';
import { unzipSync } from 'fflate';
import {defaultScene} from '../shared/motion.js';

test('MCP edits shared state, creates a portable ZIP and exports a real local video', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onun-mcp-'));
  const app = createApp({ dataDirectory: directory });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const client = new Client({ name: 'onun-runtime-test', version: '1.0.0' });
  const clientTransport = new StdioClientTransport({ command: process.execPath, args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('server/mcp.ts')], env: { ONUN_RUNTIME_URL: base, PATH: process.env.PATH ?? '' }, stderr: 'pipe' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const content = result.content as { type: string; text: string }[];
    return JSON.parse(content[0].text);
  };
  try {
    const project = await call('project_create', { name: 'MCP integration', projectId: 'mcp-test' });
    assert.equal(project.motion.layers.length,0);
    const fixture=await call('scene_upsert',{projectId:project.id,scene:structuredClone(defaultScene)});
    const updated = await call('project_batch', { projectId: project.id, expectedRevision: fixture.revision, operations: [{ op: 'project.rename', name: 'Edited by MCP' }, { op: 'layer.patch', id: 'title', patch: { text: 'Shared UI state' } }] });
    const readback = await (await fetch(`${base}/api/projects/mcp-test`)).json();
    assert.equal(readback.name, 'Edited by MCP');
    assert.equal(readback.motion.layers.find((layer: { id: string }) => layer.id === 'title').text, 'Shared UI state');
    const badBatch = await client.callTool({ name: 'project_batch', arguments: { projectId: project.id, expectedRevision: updated.revision, operations: [{ op: 'project.rename', name: 'Must not be saved' }, { op: 'layer.patch', id: 'title', patch: { opacity: 2 } }] } });
    assert.equal(badBatch.isError, true);
    const stillSame = await call('project_get', { projectId: project.id });
    assert.equal(stillSame.revision, updated.revision);
    assert.equal(stillSame.name, 'Edited by MCP');
    const backup = await call('project_backup_create', { projectId: project.id, destination: join(directory, 'chosen-backups') });
    const savedZip = await readFile(backup.path);
    assert.equal(savedZip.length, backup.bytes);
    const archive = unzipSync(savedZip);
    assert.equal(JSON.parse(Buffer.from(archive['project.json']).toString()).name, 'Edited by MCP');
    assert.ok(archive['motion/gsap.min.js'].length > 1000);
    const backupInfo = await call('project_backup_info', { projectId: project.id });
    assert.equal(backupInfo.destination, await realpath(join(directory, 'chosen-backups')));
    assert.equal(backupInfo.lastBackup.id, backup.id);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}${backup.downloadUrl}`)).arrayBuffer()), savedZip);
    await call('scene_upsert', { projectId: project.id, scene: { id: 'tiny-render', name: 'Tiny actual render', width: 128, height: 128, fps: 10, duration: .2, background: '#ff87f7', layers: [] } });
    const render = await call('render_create', { projectId: project.id, options: { format: 'mp4', quality: 'draft', width: 128, height: 128, fps: 10 } });
    let job = render;
    for (let attempt = 0; attempt < 100 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) { await setTimeout(250); job = await call('render_status', { jobId: render.id }); }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    assert.ok(job.bytes > 100);
    const video = await fetch(`${base}${job.downloadUrl}`);
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('Content-Type'), 'video/mp4');
    const bytes = Buffer.from(await video.arrayBuffer());
    assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
    assert.equal((await client.listPrompts()).prompts[0].name, 'motion-director');
    assert.equal((await client.readResource({ uri: 'onun://projects/mcp-test' })).contents.length, 1);
  } finally {
    await client.close();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
