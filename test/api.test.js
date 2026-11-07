import assert from 'node:assert/strict';
import test from 'node:test';

import { call, getCollection, setCollection, StremioApiError } from '../src/api.js';

function respond(body, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('call posts JSON and unwraps result', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: { addons: [] } }) };
  };

  const result = await call('addonCollectionGet', { authKey: 'k' }, { fetchImpl });
  assert.deepEqual(result, { addons: [] });
  assert.equal(request.url, 'https://api.strem.io/api/addonCollectionGet');
  assert.equal(request.init.method, 'POST');
  assert.deepEqual(JSON.parse(request.init.body), { authKey: 'k' });
});

test('getCollection and setCollection use the documented method names', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url.split('/').pop());
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: {} }) };
  };

  await getCollection('k', { fetchImpl });
  await setCollection('k', [], { fetchImpl });
  assert.deepEqual(seen, ['addonCollectionGet', 'addonCollectionSet']);
});

test('API errors become readable StremioApiError instances', async () => {
  await assert.rejects(
    () => call('addonCollectionGet', {}, { fetchImpl: respond({ error: { message: 'invalid auth key' } }) }),
    (error) => {
      assert.ok(error instanceof StremioApiError);
      assert.match(error.message, /rejected the auth key/i);
      return true;
    },
  );
});

test('non-JSON responses are reported, not swallowed', async () => {
  await assert.rejects(
    () => call('addonCollectionGet', {}, { fetchImpl: respond('<html>oops</html>') }),
    /non-JSON body/,
  );
});

test('HTTP failures without an error object are reported', async () => {
  await assert.rejects(
    () => call('addonCollectionGet', {}, { fetchImpl: respond({ result: null }, { status: 500 }) }),
    /HTTP 500/,
  );
});
