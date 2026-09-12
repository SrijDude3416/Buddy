import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SavedPreferencesSchema } from '@/lib/preference-contract';
import { applyPreferenceCalls, OptimizerError } from '@/lib/fastapi';

// Distinct from POST /api/preferences (chat/onboarding, which always carries
// a new operation) and from /api/chat/messages (which goes through OpenAI
// first). This is the "Recalculate" button's endpoint: the same current
// preferences, zero new operations -- a real CP-SAT re-solve, on demand,
// with no LLM round-trip needed since nothing is actually changing.
export const maxDuration = 180;

const Body = z.object({
  preferences: SavedPreferencesSchema,
  course_ids: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  let body;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ message: 'A current plan (preferences and courses) is required to recalculate.' }, { status: 400 });
  }
  try {
    const result = await applyPreferenceCalls(body.preferences, [], body.course_ids, request.signal);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof OptimizerError ? e.message : 'Could not recalculate the schedule.' },
      { status: e instanceof OptimizerError && e.status === 409 ? 409 : 502 },
    );
  }
}
