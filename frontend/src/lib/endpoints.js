// ---------------------------------------------------------------------------
// The API contract, in one table.
//
// This file is the handshake between frontend and backend. Every request the app
// can make is named here with its method and path. Nothing else in the app
// hardcodes a URL. When the backend comes up, these are the routes it has to
// serve — and the mock handlers in src/lib/mock/handlers.js are keyed by the
// same names, so the two implementations can never drift apart silently.
//
// `path` is a function of params so path segments stay type-checked-by-shape
// instead of being string-concatenated at the call site.
// ---------------------------------------------------------------------------

export const endpoints = {
  // --- course catalog ------------------------------------------------------
  // GET -> { courses: [{ _id, code, name, section, department, units, meeting_times }] }
  // The shared catalog the Canvas pipeline populates. Onboarding's class picker
  // reads this instead of a hardcoded list, so a selection carries the real
  // course id and meeting_times into the plan.
  listCourseCatalog: { method: 'GET', path: () => '/courses' },

  // --- onboarding / preferences -------------------------------------------
  // POST body: { entries: [{ type, value, weight, source }] }
  // The LLM/onboarding never sends prose — only typed preference objects from
  // the catalog in src/lib/preferenceCatalog.js.
  createPreferences: { method: 'POST', path: () => '/preferences' },
  listPreferences: { method: 'GET', path: () => '/preferences' },

  // --- the optimizer run (drives the loading screen) -----------------------
  // POST body: { horizon_days } -> { run_id, status, stage, progress }
  startOptimizerRun: { method: 'POST', path: () => '/optimizer/runs' },
  // GET -> { run_id, status, stage, progress, objective_value, best_bound, gap }
  getOptimizerRun: { method: 'GET', path: ({ runId }) => `/optimizer/runs/${runId}` },
  cancelOptimizerRun: { method: 'POST', path: ({ runId }) => `/optimizer/runs/${runId}/cancel` },

  // --- the plan (courses + tasks + sessions, schema-shaped) ----------------
  // GET -> { courses, tasks, sessions, run }
  getPlan: { method: 'GET', path: () => '/plan' },

  // --- session-level actions ----------------------------------------------
  patchSession: { method: 'PATCH', path: ({ sessionId }) => `/sessions/${sessionId}` },
  // Thumbs-down on one session: append a preference entry and re-place just it.
  nudgeSession: { method: 'POST', path: ({ sessionId }) => `/sessions/${sessionId}/nudge` },

  // --- classes page --------------------------------------------------------
  getCourseBreakdown: { method: 'GET', path: ({ courseId }) => `/courses/${courseId}/breakdown` },

  // --- chat ----------------------------------------------------------------
  listChatMessages: { method: 'GET', path: () => '/chat/messages' },
  // POST body: { text, context } -> { messages: [...], plan_changed: bool, run_id? }
  sendChatMessage: { method: 'POST', path: () => '/chat/messages' },
};

export function resolveEndpoint(name, params = {}) {
  const endpoint = endpoints[name];
  if (!endpoint) {
    throw new Error(`Unknown endpoint "${name}" — add it to src/lib/endpoints.js`);
  }
  return { name, method: endpoint.method, path: endpoint.path(params) };
}
