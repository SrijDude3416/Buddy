// ---------------------------------------------------------------------------
// Service layer. Components call these, never request() or fetch() directly.
// Each function is named for the intent, takes plain arguments, and returns the
// server's response body unchanged — the adapter layer decides what the UI sees.
// ---------------------------------------------------------------------------

import { request } from '../apiClient.js';

export const preferencesApi = {
  create: (entries, { replaceSource, signal } = {}) =>
    request('createPreferences', { body: { entries, replace_source: replaceSource }, signal }),
  list: ({ signal } = {}) => request('listPreferences', { signal }),
};

export const optimizerApi = {
  start: ({ runContext, horizonDays = 7, reset = false, signal } = {}) =>
    request('startOptimizerRun', {
      body: { run_context: runContext, horizon_days: horizonDays, reset },
      signal,
    }),
  get: (runId, { signal } = {}) => request('getOptimizerRun', { params: { runId }, signal }),
  cancel: (runId, { signal } = {}) => request('cancelOptimizerRun', { params: { runId }, signal }),
};

export const planApi = {
  get: ({ signal } = {}) => request('getPlan', { signal }),
};

export const sessionsApi = {
  patch: (sessionId, changes, { signal } = {}) =>
    request('patchSession', { params: { sessionId }, body: changes, signal }),
  nudge: (sessionId, { signal } = {}) =>
    request('nudgeSession', { params: { sessionId }, signal }),
};

export const coursesApi = {
  catalog: ({ signal } = {}) => request('listCourseCatalog', { signal }),
  breakdown: (courseId, { signal } = {}) =>
    request('getCourseBreakdown', { params: { courseId }, signal }),
};

export const chatApi = {
  list: ({ signal } = {}) => request('listChatMessages', { signal }),
  send: (text, context = null, { signal } = {}) =>
    request('sendChatMessage', { body: { text, context }, signal }),
};
