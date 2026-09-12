import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat } from '../lib/chat-handler';
import { plan, call, rebuilt, aiResponse, json } from './fixtures';

const request = (current = plan) => new Request('http://localhost/api/chat/messages', { method: 'POST', body: JSON.stringify({ text: 'Study later', plan: current }) });
async function mocked(run: () => Promise<void>, fetcher: typeof fetch) {
  const key = process.env.OPENAI_API_KEY, original = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-placeholder'; globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
}
test('OpenAI calls existing preference tools, Python receives saved state, and only its plan is returned', async () => {
  let requests = 0;
  await mocked(async () => {
    const response = await handleChat(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.plan, rebuilt.plan);
    assert.deepEqual(result.preference_calls, rebuilt.preference_calls);
    assert.equal(result.scheduler, 'CP-SAT'); assert.equal(requests, 2);
  }, async (input, init) => {
    requests++;
    const body = JSON.parse(init!.body as string);
    if (String(input).endsWith('/responses')) {
      assert.deepEqual(body.tools.map((t: any) => t.name), ['set_preferred_work_hours', 'set_daily_workload_limit', 'protect_time_block', 'set_break_habits', 'set_task_spacing', 'set_urgency_emphasis', 'set_minimum_gap', 'remove_preference', 'list_current_preferences']);
      assert.ok(!JSON.stringify(body.tools).includes('MOVE_EVENT'));
      return json(aiResponse());
    }
    assert.ok(String(input).endsWith('/preferences/operations'));
    // `courses` echoes the plan's own courses back so a course the caller supplied
    // (a student's picked lecture section) survives this second solve.
    assert.deepEqual(body, { preferences: [], operations: [call], course_ids: ['c1'],
      courses: [{ id: 'c1', name: 'Course', meeting_times: [] }] });
    return json(rebuilt);
  });
});
test('ambiguous feedback with no calls keeps the calendar and does not invoke the optimizer', async () => {
  let requests = 0;
  await mocked(async () => {
    const result = await (await handleChat(request())).json();
    assert.equal(result.plan_changed, false); assert.deepEqual(result.plan, plan); assert.equal(requests, 1);
  }, async () => { requests++; return json(aiResponse([])); });
});
test('optimizer failures do not return partial preferences or a replacement calendar', async () => {
  await mocked(async () => {
    const response = await handleChat(request());
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'optimizer_failed'); assert.equal(result.plan, undefined);
  }, async input => String(input).endsWith('/responses') ? json(aiResponse()) : json({ detail: { message: 'No usable schedule' } }, 409));
});
test('missing key and invalid AI tool names fail without a rules fallback', async () => {
  await mocked(async () => {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await handleChat(request())).status, 503);
    process.env.OPENAI_API_KEY = 'test-placeholder';
    assert.equal((await handleChat(request())).status, 503);
  }, async () => json(aiResponse([{ name: 'MOVE_EVENT', arguments: {} }])));
});
