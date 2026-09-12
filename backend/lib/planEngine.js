// ---------------------------------------------------------------------------
// The server-side plan engine. Ported verbatim from the frontend's mock factory
// (frontend/src/lib/mock/planFactory.js) so the shapes are identical and the
// frontend's 57 smoke checks still describe what the real API returns.
//
// This is the seam where CP-SAT takes over: replace placeSessions() with a call
// out to backend/optimizer and nothing else in this file or the routes changes.
//
// It deliberately mirrors the two real stages so the shape of the output does
// not change when the Python side takes over:
//   stage 1  decomposeTask()  — task -> sized sessions (heuristic, not solved)
//   stage 2  placeSessions()  — sized sessions -> start times (here: greedy,
//                               in production: CP-SAT)
// Anything this file returns, a real /plan response must also be able to return.
// ---------------------------------------------------------------------------

import { isoAt, addMinutesIso, addDays, startOfDay } from './time.js';
import { SLOT_MINUTES } from './preferenceCatalog.js';
import { COURSE_CATALOG, assignmentKindsFor } from './catalog.js';

let counter = 0;
/**
 * Document ids. These are real Mongo _id values, so they must be unique across
 * the whole collection, not just within one run: the counter alone resets on
 * every cold start, which would hand a second user the same sess_0001 and fail
 * the insert on a duplicate key. The random segment is what makes it safe.
 *
 * Deliberately readable strings rather than ObjectIds — they make a failing
 * request traceable in a log. Routes therefore match _id as a string; do not
 * wrap these in `new ObjectId(...)`.
 */
