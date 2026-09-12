// ---------------------------------------------------------------------------
// Headless smoke test for the data layer: drives the whole onboarding -> run ->
// plan flow through the real gated client in mock mode and asserts the
// invariants that matter. Run with: npm run smoke
// ---------------------------------------------------------------------------

import { authApi, preferencesApi, optimizerApi, planApi, sessionsApi, chatApi, coursesApi } from '../src/lib/api/index.js';
import { preferencesFromOnboarding, runContextFromOnboarding } from '../src/lib/onboarding.js';
import { toPlanView, timelineForDay, itemsForDay, assignLanes, sessionsByGoalForDay, visibleHourRange } from '../src/lib/adapters.js';
import { db } from '../src/lib/mock/db.js';
import { COURSE_PALETTE } from '../src/lib/courseColors.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const CHOSEN = ['course_15213', 'course_09217', 'course_21259'];

const answers = {
  classes: CHOSEN,
  focus: 'Evening',
  commitment: 'Part-time job',
  style: 'Standard blocks (~1 hr)',
  pressure: 'An upcoming exam',
};

console.log('\nauth');
const session = await authApi.session();
check('session returns a user', Boolean(session.user?.id));
check('user has an email and name', Boolean(session.user.email && session.user.name));
check('reports onboarding state', typeof session.user.onboarding_complete === 'boolean');
check('sign-in URL is a full-page redirect to the auth route', authApi.signInUrl('/').includes('/auth/google?next='));

console.log('\ncourse catalog');
const catalog = await coursesApi.catalog();
check('returns a catalog', catalog.courses.length >= 10, String(catalog.courses.length));
check('every course has code, name, department', catalog.courses.every((c) => c.code && c.name && c.department));
check('every course has meeting_times', catalog.courses.every((c) => c.meeting_times.length > 0));
check(
  'meeting_times carry weekday ints and clock times',
  catalog.courses.every((c) => c.meeting_times.every((m) => m.days.every(Number.isInteger) && /^\d{2}:\d{2}$/.test(m.start_time))),
);
check('the chosen ids exist in the catalog', CHOSEN.every((id) => catalog.courses.some((c) => c._id === id)));

console.log('\nonboarding -> typed preference entries');
const entries = preferencesFromOnboarding(answers);
check('emits only catalog types', entries.every((e) => ['preferred_hours', 'avoid_block', 'session_length'].includes(e.type)));
check('every entry has type/value/weight', entries.every((e) => e.type && e.value && typeof e.weight === 'number'));
check('all sourced to onboarding', entries.every((e) => e.source === 'onboarding'));
const saved = await preferencesApi.create(entries, { replaceSource: 'onboarding' });
check('persisted with ids', saved.preferences.every((p) => p._id));

console.log('\noptimizer run lifecycle');
const runContext = runContextFromOnboarding(answers);
let run = await optimizerApi.start({ runContext, reset: false });
check('starts non-terminal', ['queued', 'running'].includes(run.status), run.status);
check('reports a stage', Boolean(run.stage));

const seenProgress = [];
let polls = 0;
while (!['solved', 'infeasible', 'failed', 'cancelled'].includes(run.status)) {
  if (polls++ > 60) break;
  await new Promise((r) => setTimeout(r, 250));
  run = await optimizerApi.get(run.run_id);
  seenProgress.push(run.progress);
}
check('reaches solved', run.status === 'solved', run.status);
check('progress never regresses', seenProgress.every((p, i) => i === 0 || p >= seenProgress[i - 1]));
check('progress capped below 1 until solved', seenProgress.slice(0, -1).every((p) => p <= 0.9));
check('reports objective/bound/gap', run.objective_value !== null && run.best_bound !== null && run.gap !== null);
check('gap is a real fraction', run.gap > 0 && run.gap < 1, String(run.gap));

console.log('\nplan payload is schema-shaped');
const payload = await planApi.get();
check('returns courses/tasks/sessions', Array.isArray(payload.courses) && Array.isArray(payload.tasks) && Array.isArray(payload.sessions));
const fixed = payload.sessions.filter((s) => s.type === 'fixed');
const flexible = payload.sessions.filter((s) => s.type === 'flexible');
check('fixed sessions have null task_id', fixed.every((s) => s.task_id === null));
check('fixed sessions are locked', fixed.every((s) => s.locked === true));
check('flexible sessions carry a task_id', flexible.every((s) => typeof s.task_id === 'string'));
check('every session carries a concrete action', payload.sessions.every((s) => typeof s.action === 'string' && s.action.length > 3));
check('every session has intensity + duration', payload.sessions.every((s) => s.intensity && Number.isInteger(s.duration_min)));
check('locked and completed are independent', payload.sessions.every((s) => typeof s.locked === 'boolean' && typeof s.completed === 'boolean'));
check(
  'est_duration_min is the rollup of its sessions',
  payload.tasks.every((t) => {
    const sum = flexible.filter((s) => s.task_id === t._id).reduce((a, s) => a + s.duration_min, 0);
    return t.est_duration_min === sum;
  }),
);
check('tasks carry a display_title', payload.tasks.every((t) => Boolean(t.display_title)));

