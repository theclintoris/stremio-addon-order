/**
 * Minimal client for Stremio's account API.
 *
 * The add-on collection lives in the user's Stremio account as an ordered
 * array, which is exactly what the client renders. Reordering that array is
 * therefore the supported way to reorder add-ons everywhere.
 */

export const API_BASE = 'https://api.strem.io/api/';

export class StremioApiError extends Error {
  constructor(method, message, status) {
    super(message);
    this.name = 'StremioApiError';
    this.method = method;
    this.status = status;
  }
}

function explain(method, message) {
  if (/auth|session|token|login/i.test(message)) {
    return (
      `${method}: Stremio rejected the auth key (${message}). ` +
      'Log in to Stremio again, or pass a fresh --key.'
    );
  }
  return `${method}: ${message}`;
}

/**
 * POST a JSON-RPC-ish call to the Stremio API and return `result`.
 *
 * @param {string} method e.g. "addonCollectionGet"
 * @param {object} params request body
 * @param {{ fetchImpl?: Function, baseUrl?: string, timeoutMs?: number }} [options]
 */
export async function call(method, params, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    baseUrl = API_BASE,
    timeoutMs = 20_000,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new StremioApiError(method, 'This tool needs Node.js 18 or newer (global fetch is missing).');
  }

  const response = await fetchImpl(baseUrl + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new StremioApiError(
      method,
      `${method}: expected JSON, got HTTP ${response.status} and a non-JSON body.`,
      response.status,
    );
  }

  if (payload && payload.error) {
    throw new StremioApiError(method, explain(method, payload.error.message || JSON.stringify(payload.error)), response.status);
  }
  if (!response.ok) {
    throw new StremioApiError(method, `${method}: HTTP ${response.status}`, response.status);
  }
  return payload.result;
}

export function getCollection(authKey, options) {
  return call('addonCollectionGet', { authKey }, options);
}

export function setCollection(authKey, addons, options) {
  return call('addonCollectionSet', { authKey, addons }, options);
}
