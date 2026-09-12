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

import { readChatStream } from './chatStream.js';
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
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); } };
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

async function requestLive({ method, path }, { body, signal, onProgress }) {
  const url = `${config.apiBaseUrl}${path}`;
  const { signal: timedSignal, cleanup } = withTimeout(signal, config.apiTimeoutMs);
  try {
    const res = await fetch(url, {
      method, signal: timedSignal, credentials: 'include',
      headers: {
        Accept: onProgress ? 'application/x-ndjson' : 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok && res.headers.get('content-type')?.includes('application/x-ndjson')) {
      return await readChatStream(res, onProgress);
    }
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) throw new ApiError(parsed?.message || `${method} ${path} failed (${res.status})`, {
      status: res.status, code: parsed?.code || 'http_error', endpoint: path, body: parsed,
    });
    return parsed;
  } catch (err) {
    if (signal?.aborted) throw new AbortedError(path);
    if (timedSignal.aborted) throw new ApiError('Buddy took too long to respond. Your calendar is unchanged. Please retry.', { code: 'timeout', endpoint: path });
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Network request failed', { code: 'network', endpoint: path });
  } finally {
    cleanup(); // Includes reading the stream, not only receiving the headers.
  }
}

/**
 * @param {string} name   key in src/lib/endpoints.js
 * @param {object} [opts]
 * @param {object} [opts.params] path params
 * @param {object} [opts.body]   JSON body
 * @param {AbortSignal} [opts.signal]
 */
export async function request(name, { params = {}, body, signal, onProgress } = {}) {
  const endpoint = resolveEndpoint(name, params);
  return isMock()
    ? requestMock(endpoint, { params, body, signal })
    : requestLive(endpoint, { body, signal, onProgress });
}

export { ApiError, AbortedError, isAborted };
