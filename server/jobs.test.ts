import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Credentials } from './credentials.js';
import { GenerationJobs } from './jobs.js';
import { generationSchema, Providers } from './providers.js';
import { ProjectStore } from './store.js';
import { defaultScene } from '../shared/motion.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZasAAAAASUVORK5CYII=';

test('generation resolves scoped assets, persists actual output and deduplicates requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onun-jobs-'));
  try {
    const store = new ProjectStore(join(directory, 'projects'));
    const assetDirectory = join(directory, 'assets');
    await mkdir(assetDirectory);
    await writeFile(join(assetDirectory, 'reference.png'), Buffer.from(png, 'base64'));
    await store.save({ id: 'project', name: 'Test', edges: [], motion: defaultScene, nodes: [{ id: 'image', kind: 'image', title: 'Image', x: 0, y: 0, width: 300, prompt: 'Test', model: 'openai/gpt-image-1', provider: 'openrouter', aspectRatio: '1:1', resolution: '1K', count: 1, status: 'none' }] });
    await mkdir(join(store.projectDirectory('project'), 'assets'));
    await writeFile(join(store.projectDirectory('project'), 'assets', 'restored.png'), Buffer.from(png, 'base64'));
    let submissions = 0;
    let image = png;
    const providers = new Providers(new Credentials({ OPENROUTER_API_KEY: 'test-only-key' }), async (_url, init) => {
      if(String(_url).endsWith('/images/models'))return Response.json({data:[{id:'openai/gpt-image-1'}]});
      submissions++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input_references[0].image_url.url, `data:image/png;base64,${png}`);
      assert.equal(body.input_references[1].image_url.url, `data:image/png;base64,${png}`);
      return new Response(JSON.stringify({ data: [{ b64_json: image }] }));
    });
    const jobs = new GenerationJobs(providers, store, assetDirectory);
    const request = generationSchema.parse({ provider: 'openrouter', kind: 'image', model: 'openai/gpt-image-1', prompt: 'Test', projectId: 'project', nodeId: 'image', references: ['/api/assets/reference.png', '/api/projects/project/assets/restored.png'], requestId: randomUUID() });
    const submitted = await jobs.create(request);
    let result = await jobs.get(submitted.id);
    for (let attempt = 0; attempt < 100 && result.status === 'running'; attempt++) { await setTimeout(5); result = await jobs.get(submitted.id); }
    assert.equal(result.status, 'complete');
    assert.equal(submissions, 1);
    assert.equal((await jobs.create(request)).id, submitted.id);
    assert.equal(submissions, 1);
    assert.ok(result.outputs[0].startsWith('/api/assets/'));
    assert.equal((await readFile(join(assetDirectory, result.outputs[0].split('/').pop()!))).toString('base64'), png);
    await setTimeout(20);
    assert.equal((await store.get('project')).nodes[0].media, result.outputs[0]);
    for(const [extension,bytes] of [['jpg',Buffer.from([255,216,255,224,0,2,255,217])],['webp',Buffer.from('RIFF\u000c\u0000\u0000\u0000WEBPVP8L\u0000\u0000\u0000\u0000','binary')]] as const){
      image=bytes.toString('base64');
      const started=await jobs.create({...request,requestId:randomUUID()});
      let raster=await jobs.get(started.id);
      for(let attempt=0;attempt<100&&raster.status==='running';attempt++){await setTimeout(5);raster=await jobs.get(started.id);}
      assert.equal(raster.status,'complete');
      assert.ok(raster.outputs[0].endsWith(`.${extension}`));
      assert.deepEqual(await readFile(join(assetDirectory,raster.outputs[0].split('/').pop()!)),bytes);
    }
    image = Buffer.from('not an image').toString('base64');
    const bad = await jobs.create({ ...request, requestId: randomUUID() });
    let rejected = await jobs.get(bad.id);
    for (let attempt = 0; attempt < 100 && rejected.status === 'running'; attempt++) { await setTimeout(5); rejected = await jobs.get(bad.id); }
    assert.equal(rejected.status, 'error');
    assert.equal(rejected.outputs.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
