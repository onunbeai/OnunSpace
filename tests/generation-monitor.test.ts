import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { boundedGenerationCall, monitorGeneration, resultSyncError, trackingError, type MonitoredJob } from '../src/lib/generationMonitor';
const running: MonitoredJob = { id: 'same-paid-job', status: 'running' };
const base = () => ({ signal: new AbortController().signal, intervalMs: 1, requestTimeoutMs: 30 });

test('tracks queued to completed and synchronizes the result once', async () => {
  let polls = 0, syncs = 0;
  const result = await monitorGeneration({ ...running, status: 'queued' }, { ...base(), load: async id => { assert.equal(id, running.id); return { ...running, status: ++polls === 2 ? 'complete' : 'running' }; }, sync: async () => { syncs++; } });
  assert.equal(result.status, 'complete'); assert.equal(polls, 2); assert.equal(syncs, 1);
});
test('missing or forbidden jobs stop immediately instead of spinning forever', async () => {
  for (const status of [400, 401, 403, 404]) {
    let polls = 0;
    await assert.rejects(monitorGeneration(running, { ...base(), load: async () => { polls++; throw Object.assign(new Error('missing'), { status }); }, sync: async () => {} }), { message: trackingError });
    assert.equal(polls, 1);
  }
});
test('temporary failures recover, repeated failures stop after a bounded number', async () => {
  let polls = 0;
  await monitorGeneration(running, { ...base(), load: async () => { if (++polls < 3) throw new Error('offline'); return { ...running, status: 'complete' }; }, sync: async () => {} });
  assert.equal(polls, 3);
  polls = 0;
  await assert.rejects(monitorGeneration(running, { ...base(), load: async () => { polls++; throw new Error('offline'); }, sync: async () => {} }), { message: trackingError });
  assert.equal(polls, 4);
});
test('a completed job retries only project synchronization, never re-submits or polls', async () => {
  let syncs = 0;
  await monitorGeneration({ ...running, status: 'complete' }, { ...base(), load: async () => { throw new Error('must not poll completed job'); }, sync: async () => { if (++syncs < 3) throw new Error('offline'); } });
  assert.equal(syncs, 3);
  await assert.rejects(monitorGeneration({ ...running, status: 'complete' }, { ...base(), load: async () => running, sync: async () => { throw new Error('offline'); } }), { message: resultSyncError });
});
test('provider terminal failures expose the provider message', async () => {
  await assert.rejects(monitorGeneration({ ...running, status: 'error', error: 'Insufficient credits' }, { ...base(), load: async () => running, sync: async () => {} }), { message: 'Insufficient credits' });
});
test('a hung request times out and aborts its fetch signal', async () => {
  let child: AbortSignal | undefined;
  await assert.rejects(boundedGenerationCall(signal => { child = signal; return new Promise(() => {}); }, new AbortController().signal, 5), { message: trackingError });
  assert.equal(child?.aborted, true);
});
test('closing or switching project aborts polling immediately', async () => {
  const controller = new AbortController();
  const promise = monitorGeneration(running, { ...base(), signal: controller.signal, load: async () => { controller.abort(); return running; }, sync: async () => { throw new Error('must not sync after abort'); } });
  await assert.rejects(promise, { name: 'AbortError' });
});
test('completed media is not announced until its output card has been materialized', async () => {
  let reads = 0, syncs = 0;
  await monitorGeneration<MonitoredJob>({ ...running, status: 'complete', materialized: false }, { ...base(), load: async () => { reads++; return { ...running, status: 'complete', materialized: reads > 1 }; }, sync: async () => { syncs++; } });
  assert.equal(reads, 2); assert.equal(syncs, 1);
  await assert.rejects(monitorGeneration<MonitoredJob>({ ...running, status: 'complete', materialized: false }, { ...base(), load: async () => ({ ...running, status: 'complete', materialized: false }), sync: async () => { throw new Error('Must not announce stale project'); } }), { message: resultSyncError });
});
