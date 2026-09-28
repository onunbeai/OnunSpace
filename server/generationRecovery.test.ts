import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { defaultScene } from '../shared/motion.js';
import { HttpError } from './errors.js';
import { JobJournal } from './jobJournal.js';
import { GenerationJobs, type GenerationJob } from './jobs.js';
import { generationSchema, type GenerationRequest, type Providers } from './providers.js';
import { ProjectStore } from './store.js';

async function fixture(status = 'completed') {
  const directory = await mkdtemp(join(tmpdir(), 'onun-generation-recovery-'));
  const store = new ProjectStore(join(directory, 'projects'));
  const source = { id: 'video', kind: 'video' as const, title: 'Video', x: 0, y: 0, width: 350, prompt: 'A quiet landscape', model: 'bytedance/seedance-2.5/image-to-video', provider: 'higgsfield' as const, aspectRatio: '16:9', resolution: '720p', duration: 10, generateAudio: false, count: 1, status: 'none' as const };
  await store.save({ id: 'project', name: 'Test', edges: [], motion: defaultScene, nodes: [source] });
  let submissions = 0;
  const providers = {
    assertConfigured() {},
    async submit(request: GenerationRequest) {
      submissions++;
      assert.equal(request.generateAudio, false);
      return { request_id: 'accepted-video', status: 'queued' };
    },
    async poll() { return { status, video: { url: 'https://example.com/video.mp4' } }; },
  } as unknown as Providers;
  const request = generationSchema.parse({ ...source, projectId: 'project', nodeId: source.id, requestId: randomUUID() });
  const journal = new JobJournal(join(directory, 'jobs'));
  return { directory, store, source, providers, request, journal, submissions: () => submissions };
}

async function terminal(jobs: GenerationJobs, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await jobs.get(id);
    if (['complete', 'error'].includes(result.status)) return result;
    await setTimeout(5);
  }
  throw new Error('Job did not finish');
}

test('moderation is explicit, persists in the project and never resubmits', async () => {
  const f = await fixture('nsfw');
  const jobs = new GenerationJobs(f.providers, f.store, join(f.directory, 'assets'), { pollIntervalMs: 5 });
  try {
    const created = await jobs.create(f.request);
    const result = await terminal(jobs, created.id);
    assert.equal(result.status, 'error');
    assert.match(result.error!, /moderação de conteúdo/);
    assert.equal((await f.store.get('project')).nodes[0].error, result.error);
    assert.equal(f.submissions(), 1);
    assert.deepEqual(result.outputs, []);
  } finally { await jobs.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test('a stale error card resumes the accepted remote job and preserves muted audio', async () => {
  const f = await fixture();
  const id = randomUUID();
  const saved: GenerationJob = { id, kind: 'video', provider: 'higgsfield', createdAt: new Date().toISOString(), status: 'running', remoteId: 'accepted-video', outputs: [], request: { ...f.request, requestId: id }, controller: new AbortController(), lastPoll: 0 };
  await f.journal.save(saved);
  await f.store.mutate('project', p => ({ ...p, nodes: p.nodes.map(n => ({ ...n, generationStatus: 'error' as const, error: 'Temporary tracking failure' })) }));
  const jobs = new GenerationJobs(f.providers, f.store, join(f.directory, 'assets'), { pollIntervalMs: 100 });
  try {
    const resumed = await jobs.create(f.request);
    assert.equal(resumed.id, id);
    const result = await terminal(jobs, id);
    assert.equal(result.status, 'complete');
    assert.equal(f.submissions(), 0);
    assert.equal((await f.journal.load())[0].request.generateAudio, false);
    assert.equal((await f.store.get('project')).nodes[0].generateAudio, false);
  } finally { await jobs.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test('temporary failure after acceptance and simultaneous retries do not repeat submission', async () => {
  const f = await fixture();
  const mutate = f.store.mutate.bind(f.store);
  let updates = 0;
  f.store.mutate = async (...args: Parameters<ProjectStore['mutate']>) => {
    if (++updates === 2) throw new HttpError(503, 'Temporary failure after acceptance', 'provider_error');
    return mutate(...args);
  };
  const jobs = new GenerationJobs(f.providers, f.store, join(f.directory, 'assets'), { pollIntervalMs: 5 });
  try {
    const [first, second] = await Promise.all([jobs.create(f.request), jobs.create(f.request)]);
    assert.equal(first.id, second.id);
    const result = await terminal(jobs, first.id);
    assert.equal(result.status, 'complete');
    assert.equal(f.submissions(), 1);
    assert.ok(updates > 2);
    assert.equal((await f.store.get('project')).nodes.filter(n => n.generatedFrom === f.source.id).length, 1);
  } finally { await jobs.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});
