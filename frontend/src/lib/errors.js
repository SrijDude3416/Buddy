// Normalized error surface. Mock and live modes throw the same shape so no
// component ever has to care which one it is talking to.

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'unknown', endpoint, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
    this.body = body;
  }

  /** Worth showing a retry button for. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export class AbortedError extends Error {
  constructor(endpoint) {
    super('Request aborted');
    this.name = 'AbortedError';
    this.endpoint = endpoint;
    this.aborted = true;
  }
}

export function isAborted(err) {
  return Boolean(err && (err.aborted || err.name === 'AbortError' || err.name === 'AbortedError'));
}