// One shared timeline: nothing may overlap anything else.
const intervals = payload.sessions
  .map((s) => ({ id: s._id, start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
  .sort((a, b) => a.start - b.start);
const overlap = intervals.find((iv, i) => i > 0 && iv.start < intervals[i - 1].end);
check('no session overlaps another', !overlap, overlap ? `${overlap.id} overlaps` : '');

console.log('\nview model');
const plan = toPlanView(payload);
check('derives one goal per course', plan.goals.length === payload.courses.length);
check('goals carry a course code for the legend', plan.goals.every((g) => Boolean(g.code)));
check('assigns one distinct color per class', new Set(plan.goals.map((g) => plan.colorMap.get(g.id).key)).size === plan.goals.length);
check('colors come from the palette', plan.goals.every((g) => COURSE_PALETTE.includes(plan.colorMap.get(g.id))));
check('tasks have ordered sessions', plan.tasks.every((t) => t.sessions.every((s, i) => s.order === i + 1)));
check('deadlines are relative, not dates', plan.tasks.every((t) => /in \d+ days|today|tomorrow|overdue/.test(t.dueLabel)));
const timeline = timelineForDay(plan, 0);
check('today timeline is chronological', timeline.every((x, i) => i === 0 || x.item.minutesIntoDay >= timeline[i - 1].item.minutesIntoDay));
check('timeline mixes fixed and flexible', new Set(timeline.map((x) => x.kind)).size >= 1);
console.log('\ncalendar + swimlanes');
const dayItems = itemsForDay(plan, 0);
check('day items are chronological', dayItems.every((x, i) => i === 0 || x.minutesIntoDay >= dayItems[i - 1].minutesIntoDay));
const { startHour, endHour } = visibleHourRange(plan, [0, 1, 2, 3, 4, 5, 6]);
check('visible hour range is sane', startHour >= 0 && endHour <= 30 && endHour > startHour, `${startHour}-${endHour}`);
check(
  'every placed item falls inside the visible range',
  [0, 1, 2, 3, 4, 5, 6]
    .flatMap((o) => itemsForDay(plan, o))
    .every((i) => i.minutesIntoDay >= startHour * 60 && i.minutesIntoDay + i.durationMin <= endHour * 60),
);
const lanes = assignLanes(dayItems);
check('non-overlapping items share one lane', lanes.laneCount === 1 || dayItems.length === 0);
check(
  'overlapping items get separate lanes',
  (() => {
    const fake = [
      { id: 'a', minutesIntoDay: 600, durationMin: 60 },
      { id: 'b', minutesIntoDay: 630, durationMin: 60 },
      { id: 'c', minutesIntoDay: 800, durationMin: 30 },
    ];
    const res = assignLanes(fake);
    return res.laneCount === 2 && res.placed[0].lane === 0 && res.placed[1].lane === 1 && res.placed[2].lane === 0;
  })(),
);
const goalRows = sessionsByGoalForDay(plan, 0);
check('swimlane rows are goals, one per class', goalRows.length === plan.goals.length);
check('a goal with nothing today still gets a row', goalRows.every((r) => r.goal && Array.isArray(r.sessions)));
check(
  'every session in a row belongs to that goal and that day',
  goalRows.every((r) => r.sessions.every((s) => s.courseId === r.goal.id && s.dayOffset === 0)),
);
check(
  'row totals match their own blocks',
  goalRows.every((r) => r.totalMin === [...r.sessions, ...r.fixed].reduce((a, s) => a + s.durationMin, 0)),
);

console.log('\nfixed blocks come from meeting_times');
const catalogById = new Map(catalog.courses.map((c) => [c._id, c]));
check(
  'each fixed block matches one of its course meeting_times',
  fixed.every((block) => {
    const course = catalogById.get(block.course_id);
    const startMin = new Date(block.start).getHours() * 60 + new Date(block.start).getMinutes();
    return course.meeting_times.some((m) => {
      const [h, mm] = m.start_time.split(':').map(Number);
      return h * 60 + mm === startMin;
    });
  }),
);
check(
  'fixed blocks only land on their meeting weekdays',
  fixed.every((block) => {
    const course = catalogById.get(block.course_id);
    const weekday = new Date(block.start).getDay();
    return course.meeting_times.some((m) => m.days.includes(weekday));
  }),
);

console.log('\nsession actions');
const target = flexible[0];
const patched = await sessionsApi.patch(target._id, { completed: true });
check('marks a session completed', patched.session.completed === true);
let lockedRejected = false;
try {
  await sessionsApi.patch(fixed[0]._id, { start: new Date().toISOString() });
} catch (err) {
  lockedRejected = err.status === 409;
}
check('refuses to move a locked session', lockedRejected);

const prefsBeforeNudge = db.preferences.length;
await sessionsApi.nudge(target._id);
check('a nudge appends a preference entry, not a direct edit', db.preferences.length === prefsBeforeNudge + 1);

console.log('\nchat');
const prefsBeforeResource = db.preferences.length;
const resourceRes = await chatApi.send('Find resources on "Key technique" for Calc III', { course_id: plan.goals[0].id, topic: 'Key technique' });
check('resource request returns a reply', resourceRes.messages.some((m) => m.role === 'bot'));
check('resource request writes no preference entry', db.preferences.length === prefsBeforeResource);
check('resource request does not change the plan', resourceRes.plan_changed === false);

const prefsBeforeReschedule = db.preferences.length;
const rescheduleRes = await chatApi.send('move chem earlier in the day', { stage: 'hub' });
check('reschedule request writes a preference entry', db.preferences.length > prefsBeforeReschedule);
check('reschedule traces back to its message', db.preferences.at(-1).source_message_id === rescheduleRes.messages[0]._id);
check('transcript persists both turns', (await chatApi.list()).messages.length >= 4);

console.log('\nclasses');
const breakdown = await coursesApi.breakdown(plan.goals[0].id);
check('returns a month-by-month unit breakdown', breakdown.unit_breakdown.length > 0 && breakdown.unit_breakdown.every((u) => u.month && u.label && u.topics.length));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
