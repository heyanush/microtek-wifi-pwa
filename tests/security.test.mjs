import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { session, sameOrigin, json } from '../lib/cloud-server.ts';
test('session cookie parsing is isolated and malformed encodings are rejected', () => {
  assert.equal(
    session(
      new Request('https://pwa.test', {
        headers: { cookie: 'other=abc; microtek_session=token%2Bvalue' },
      }),
    ),
    'token+value',
  );
  assert.equal(
    session(
      new Request('https://pwa.test', {
        headers: { cookie: 'microtek_session=%zz' },
      }),
    ),
    '',
  );
  assert.equal(session(new Request('https://pwa.test')), '');
});
test('mutations require the exact origin', () => {
  assert.equal(
    sameOrigin(
      new Request('https://pwa.test/api/session', {
        headers: { origin: 'https://pwa.test' },
      }),
    ),
    true,
  );
  for (const origin of ['https://evil.test', 'null', 'http://pwa.test'])
    assert.equal(
      sameOrigin(
        new Request('https://pwa.test/api/session', { headers: { origin } }),
      ),
      false,
    );
  assert.equal(sameOrigin(new Request('https://pwa.test')), false);
});
test('API responses are never cacheable', () =>
  assert.equal(json({ ok: true }).headers.get('cache-control'), 'no-store'));
test('service worker never intercepts API, mutation, cross-origin or RSC requests', async () => {
  const handlers = {};
  vm.runInNewContext(
    await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    {
      URL,
      self: {
        location: { origin: 'https://pwa.test' },
        addEventListener: (name, handler) => (handlers[name] = handler),
      },
    },
  );
  for (const request of [
    new Request('https://pwa.test/api/session'),
    new Request('https://pwa.test/api/mqtt'),
    new Request('https://pwa.test/api/cloud?path=things'),
    new Request('https://pwa.test/', { method: 'POST', body: 'x' }),
    new Request('http://127.0.0.1:8788/state'),
    new Request('https://pwa.test/', { headers: { RSC: '1' } }),
  ]) {
    let intercepted = false;
    handlers.fetch({ request, respondWith: () => (intercepted = true) });
    assert.equal(intercepted, false);
  }
});

test('offline snapshots strip device credentials even if embedded in state', async () => {
  const { safeSnapshot, normalizeThing } = await import('../lib/protocol.ts');
  const safe = safeSnapshot(
    normalizeThing({
      id: 'test',
      user_config: { uat: 'secret' },
      stack: { wifi: { password: 'secret' } },
      state: {
        involt: 230,
        uat: 'secret',
        password: 'secret',
        broker: 'private',
      },
    }),
  );
  assert.deepEqual(safe.state, { involt: 230 });
  assert.deepEqual(safe.userConfig, {});
  assert.deepEqual(safe.stack, {});
  assert.equal(safe.connected, false);
});

test('cloud adapter uses Worker-compatible manual redirects and refuses redirection', async () => {
  const { upstream } = await import('../lib/cloud-server.ts');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.body, undefined);
      return new Response('{}', {
        status: 302,
        headers: { Location: 'https://untrusted.example' },
      });
    };
    await assert.rejects(
      () => upstream('user', 'test-token'),
      /Unexpected redirect/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
