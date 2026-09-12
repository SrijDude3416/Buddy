import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat } from '../lib/chat-handler';
import { plan, rebuilt, aiResponse, json } from './fixtures';
import { readChatStream } from '../../frontend/src/lib/chatStream.js';

const request = () => new Request('http://localhost/api/chat/messages', {
  method: 'POST', headers: { Cookie: 'buddy_demo=1', Accept: 'application/x-ndjson' },
  body: JSON.stringify({ text: 'Study later', plan: plan }),
});
const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

test('acknowledgement arrives before a delayed OpenAI response; stages precede the final plan', async () => {
  const oldKey = process.env.OPENAI_API_KEY, oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  let release!: (response: Response) => void;
  globalThis.fetch = input => String(input).endsWith('/responses') ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(json(rebuilt));
  try {
    const response = await handleChat(request());
    assert.ok(response.headers.get('content-type')?.includes('application/x-ndjson'));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.equal(JSON.parse(first.trim()).stage, 'interpreting');
    assert.ok(!first.includes('"plan":'), 'No calendar should be emitted before validation');
    // The first frame was readable while the provider promise was unresolved.
    await new Promise(resolve => setImmediate(resolve));
    release(json(aiResponse()));
    let rest = '';
    while (true) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    const events = rest.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(e => e.type), ['proposal', 'status', 'result']);
    assert.equal(events[1].stage, 'scheduling');
    assert.equal(events[2].preference_calls.length, 1);
  } finally { globalThis.fetch = oldFetch; restore('OPENAI_API_KEY', oldKey); }
});

test('cancelling the response stream aborts the provider request', async () => {
  const oldKey = process.env.OPENAI_API_KEY, oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  let aborted = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    started();
  });
  try {
    const response = await handleChat(request());
    await ready;
    await response.body!.cancel();
    assert.equal(aborted, true);
  } finally { globalThis.fetch = oldFetch; restore('OPENAI_API_KEY', oldKey); }
});

function responseWithChunks(text: string, bytesPerChunk = 3) {
  const data = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < data.length; i += bytesPerChunk) controller.enqueue(data.slice(i, i + bytesPerChunk));
    controller.close();
  } }));
}
test('client parser handles split UTF-8 and JSON frames without applying proposals', async () => {
  const events = [
    { type: 'status', stage: 'interpreting', message: 'I’m listening.' },
    { type: 'proposal', message: 'Check quiz prep', operationCount: 1 },
    { type: 'result', messages: [], preference_calls: [], plan: plan },
  ];
  const updates: unknown[] = [];
  const result = await readChatStream(responseWithChunks(events.map(e => JSON.stringify(e)).join('\n')), (e: unknown) => updates.push(e));
  assert.equal(result.type, 'result'); assert.deepEqual(updates, events.slice(0, 2));
});
test('truncated streams and streamed errors reject without a final plan', async () => {
  await assert.rejects(readChatStream(responseWithChunks('{"type":"status","stage":"interpreting"}\n'), () => {}), /connection ended/);
  await assert.rejects(readChatStream(responseWithChunks('{"type":"error","message":"Provider unavailable","code":"ai_unavailable"}\n'), () => {}), /Provider unavailable/);
});
