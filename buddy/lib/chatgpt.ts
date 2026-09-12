import OpenAI from 'openai';
import { PreferenceCallsSchema, preferenceTools } from './preference-contract';
import type { Plan } from './plan';

/** The only chat interpreter. OpenAI selects existing preference/task API calls;
 * it is never offered event IDs, event mutation tools, or solver weights. */
export async function interpretScheduleInput(input: string, plan: Plan, context?: { task_id?: string }, history: { role: 'user' | 'assistant'; text: string }[] = [], signal?: AbortSignal) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not configured.');
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }).responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
    instructions: `You are Buddy, a student scheduling assistant. Translate scheduling feedback into calls to the provided tools. The Python CP-SAT optimizer decides every session's actual placement after those tools run -- never choose event times or edit calendar events yourself, including in add_task: you supply the task's facts (course, deadline, how much work, optionally how to structure it into sessions), the solver still places every session. Use only the provided tools and their documented arguments. Use bounded strength values, never raw solver weights. Include a short conversational explanation of what you did or intend; do not claim a change is already reflected on the calendar. The current preferences and tasks below are authoritative; history is conversational context and can include updates later undone. today_date is the real current date -- resolve any relative due date ('due Friday', 'in 5 days', 'next week') against it, never against your own assumed date. For add_task, only use session_plan when the student is explicit about session structure (an exact count or length) -- a plain duration+deadline should use the default automatic split. For ambiguous requests (including which task remove_task should target) ask a question and make no tool calls. If a request cannot be expressed by the tools, explain the limitation and make no calls; do not substitute an unrelated tool call. For list_current_preferences, summarize the supplied current preferences. Hard protected blocks affect flexible work, never move lectures. Keep responses brief and use at most 6 calls.`,
    input: [
      { role: 'user', content: JSON.stringify({
        today_date: plan.windowStart.slice(0, 10),
        current_preferences: plan.preferences,
        courses: plan.courses,
        // Trimmed to what a tool call actually needs (id/title/course/due/status) --
        // the full session-level detail already lives on the calendar the student
        // is looking at, not something the model needs restated here.
        tasks: plan.tasks.map(t => ({ _id: t._id, title: t.display_title, course_id: t.course_id, due_at: t.due_at, status: t.status })),
        context,
      }) },
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