const oid = (prefix) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}${(++counter).toString(36)}`;

const PRESSURE_ACTIONS = {
  'An upcoming exam': [
    'Skim lecture notes and flag confusing topics',
    'Work through 10 practice problems from the study guide',
    'Timed practice test under exam conditions',
  ],
  'A big project': [
    'Outline sections and requirements',
    'Draft the core section',
    'Polish, proofread, and submit',
  ],
  'Staying caught up day-to-day': [
    "Review this week's readings",
    'Clear any missing homework',
    'Quick recap before next class',
  ],
  'Getting back on track': [
    'List everything currently overdue',
    'Tackle the single most urgent item',
    "Check in on what's left",
  ],
};

const GENERIC_ACTIONS = ['Work through the problem set', 'Review and check your answers'];

const PRESSURE_TITLE = {
  'An upcoming exam': 'Exam prep',
  'A big project': 'Project work',
  'Staying caught up day-to-day': 'Weekly catch-up',
  'Getting back on track': 'Reset & triage',
};

const UNIT_BREAKDOWN = [
  { label: 'Unit 1: Foundations', month: 'Sep', topics: [{ name: 'Syllabus & tools' }, { name: 'Core definitions' }, { name: 'Problem-solving basics' }] },
  { label: 'Unit 2: Core methods', month: 'Oct', topics: [{ name: 'Key technique' }, { name: 'Applied examples' }, { name: 'Midterm review' }] },
  { label: 'Unit 3: Advanced topics', month: 'Nov', topics: [{ name: 'Extensions' }, { name: 'Case studies' }, { name: 'Project checkpoint' }] },
  { label: 'Unit 4: Synthesis', month: 'Dec', topics: [{ name: 'Cumulative review' }, { name: 'Final prep' }, { name: 'Wrap-up' }] },
];

const DAYS_AWAY = [3, 6, 14];
const HORIZON_DAYS = 7;

function prefValue(prefs, type, fallback) {
  const hit = prefs.find((p) => p.type === type);
  return hit ? hit.value : fallback;
}

/** Stage 1: how many sessions, and how long each. Heuristic — never the solver's job. */
export function decomposeTask({ actions, sessionMinutes }) {
  return actions.map((action, i) => ({
    action,
    duration_min: i === actions.length - 1 ? Math.max(25, Math.round(sessionMinutes * 0.75)) : sessionMinutes,
    intensity: ['high', 'medium', 'low'][i % 3],
  }));
}

/**
 * Stage 2: assign start times. Greedy placement inside the user's preferred
 * window, skipping anything already in `busy` and any avoid_block, so the dummy
 * plan already respects the same inputs CP-SAT will.
 *
 * `busy` is the single shared occupancy pool — the stand-in for AddNoOverlap over
 * one interval list. It is mutated as sessions land, so the caller must pass the
 * same array across every course; giving each course its own pool is exactly how
 * two courses end up double-booking the same hour.
 *
 * @param {{start: number, end: number}[]} busy epoch-ms intervals, mutated
 */
export function placeSessions({ sized, preferences, busy, courseIndex }) {
  const window = prefValue(preferences, 'preferred_hours', { start_slot: 44, end_slot: 60 });
  const avoid = preferences.find((p) => p.type === 'avoid_block')?.value ?? null;

  const windowStartHour = Math.floor((window.start_slot * SLOT_MINUTES) / 60);
  const windowEndHour = Math.floor((window.end_slot * SLOT_MINUTES) / 60);
  const avoidStartHour = avoid ? Math.floor((avoid.start_slot * SLOT_MINUTES) / 60) : null;
  const avoidEndHour = avoid ? Math.floor((avoid.end_slot * SLOT_MINUTES) / 60) : null;

  const placed = [];
  sized.forEach((s, i) => {
    const dayOffset = (courseIndex + i) % 5;
    let hour = windowStartHour + ((i * 2) % Math.max(1, windowEndHour - windowStartHour));

    // Nudge out of an avoid window rather than pretending it isn't there.
    if (avoidStartHour !== null && hour >= avoidStartHour && hour < avoidEndHour) {
      hour = avoidEndHour;
    }

    let start = isoAt(dayOffset, hour, (i % 2) * 15);
    let end = addMinutesIso(start, s.duration_min);

    // Push past anything already occupying that span — fixed block or another
    // course's session. This is the one-shared-timeline rule.
    for (let guard = 0; guard < 32; guard += 1) {
      const st = new Date(start).getTime();
      const en = new Date(end).getTime();
      const clash = busy.find((b) => st < b.end && en > b.start);
      if (!clash) break;
      start = new Date(clash.end).toISOString();
      end = addMinutesIso(start, s.duration_min);
    }

    busy.push({ start: new Date(start).getTime(), end: new Date(end).getTime() });
    placed.push({ ...s, start, end });
  });

  return placed;
}

/**
 * Build the whole corpus of documents a fresh user would have after one solve.
 * Returns exactly the collections /plan is contracted to return.
 */
/** "HH:MM" -> minutes past midnight. */
function parseClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Materialize a course's recurring meeting_times into concrete fixed sessions
 * across the horizon. This is the only source of fixed blocks — they are not
 * seeded from tasks and never carry a task_id.
 */
function materializeFixedBlocks({ course, userId, now = new Date() }) {
  const blocks = [];
  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const date = addDays(startOfDay(now), offset);
    const weekday = date.getDay();
    course.meeting_times
      .filter((meeting) => meeting.days.includes(weekday))
      .forEach((meeting) => {
        const startMin = parseClock(meeting.start_time);
        const endMin = parseClock(meeting.end_time);
        const start = isoAt(offset, Math.floor(startMin / 60), startMin % 60, now);
        blocks.push({
          _id: oid('sess'),
          user_id: userId,
          task_id: null,
          course_id: course._id,
          type: 'fixed',
          start,
          end: addMinutesIso(start, endMin - startMin),
          action: `${course.code} ${meeting.type}`,
          intensity: 'medium',
          duration_min: endMin - startMin,
          locked: true,
          completed: false,
          location: meeting.location,
        });
      });
  }
  return blocks;
}

/**
 * Build the whole corpus of documents a fresh user would have after one solve.
 * Returns exactly the collections /plan is contracted to return.
 *
 * `runContext.course_ids` are catalog ids — the real pipeline would resolve them
 * through `enrollments`; here they are looked up directly in the catalog.
 */
export function buildPlanDocuments({ userId, preferences, runContext }) {
  const sessionMinutes = prefValue(preferences, 'session_length', { minutes: 60 }).minutes;
  const pressure = runContext.pressure;

  const selected = (runContext.course_ids ?? [])
    .map((id) => COURSE_CATALOG.find((c) => c._id === id))
    .filter(Boolean);
  // Never produce an empty plan just because nothing resolved.
  const chosen = selected.length ? selected : COURSE_CATALOG.slice(0, 3);

  const courses = [];
  const syllabi = [];
  const tasks = [];
  const sessions = [];
  // The single occupancy pool every placement decision is checked against.
  const busy = [];

  // Pass 1: the immovable stuff. Fixed blocks are known before any solve, so they
  // all land first and every flexible session is placed around the full set.
  chosen.forEach((catalogCourse) => {
    const course = {
      _id: catalogCourse._id,
      code: catalogCourse.code,
      section: catalogCourse.section,
      name: catalogCourse.name,
      term: catalogCourse.term,
      canvas_course_id: catalogCourse.canvas_course_id,
      department: catalogCourse.department,
      meeting_times: catalogCourse.meeting_times,
    };
    courses.push(course);

    const kinds = assignmentKindsFor(catalogCourse.department);
    syllabi.push({
      _id: oid('syl'),
      course_id: course._id,
      assignments: kinds.map((kind, k) => ({
        name: `${kind} ${k + 1}`,
        type: 'assessment',
        due_date: isoAt(DAYS_AWAY[k % DAYS_AWAY.length], 23, 59),
        weight_in_grade: 0.15,
      })),
      topics: [],
      unit_breakdown: UNIT_BREAKDOWN,
      grading_breakdown: {},
      raw_text_ref: null,
    });

    const fixedForCourse = materializeFixedBlocks({ course: catalogCourse, userId });
    sessions.push(...fixedForCourse);
    fixedForCourse.forEach((b) => busy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
  });

  // Pass 2: place each course's flexible sessions against the shared pool.
  courses.forEach((course, i) => {
    const kinds = assignmentKindsFor(course.department);
    const actions = i === 0 ? PRESSURE_ACTIONS[pressure] ?? GENERIC_ACTIONS : GENERIC_ACTIONS;
    const sized = decomposeTask({ actions, sessionMinutes });
    const placedSessions = placeSessions({ sized, preferences, busy, courseIndex: i });

    const taskId = oid('task');
    const sourceAssignment = `${kinds[i % kinds.length]} ${i + 1}`;
    tasks.push({
      _id: taskId,
      user_id: userId,
      course_id: course._id,
      source_assignment: sourceAssignment,
      display_title: i === 0 ? `${PRESSURE_TITLE[pressure]}: ${course.code}` : `${course.code} ${sourceAssignment.toLowerCase()}`,
      due_at: isoAt(DAYS_AWAY[i % DAYS_AWAY.length], 23, 59),
      est_duration_min: placedSessions.reduce((sum, s) => sum + s.duration_min, 0),
      splittable: true,
      status: 'not_started',
      priority_weight: [1.0, 0.7, 1.4][i % 3],
      actual_time_logged_min: null,
    });

    placedSessions.forEach((s) => {
      sessions.push({
        _id: oid('sess'),
        user_id: userId,
        task_id: taskId,
        course_id: course._id,
        type: 'flexible',
        start: s.start,
        end: s.end,
        action: s.action,
        intensity: s.intensity,
        duration_min: s.duration_min,
        locked: false,
        completed: false,
      });
    });
  });

  return { courses, syllabi, tasks, sessions };
}

export { UNIT_BREAKDOWN };
