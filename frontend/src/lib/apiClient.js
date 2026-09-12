// ---------------------------------------------------------------------------
// The gate.
//
// Every network call in the app goes through request(). In mock mode it is
// routed to a handler in src/lib/mock/handlers.js with simulated latency; in
// live mode it is a real fetch. Both paths return parsed JSON and throw
// ApiError, so no caller can tell the difference.
//
// To move the whole app onto a real backend: set VITE_API_MODE=live and
// VITE_API_BASE_URL. No component, hook or service file changes.
// ---------------------------------------------------------------------------

import { config, isMock } from './config.js';
import { resolveEndpoint } from './endpoints.js';
import { ApiError, AbortedError, isAborted } from './errors.js';
import { mockHandlers } from './mock/handlers.js';

/** Auth header hook. Swap the body for a real token read when auth exists. */
function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let authToken = null;
export function setAuthToken(token) {
  authToken = token;
}
export function getAuthToken() {
  return authToken;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new AbortedError());
      },
      { once: true },
    );
  });
}

/** Combine a caller's signal with a timeout so live requests can't hang forever. */
function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function requestMock({ name, method, path }, { params, body, signal }) {
  const handler = mockHandlers[name];
  if (!handler) {
    throw new ApiError(`No mock handler for "${name}"`, { code: 'mock_missing', endpoint: path });
  }

  // Simulated round trip, jittered so concurrent requests don't resolve in lockstep.
  const jitter = config.mockLatencyMs * (0.6 + Math.random() * 0.8);
  await sleep(jitter, signal);

  if (config.mockErrorRate > 0 && Math.random() < config.mockErrorRate) {
    throw new ApiError('Injected mock failure', {
      status: 503,
      code: 'mock_injected',
      endpoint: path,
    });
  }

  if (import.meta.env?.DEV) {
    console.debug(`[api:mock] ${method} ${path}`, body ?? params ?? '');
  }
  return handler({ params, body, signal });
}

async function requestLive({ name, method, path }, { body, signal }) {
  const url = `${config.apiBaseUrl}${path}`;
  const { signal: timedSignal, cleanup } = withTimeout(signal, config.apiTimeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      signal: timedSignal,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    cleanup();
    if (isAborted(err)) throw new AbortedError(path);
    // Network-level failure: no status, retryable.
    throw new ApiError(err.message || 'Network request failed', {
      status: 0,
      code: 'network',
      endpoint: path,
    });
  }
  cleanup();

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(parsed?.message || `${method} ${path} failed (${res.status})`, {
      status: res.status,
      code: parsed?.code || 'http_error',
      endpoint: path,
      body: parsed,
    });
  }

  return parsed;
}

/**
 * @param {string} name   key in src/lib/endpoints.js
 * @param {object} [opts]
 * @param {object} [opts.params] path params
 * @param {object} [opts.body]   JSON body
 * @param {AbortSignal} [opts.signal]
 */
export async function request(name, { params = {}, body, signal } = {}) {
  const endpoint = resolveEndpoint(name, params);
  return isMock()
    ? requestMock(endpoint, { params, body, signal })
    : requestLive(endpoint, { body, signal });
}

export { ApiError, AbortedError, isAborted };
