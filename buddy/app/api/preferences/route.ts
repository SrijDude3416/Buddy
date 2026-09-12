import { NextResponse } from 'next/server';
import { z } from 'zod';
import { preferenceEnvelope, catalog } from '@/lib/demo-data';
import { getDefaultPreferences, applyPreferenceCalls, OptimizerError } from '@/lib/fastapi';
import type { PreferenceCall } from '@/lib/preference-contract';
export const maxDuration = 180;
export async function GET(request: Request) {
  try { return NextResponse.json({ ...preferenceEnvelope(), ...await getDefaultPreferences(request.signal) }); }
  catch (e) { return NextResponse.json({ message: e instanceof OptimizerError ? e.message : 'Could not load preferences and calendar.' }, { status: 502 }); }
}
const Answers = z.object({
  classes: z.array(z.string()).min(1).max(6).refine(ids => ids.every(id => catalog.some(c => c._id === id))),
  focus: z.enum(['Early morning', 'Midday', 'Evening', 'Late night']),
  commitment: z.enum(['None', 'Part-time job', 'Research or lab', 'Clubs & orgs']),
  style: z.enum(['Short bursts (25-30 min)', 'Standard blocks (~1 hr)', 'Deep long sessions (2+ hrs)']),
  pressure: z.enum(['An upcoming exam', 'A big project', 'Staying caught up day-to-day', 'Getting back on track']),
});
export async function POST(request: Request) {
  let answers;
  try { ({ answers } = z.object({ answers: Answers }).parse(await request.json())); }
  catch { return NextResponse.json({ message: 'Choose valid onboarding answers and at least one course.' }, { status: 400 }); }
  const [start_time, end_time] = { 'Early morning': ['08:00', '17:00'], Midday: ['11:00', '17:00'], Evening: ['17:00', '23:00'], 'Late night': ['20:00', '23:59'] }[answers.focus];
  const calls: PreferenceCall[] = [{ name: 'set_preferred_work_hours', arguments: { start_time, end_time, strength: 'moderate' } }];
  try {
    const result = await applyPreferenceCalls([], calls, answers.classes, request.signal);
    return NextResponse.json({ ...preferenceEnvelope(), ...result, answers,
      notice: 'The optimizer rebuilt this schedule using your selected courses and preferred work hours. Exact study-block lengths and outside-commitment times are not represented by the current preference API.',
    });
  } catch (e) { return NextResponse.json({ message: e instanceof OptimizerError ? e.message : 'Could not rebuild your schedule.' }, { status: e instanceof OptimizerError && e.status === 409 ? 409 : 502 }); }
}
