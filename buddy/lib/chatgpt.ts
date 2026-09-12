import OpenAI from 'openai';
import { PreferenceCallsSchema, preferenceTools } from './preference-contract';
import type { Plan } from './plan';

/** The only chat interpreter. OpenAI selects existing preference API calls;
 * it is never offered event IDs, event mutation tools, or solver weights. */
export async function interpretScheduleInput(input: string, plan: Plan, context?: { task_id?: string }, history: { role: 'user' | 'assistant'; text: string }[] = [], signal?: AbortSignal) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not configured.');
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }).responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
    instructions: `You are Buddy, a student scheduling assistant. Translate scheduling feedback into calls to the provided preference API tools. The Python CP-SAT optimizer decides every event's placement after those preferences are applied. Never choose event times or edit calendar events. Use only the six provided tools and their documented arguments. Use bounded strength values, never raw solver weights. Include a short conversational explanation of the intended preference change; do not claim it is already applied. The current preferences below are authoritative; history is conversational context and can include updates later undone. For ambiguous requests ask a question and make no tool calls. If a request cannot be expressed by the tools (such as per-task quiz/homework priorities or exact study block lengths), explain the limitation and make no calls; do not substitute an unrelated preference. For list_current_preferences, summarize the supplied current preferences. Hard protected blocks affect flexible work, never move lectures. Keep responses brief and use at most 6 calls.`,
    input: [
      { role: 'user', content: JSON.stringify({ current_preferences: plan.preferences, courses: plan.courses, context }) },
      ...history.map(m => ({ role: m.role, content: m.text })),
      { role: 'user', content: input },
    ],
    tools: preferenceTools, tool_choice: 'auto', store: false,
  }, { signal });
  if (response.status !== 'completed') throw new Error('OpenAI returned an incomplete response.');
  const preferenceCalls = PreferenceCallsSchema.parse(response.output.filter(item => item.type === 'function_call').map(item => ({ name: item.name, arguments: JSON.parse(item.arguments) })));
  const message = response.output_text || (preferenceCalls.length ? 'I translated your feedback into scheduling preferences.' : 'Which scheduling preference would you like to change?');
  return { message, preferenceCalls };
}
