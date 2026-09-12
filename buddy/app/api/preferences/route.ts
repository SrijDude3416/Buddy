import { dataAccess } from '@/lib/auth/data-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { preferenceEnvelope } from '@/lib/demo-data';
import { getDefaultPreferences, applyPreferenceCalls, OptimizerError } from '@/lib/fastapi';
import type { PreferenceCall } from '@/lib/preference-contract';
import { isBuddyCatalogConfigured, isScheduleConfigured, listBuddyScheduleClasses, listScheduleClasses, toMeetingTime, type Section } from '@/lib/mongo';
export const maxDuration = 180;
export async function GET(request: Request) {
  try {
    const envelope = preferenceEnvelope();
    const defaults = await getDefaultPreferences(request.signal);
    // The optimizer's own course ids, not the static file's: those two only agree
    // when it happens to be reading test-data, and a mismatch here means the plain
    // "Confirm preferences" path posts ids the solver rejects.
    const answers = { ...envelope.answers, classes: defaults.plan.courses.map(c => c._id) };
    return NextResponse.json({ ...envelope, ...defaults, answers });
  }
  catch (e) { return NextResponse.json({ message: e instanceof OptimizerError ? e.message : 'Could not load preferences and calendar.' }, { status: 502 }); }
}
const Answers = z.object({
  // Shape only. Which ids are real is the optimizer's answer, not this file's — the
  // catalog these come from is now Atlas (GET /api/courses), which knows nothing
  // about what the solver has task data for. unschedulableClasses() below names the
  // ones it can't use instead of letting a bare 422 "Unknown course ID" through.
  classes: z.array(z.string().min(1)).min(1).max(6),
  // Which lecture/recitation of each class is the student's. Ids only — the
  // meeting times are resolved from Mongo server-side, so a tampered client can
  // never inject arbitrary blocks into a solve.
  sections: z.record(z.string(), z.object({ lecture: z.string().optional(), recitation: z.string().optional() })).optional(),
  focus: z.enum(['Early morning', 'Midday', 'Evening', 'Late night']),
  commitment: z.enum(['None', 'Part-time job', 'Research or lab', 'Clubs & orgs']),
  style: z.enum(['Short bursts (25-30 min)', 'Standard blocks (~1 hr)', 'Deep long sessions (2+ hrs)']),
  pressure: z.enum(['An upcoming exam', 'A big project', 'Staying caught up day-to-day', 'Getting back on track']),
});
type SectionChoice = { lecture?: string; recitation?: string };

/**
 * The picked classes as courses the optimizer can place, with the meeting times of
 * the exact sections the student chose.
 *
 * The optimizer only knows the courses it loaded at startup; a class from the Atlas
 * catalog is new to it, so its class times have to travel with the request or the
 * calendar can't show them. Sections are looked up here rather than trusted from the
 * request body. A course whose only sections are TBA contributes no meeting times —
 * it stays in the solve as a course, it just never appears on the grid.
 *
 * Returns [] when the catalog isn't configured, which leaves the optimizer to use
 * its own course data exactly as it did before.
 */
async function courseOverrides(classes: string[], sections: Record<string, SectionChoice>) {
  if ((await dataAccess()).demo) return [];
  const catalogClasses = isBuddyCatalogConfigured()
    ? await listBuddyScheduleClasses()
    : isScheduleConfigured()
      ? await listScheduleClasses()
      : [];
  const catalog = new Map(catalogClasses.map(c => [c.course_id, c]));
  const overrides = [];
  for (const id of classes) {
    const cls = catalog.get(id);
    if (!cls) continue; // not from this catalog — the optimizer may still know it
    const chosen: Section[] = [];
    for (const kind of ['lecture', 'recitation'] as const) {
      const options = cls[kind];
      if (!options.length) continue;
      // One option needs no choice; more than one and the picker required a pick.
      const pick = options.length === 1 ? options[0] : options.find(s => s.id === sections[id]?.[kind]);
      if (pick) chosen.push(pick);
    }
    overrides.push({
      // Title only. The optimizer derives a display code from a leading course
      // number in the name, and falls back to the id when there isn't one — which
      // is exactly right here, so prefixing the number would only render it twice.
      id: cls.course_id,
      name: cls.course_title,
      meeting_times: chosen.filter(s => s.scheduled).map(toMeetingTime),
    });
  }
  return overrides;
}
/** The first pair of picked classes that meet on the same day at the same time. */
function findClash(courses: { id: string; name: string; meeting_times: { days: string[]; start_time: string; end_time: string }[] }[]) {
  const slots = courses.flatMap(c => c.meeting_times.flatMap(mt => mt.days.map(day => ({ name: c.name, day, start: mt.start_time, end: mt.end_time }))));
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      if (a.name === b.name || a.day !== b.day) continue;
      if (a.start < b.end && b.start < a.end) return [a.name, b.name];
    }
  }
  return null;
}
export async function POST(request: Request) {
  let answers;
  try { ({ answers } = z.object({ answers: Answers }).parse(await request.json())); }
  catch { return NextResponse.json({ message: 'Choose valid onboarding answers and at least one course.' }, { status: 400 }); }
  let courses;
  try { courses = await courseOverrides(answers.classes, answers.sections ?? {}); }
  catch (e) {
    console.error(`[preferences] could not resolve sections (${e instanceof Error ? e.message : e})`);
    return NextResponse.json({ message: 'Could not read your class times from the course catalog. Your calendar is unchanged.' }, { status: 502 });
  }
  // Two classes at the same hour are two immovable intervals the solver can't
  // separate, and it answers by losing the whole schedule rather than the clash.
  // Say which two instead: nobody can attend both, so this is the student's to fix.
  const clash = findClash(courses);
  if (clash) {
    return NextResponse.json({ message: `${clash[0]} and ${clash[1]} meet at the same time. Pick a different section for one of them — your calendar is unchanged.` }, { status: 400 });
  }
  const [start_time, end_time] = { 'Early morning': ['08:00', '17:00'], Midday: ['11:00', '17:00'], Evening: ['17:00', '23:00'], 'Late night': ['20:00', '23:59'] }[answers.focus];
  const calls: PreferenceCall[] = [{ name: 'set_preferred_work_hours', arguments: { start_time, end_time, strength: 'moderate' } }];
  try {
    const result = await applyPreferenceCalls([], calls, answers.classes, request.signal, courses);
    return NextResponse.json({ ...preferenceEnvelope(), ...result, answers,
      notice: 'The optimizer rebuilt this schedule using your selected courses and preferred work hours. Exact study-block lengths and outside-commitment times are not represented by the current preference API.',
    });
  } catch (e) { return NextResponse.json({ message: e instanceof OptimizerError ? e.message : 'Could not rebuild your schedule.' }, { status: e instanceof OptimizerError && e.status === 409 ? 409 : 502 }); }
}
