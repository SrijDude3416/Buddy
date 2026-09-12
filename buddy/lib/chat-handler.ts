import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PlanSchema } from './plan';
import { applyPreferenceCalls, OptimizerError } from './fastapi';
import { interpretScheduleInput } from './chatgpt';

const RequestSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  input: z.string().trim().min(1).max(2000).optional(),
  plan: PlanSchema,
  context: z.object({ task_id: z.string().optional(), course_id: z.string().optional(), topic: z.string().optional() }).nullable().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(10).default([]),
}).refine(b => b.text || b.input, 'A non-empty text or input is required.');

type ChatBody = z.infer<typeof RequestSchema>;
type Update = { type: 'status'; stage: 'interpreting' | 'scheduling'; message: string } |
  { type: 'proposal'; message: string; operationCount: number };
const failure = { message: 'Buddy could not reach the AI service or validate its response. Your calendar is unchanged. Please retry.', code: 'ai_unavailable' };

async function runChat(body: ChatBody, signal: AbortSignal, update: (event: Update) => void = () => {}) {
  signal.throwIfAborted();
  update({ type: 'status', stage: 'interpreting', message: 'Got your feedback. OpenAI is translating it into scheduling preferences.' });
  const text = (body.text ?? body.input)!;
  const interpreted = await interpretScheduleInput(text, body.plan, body.context ?? undefined, body.history, signal);
  signal.throwIfAborted();
  update({ type: 'proposal', message: interpreted.message, operationCount: interpreted.preferenceCalls.length });
  let plan = body.plan;
  let preferenceCalls: Awaited<ReturnType<typeof applyPreferenceCalls>>['preference_calls'] = [];
  if (interpreted.preferenceCalls.length) {
    update({ type: 'status', stage: 'scheduling', message: `Applying ${interpreted.preferenceCalls.length} preference API calls and rebuilding your schedule in CP-SAT…` });
    const result = await applyPreferenceCalls(body.plan.preferences, interpreted.preferenceCalls, body.plan.courses.map(c => c._id), signal);
    signal.throwIfAborted();
    plan = result.plan;
    preferenceCalls = result.preference_calls;
  }
  const rebuilt = preferenceCalls.length > 0;
  const message = rebuilt ? `Your schedule has been rebuilt by the optimizer. ${interpreted.message}` : interpreted.message;
  return {
    message, plan, preferences: plan.preferences, preference_calls: preferenceCalls, mode: 'openai',
    scheduler: 'CP-SAT',
    messages: [
      { _id: crypto.randomUUID(), role: 'user', text },
      { _id: crypto.randomUUID(), role: 'assistant', text: message, preference_calls: preferenceCalls, mode: 'openai' },
    ],
    plan_changed: rebuilt,
  };
}

function errorPayload(error: unknown) {
  return error instanceof OptimizerError ? { message: error.message, code: 'optimizer_failed' } : failure;
}

export async function handleChat(request: Request) {
  let body: ChatBody;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ message: 'Send a message (1–2000 characters) and a valid current calendar.', code: 'invalid_request' }, { status: 400 });
  }
  // Existing clients keep the original JSON contract. The interactive UI opts in
  // to newline-delimited events so acknowledgement reaches it before the model.
  if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
    try { return NextResponse.json(await runChat(body, request.signal)); }
    catch (e) { return NextResponse.json(errorPayload(e), { status: 503 }); }
  }
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        if (!closed && !abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      try {
        const result = await runChat(body, abort.signal, emit);
        emit({ type: 'result', ...result });
      } catch (e) {
        emit({ type: 'error', ...errorPayload(e) });
      } finally {
        request.signal.removeEventListener('abort', onAbort);
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; abort.abort(); request.signal.removeEventListener('abort', onAbort); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
