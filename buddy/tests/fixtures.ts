import type { Plan } from '../lib/plan';
export const call = { name: 'set_preferred_work_hours' as const, arguments: { start_time: '17:00', end_time: '23:00', strength: 'moderate' } };
// Minimal transport fixture only; real placement is covered against Python in browser tests.
export const plan: Plan = {
  courses: [{ _id: 'c1', name: 'Course', code: 'C1' }], tasks: [], sessions: [],
  preferences: [], windowStart: '2026-09-12T00:00:00', windowDays: 14,
  run: { status: 'solved', engine: 'CP-SAT', solverStatus: 'FEASIBLE', objective_value: 10, best_bound: 11, gap: 0.1, solve_seconds: 1 }, unplaced: [],
};
export const applied = { ...call, endpoint: '/tools/set_preferred_work_hours', method: 'POST', result: { action: 'created' } };
export const rebuilt = { plan: { ...plan, preferences: [call] }, preferences: [call], preference_calls: [applied] };
export const aiResponse = (calls: unknown[] = [call]) => ({ id: 'resp_test', object: 'response', status: 'completed', output: [
  { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', annotations: [], text: 'I will update your preferred study hours.' }] },
  ...calls.map((c: any, i) => ({ type: 'function_call', id: `fc_${i}`, call_id: `call_${i}`, name: c.name, arguments: JSON.stringify(c.arguments) })),
] });
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
