import assert from 'node:assert/strict';
import test from 'node:test';
import { Providers } from './providers.js';
import { HttpError } from './errors.js';

const authorization = 'Key private-dashboard-credential-123456789';
function provider(body: unknown, status = 400) {
  let calls = 0;
  return {
    api: new Providers({ header: () => authorization }, async () => {
      calls++;
      return body instanceof Response ? body : Response.json(body, { status });
    }),
    calls: () => calls,
  };
}

test('Higgsfield concurrency rejection has an actionable message and never automatically resubmits', async () => {
  const mock = provider({ detail: 'Maximum concurrent requests reached' });
  await assert.rejects(mock.api.json('higgsfield', '/example/generate', 'POST', {}), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    assert.match(error.message, /Higgsfield.*limite de gerações simultâneas/);
    assert.doesNotMatch(error.message, /parâmetros/);
    return true;
  });
  assert.equal(mock.calls(), 1);
});

test('provider parameter reason reaches the caller without credentials, signed URLs or validation input', async () => {
  const mock = provider({ detail: [{
    loc: ['body', 'resolution'],
    msg: `Expected 1k; token=another-private-token; ${authorization}; https://files.example/image?signature=private`,
    input: 'private prompt and image bytes', ctx: { secret: 'private context' },
  }] }, 422);
  await assert.rejects(mock.api.json('higgsfield', '/example/generate', 'POST', {}), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    assert.match(error.message, /Qualidade: Expected 1k/);
    assert.doesNotMatch(error.message, /private|signature|files\.example/);
    return true;
  });
});

test('OpenRouter error.message is shown without raw upstream metadata', async () => {
  const mock = provider({ error: { message: 'Resolution must be 1K or 2K', metadata: { raw: 'private key' } } });
  await assert.rejects(mock.api.json('openrouter', '/images', 'POST', {}), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.match(error.message, /OpenRouter.*Resolution must be 1K or 2K/);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test('provider-specific credit and permission errors are distinguished', async () => {
  for (const [name, expected] of [['higgsfield', /Saldo insuficiente/], ['openrouter', /permissão/]] as const) {
    const mock = provider({ detail: 'upstream secret' }, 403);
    await assert.rejects(mock.api.json(name, '/example'), (error: unknown) => error instanceof HttpError && expected.test(error.message) && !error.message.includes('secret'));
  }
});

test('oversized, non-JSON and absent error bodies preserve HTTP status without leaking raw text', async () => {
  for (const response of [new Response('private upstream HTML', { status: 400 }), Response.json({ detail: 'private'.repeat(5000) }, { status: 400 }), new Response(null, { status: 400 })]) {
    const mock = provider(response);
    await assert.rejects(mock.api.json('higgsfield', '/example'), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message.includes('não informou o motivo') && !error.message.includes('private'));
  }
});
