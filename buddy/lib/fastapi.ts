import { dataAccess } from './auth/data-access';
import { z } from 'zod';
import { PlanSchema } from './plan';
import { SavedPreferencesSchema, type PreferenceCall } from './preference-contract';
import type { OptimizerRun } from './types';

export class OptimizerError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
const BatchResult = z.object({
  plan: PlanSchema, preferences: SavedPreferencesSchema,
  preference_calls: z.array(z.object({ name: z.string(), arguments: z.record(z.unknown()), endpoint: z.string(), method: z.string(), result: z.unknown() })),
});
export async function optimizerApi(path: string, init?: RequestInit) {
  const access = await dataAccess();
  if (!access.demo && path.startsWith('/api/optimizer/')) throw new OptimizerError('Use the account calendar to recalculate your schedule.', 409);
  const base = (process.env.FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}${path}`, { ...init, cache: 'no-store', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000), headers: { 'Content-Type': 'application/json', ...init?.headers, ...access.headers } });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new OptimizerError('Could not reach the schedule optimizer. Your preferences and calendar are unchanged.');
  }
  const body = await response.json();
  if (!response.ok) {
    const detail = body.detail;
    throw new OptimizerError(typeof detail === 'string' ? detail : detail?.message ?? 'The preference update or optimizer solve failed. Your calendar is unchanged.', response.status);
  }
  return body;
}
export const getDefaultPreferences = async (signal?: AbortSignal) => BatchResult.parse(await optimizerApi('/preferences/defaults', { signal }));
/** A course supplied by the caller, with the meeting times of the student's own section. */
export type CourseOverride = { id: string; name: string; meeting_times: { days: string[]; start_time: string; end_time: string; location: string | null }[] };
export const applyPreferenceCalls = async (preferences: PreferenceCall[], operations: PreferenceCall[], course_ids: string[], signal?: AbortSignal, courses?: CourseOverride[]) => BatchResult.parse(await optimizerApi('/preferences/operations', {
  // `courses` is omitted rather than sent empty: the endpoint forbids unknown
  // fields loosely but treats null and [] the same, and omitting keeps the
  // request identical to what it was before sections existed.
  method: 'POST', body: JSON.stringify({ preferences, operations, course_ids, ...(courses?.length ? { courses } : {}) }), signal,
}));

// Compatibility for the original optional run-polling routes.
type BridgeRun = { run_id: string; status: string; stage?: string; progress?: number };
function normalize(run: BridgeRun): OptimizerRun {
  return { id: run.run_id, status: run.status === 'solved' ? 'completed' : ['infeasible', 'cancelled'].includes(run.status) ? 'failed' : run.status, stage: run.stage, progress: run.progress };
}
export const createOptimizerRun = async () => normalize(await optimizerApi('/api/optimizer/runs', { method: 'POST' }));
export const getOptimizerRun = async (id: string) => normalize(await optimizerApi(`/api/optimizer/runs/${encodeURIComponent(id)}`));
