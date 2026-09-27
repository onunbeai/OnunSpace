import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultScene } from '../shared/motion.js';
import { ProjectStore } from './store.js';
import { Credentials } from './credentials.js';
import { generationSchema, Providers } from './providers.js';
import { HttpError } from './errors.js';

const project = { id: 'test-project', name: 'Teste', nodes: [], edges: [], motion: defaultScene };

test('project writes survive readback and stale concurrent revisions cannot overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onun-store-'));
  try {
    const store = new ProjectStore(directory);
    const initial = await store.save(project, undefined, true);
    assert.equal(initial.revision, 1);
    const results = await Promise.allSettled([store.save({ ...initial, name: 'One' }, 1), store.save({ ...initial, name: 'Two' }, 1)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await store.get(project.id)).revision, 2);
    assert.equal(JSON.parse(await readFile(join(directory, project.id, 'project.json'), 'utf8')).revision, 2);
    assert.equal((await store.list()).length, 1);
    await assert.rejects(store.get('../secrets'));
    await assert.rejects(store.save({ ...project, motion: { ...defaultScene, duration: Infinity } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('credential state never returns the key and clearing only removes session credentials', () => {
  const credentials = new Credentials({ OPENROUTER_API_KEY: 'environment-private-key' });
  credentials.set({ provider: 'openrouter', apiKey: 'session-private-key' });
  assert.equal(credentials.header('openrouter'), 'Bearer session-private-key');
  assert.equal(JSON.stringify(credentials.status()).includes('private-key'), false);
  credentials.set({ provider: 'openrouter', clear: true });
  assert.equal(credentials.header('openrouter'), 'Bearer environment-private-key');
  credentials.set({ provider: 'higgsfield', apiKey: 'single-dashboard-key' });
  assert.equal(credentials.header('higgsfield'), 'Key single-dashboard-key');
  assert.throws(() => new Credentials({}).header('openrouter'), (error: unknown) => error instanceof HttpError && error.status === 428);
});

test('OpenRouter adapter uses documented image contract without exposing keys to output', async () => {
  const credentials = new Credentials({ OPENROUTER_API_KEY: 'test-key-not-real' });
  let destination = '';
  let payload: Record<string, unknown> = {};
  const request: typeof fetch = async (input, init) => {
    destination = String(input);
    payload = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key-not-real');
    return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
  };
  const providers = new Providers(credentials, request);
  await providers.submit(generationSchema.parse({ provider: 'openrouter', kind: 'image', model: 'openai/gpt-image-1', prompt: 'An editorial product image', aspectRatio: '1:1' }), new AbortController().signal);
  assert.equal(destination, 'https://openrouter.ai/api/v1/images');
  assert.equal(payload.prompt, 'An editorial product image');
  assert.equal(payload.aspect_ratio, '1:1');
  assert.equal(payload.output_format, 'png');
});

test('provider errors are honest and unavailable catalog is explicitly curated', async () => {
  const providers = new Providers(new Credentials({ OPENROUTER_API_KEY: 'test-key-not-real' }), async () => new Response('secret upstream body', { status: 402 }));
  await assert.rejects(providers.submit(generationSchema.parse({ provider: 'openrouter', kind: 'image', model: 'openai/gpt-image-1', prompt: 'test' }), new AbortController().signal), (error: unknown) => error instanceof HttpError && error.status === 402 && !error.message.includes('secret'));
  const catalog = await providers.models('openrouter', 'image');
  assert.equal(catalog.source, 'curated');
  assert.ok(catalog.warning);
  assert.throws(() => generationSchema.parse({ provider: 'higgsfield', kind: 'image', model: '../../settings', prompt: 'test' }));
});
