import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { Credentials } from './credentials.js';
import { defaultScene } from '../shared/motion.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

test('HTTP origin protection, persistence, conflicts and provider failure boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onun-api-'));
  const app = createApp({ dataDirectory: directory, credentials: new Credentials({}), fetch: async () => { throw new Error('No external requests during integration tests'); } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Onun-Client': 'studio' };
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/health`, {headers:{Origin:base}})).status, 200);
    assert.equal((await fetch(`${base}/api/health`, {headers:{Origin:'http://127.0.0.1:9999'}})).status, 403);
    const mcpConfig = await (await fetch(`${base}/api/mcp/config`)).json();
    assert.equal(mcpConfig.mcpServers['onun-space'].args[0], '--import');
    assert.ok(mcpConfig.mcpServers['onun-space'].args[1].startsWith('/'));
    assert.equal((await fetch(`${base}/api/settings`, { headers: { Origin: 'https://hostile.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const project = { id: 'api-project', name: 'API test', nodes: [], edges: [], motion: defaultScene };
    const created = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify(project) });
    assert.equal(created.status, 201);
    const saved = await created.json();
    assert.equal(saved.revision, 1);
    const duplicate = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify(project) });
    assert.equal(duplicate.status, 409);
    const stale = await fetch(`${base}/api/projects/api-project`, { method: 'PUT', headers, body: JSON.stringify({ project: saved, expectedRevision: 0 }) });
    assert.equal(stale.status, 409);
    const changed = await fetch(`${base}/api/projects/api-project/layers/title`, { method: 'PUT', headers, body: JSON.stringify({ text: 'Edited through API' }) });
    assert.equal(changed.status, 200);
    const readback = await (await fetch(`${base}/api/projects/api-project`)).json();
    assert.equal(readback.motion.layers.find((layer: { id: string }) => layer.id === 'title').text, 'Edited through API');
    assert.equal(readback.revision, 2);
    const generation = await fetch(`${base}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openrouter', kind: 'image', model: 'openai/gpt-image-1', prompt: 'test' }) });
    assert.equal(generation.status, 428);
    assert.equal((await generation.json()).code, 'provider_not_configured');
    const settings = await fetch(`${base}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openrouter', apiKey: 'test-private-key' }) });
    assert.equal(settings.status, 200);
    assert.equal((await settings.text()).includes('test-private-key'), false);
    const invalidScene = await fetch(`${base}/api/projects/api-project/scene`, { method: 'PUT', headers, body: JSON.stringify({ ...defaultScene, duration: -1 }) });
    assert.equal(invalidScene.status, 400);
    const imported = await fetch(`${base}/api/assets`, { method: 'POST', headers, body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZasAAAAASUVORK5CYII=' }) });
    assert.equal(imported.status, 201);
    const asset = await imported.json();
    assert.equal((await fetch(`${base}${asset.url}`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/assets`)).json()).assets.length, 1);
    const invalidAsset = await fetch(`${base}/api/assets`, { method: 'POST', headers, body: JSON.stringify({ dataUrl: 'data:image/png;base64,bm90YW5pbWFnZQ==' }) });
    assert.equal(invalidAsset.status, 400);
  } finally { await new Promise<void>(resolve => app.server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('default HTTP runtime persists private credentials across clean process restarts without returning secrets',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'onun-private-api-'));
  const headers={'Content-Type':'application/json','X-Onun-Client':'studio'};
  const start=async()=>{
    const code="import{createApp}from './server/app.ts';const{server}=createApp({dataDirectory:process.argv[1]});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));";
    // The child receives no inherited environment credentials and never generates media.
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code,directory],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{},stdio:['ignore','pipe','pipe']});
    const lines=createInterface({input:child.stdout});const exit=once(child,'exit');
    const port=await Promise.race([once(lines,'line').then(([line])=>Number(line)),exit.then(()=>{throw new Error('Temporary credential runtime exited before startup');})]);
    lines.close();assert.ok(Number.isInteger(port)&&port>0);
    return{base:`http://127.0.0.1:${port}`,stop:async()=>{child.kill('SIGTERM');await exit;}};
  };
  let running:Awaited<ReturnType<typeof start>>|undefined;
  try{
    running=await start();
    const catalog=await(await fetch(`${running.base}/api/models?provider=higgsfield&kind=image`)).text();
    assert.equal(JSON.parse(catalog).models.length,15);assert.equal(catalog.includes('fake-private-http'),false);
    for(const provider of ['openrouter','higgsfield']){
      const response:Response=await fetch(`${running.base}/api/settings`,{method:'POST',headers,body:JSON.stringify({provider,apiKey:`fake-private-http-${provider}`})});
      assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes('fake-private-http'),false);assert.equal(JSON.parse(text).providers[provider].source,'stored');
    }
    await running.stop();running=await start();
    const status=await(await fetch(`${running.base}/api/settings`)).text();
    assert.equal(status.includes('fake-private-http'),false);
    assert.deepEqual(JSON.parse(status).providers,{openrouter:{configured:true,source:'stored'},higgsfield:{configured:true,source:'stored'}});
    assert.deepEqual(JSON.parse(status).credentialStorage,{persistent:true,available:true});
    const cleared=await fetch(`${running.base}/api/settings`,{method:'POST',headers,body:JSON.stringify({provider:'higgsfield',clear:true})});
    assert.equal(cleared.status,200);await running.stop();running=await start();
    const afterClear=await(await fetch(`${running.base}/api/settings`)).json();
    assert.deepEqual(afterClear.providers.higgsfield,{configured:false,source:'none'});
    assert.deepEqual(afterClear.providers.openrouter,{configured:true,source:'stored'});
    assert.equal((await readFile(join(directory,'private','credentials.json'),'utf8')).includes('fake-private-http-higgsfield'),false);
  }finally{if(running)await running.stop();await rm(directory,{recursive:true,force:true});}
});
