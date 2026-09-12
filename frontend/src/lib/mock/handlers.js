// ---------------------------------------------------------------------------
// Mock handlers, keyed by the endpoint names in src/lib/endpoints.js.
//
// Each one is a stand-in for a real API route and returns exactly the response
// body that route is contracted to return. When a route goes live, delete
// nothing here — flip VITE_API_MODE=live and this file simply stops being
// reached, which keeps it usable as the reference for what the backend owes the
// frontend.
// ---------------------------------------------------------------------------

import { db, nextId, resetDb, latestRun } from './db.js';
import { COURSE_CATALOG } from './catalog.js';
import { buildPlanDocuments, UNIT_BREAKDOWN } from './planFactory.js';
import { config } from '../config.js';
import { validatePreferenceEntry } from '../preferenceCatalog.js';
import { ApiError } from '../errors.js';
import { addMinutesIso } from '../time.js';

// The stages a real run reports. The frontend renders whatever `stage` the
// server sends, so this list is a contract, not decoration.
const RUN_STAGES = [
  { key: 'ingesting', label: 'Reading your syllabi and Canvas data' },
  { key: 'decomposing', label: 'Splitting assignments into sessions' },
  { key: 'compiling', label: 'Compiling your preferences into constraints' },
  { key: 'solving', label: 'Solving for the best placement' },
  { key: 'finalizing', label: 'Writing your week' },
];

export const RUN_STAGE_LABELS = RUN_STAGES;

function progressFor(run) {
  const elapsed = Date.now() - run.started_at_ms;
  const fraction = Math.min(1, elapsed / config.mockSolveMs);
  const stageIndex = Math.min(RUN_STAGES.length - 1, Math.floor(fraction * RUN_STAGES.length));
  return { fraction, stage: RUN_STAGES[stageIndex].key, stageIndex };
}

function serializeRun(run) {
  return {
    run_id: run._id,
    status: run.status,
    stage: run.stage,
    // 0..1. A real CP-SAT run reports this from its own progress callbacks.
    progress: run.progress,
    objective_value: run.objective_value,
    best_bound: run.best_bound,
    gap: run.gap,
    created_at: run.created_at,
    completed_at: run.completed_at,
    message: run.message ?? null,
  };
}

/** Advance the fake solve based on wall-clock time, so polling looks real. */
function tickRun(run) {
  if (run.status !== 'queued' && run.status !== 'running') return run;

  const { fraction, stage } = progressFor(run);
  run.stage = stage;
  // Never claim more than 90% until the solve has actually landed.
  run.progress = Math.min(0.9, fraction);
  run.status = 'running';

  if (fraction >= 1) {
    if (run.infeasible) {
      run.status = 'infeasible';
      run.message = "Some of this genuinely can't fit before its deadline.";
      run.completed_at = new Date().toISOString();
      return run;
    }

    const docs = buildPlanDocuments({
      userId: db.user._id,
      preferences: db.preferences,
      runContext: run.inputs_snapshot.run_context,
    });
    db.courses = docs.courses;
    db.syllabus_data = docs.syllabi;
    db.tasks = docs.tasks;
    db.sessions = docs.sessions;

    // An honest gap: CP-SAT reports a provable bound even without proving
    // optimality, so this is a real number to show, not a fudged one.
    run.objective_value = 1840;
    run.best_bound = 1955;
    run.gap = Number(((run.best_bound - run.objective_value) / run.best_bound).toFixed(4));
    run.status = 'solved';
    run.stage = 'finalizing';
    run.progress = 1;
    run.completed_at = new Date().toISOString();
  }
  return run;
}

export const mockHandlers = {
  // --- course catalog ------------------------------------------------------
  listCourseCatalog: () => ({
    courses: COURSE_CATALOG.map((c) => ({
      _id: c._id,
      code: c.code,
      section: c.section,
      name: c.name,
      term: c.term,
      department: c.department,
      units: c.units,
      meeting_times: c.meeting_times,
    })),
  }),

  // --- preferences ---------------------------------------------------------
  createPreferences: ({ body }) => {
    const entries = body?.entries ?? [];
    const problems = entries.map(validatePreferenceEntry).filter(Boolean);
    if (problems.length) {
      throw new ApiError(problems[0], { status: 422, code: 'invalid_preference' });
    }
    if (body?.replace_source) {
      db.preferences = db.preferences.filter((p) => p.source !== body.replace_source);
    }
    const saved = entries.map((entry) => ({
      _id: nextId('pref'),
      user_id: db.user._id,
      source_message_id: entry.source_message_id ?? null,
      ...entry,
    }));
    db.preferences.push(...saved);
    return { preferences: saved };
  },

  listPreferences: () => ({ preferences: db.preferences }),

  // --- optimizer run ------------------------------------------------------
  startOptimizerRun: ({ body }) => {
    // A fresh solve replaces the previous plan documents, same as a re-solve.
    if (body?.reset) resetDb();

    const run = {
      _id: nextId('run'),
      user_id: db.user._id,
      status: 'queued',
      stage: RUN_STAGES[0].key,
      progress: 0,
      inputs_snapshot: {
        preference_count: db.preferences.length,
        horizon_days: body?.horizon_days ?? 7,
        run_context: body?.run_context ?? { courses: ['Coursework'], pressure: 'Staying caught up day-to-day' },
      },
      objective_value: null,
      best_bound: null,
      gap: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      started_at_ms: Date.now(),
      // Set VITE_MOCK_INFEASIBLE=1 to exercise the infeasible branch of the UI.
      infeasible: import.meta.env?.VITE_MOCK_INFEASIBLE === '1',
    };
    db.optimizer_runs.push(run);
    return serializeRun(run);
  },

  getOptimizerRun: ({ params }) => {
    const run = db.optimizer_runs.find((r) => r._id === params.runId);
    if (!run) throw new ApiError('No such optimizer run', { status: 404, code: 'not_found' });
    return serializeRun(tickRun(run));
  },

  cancelOptimizerRun: ({ params }) => {
    const run = db.optimizer_runs.find((r) => r._id === params.runId);
    if (!run) throw new ApiError('No such optimizer run', { status: 404, code: 'not_found' });
    if (run.status === 'queued' || run.status === 'running') {
      run.status = 'cancelled';
      run.completed_at = new Date().toISOString();
    }
    return serializeRun(run);
  },

  // --- plan ---------------------------------------------------------------
  getPlan: () => ({
    courses: db.courses,
    tasks: db.tasks,
    sessions: db.sessions,
    run: latestRun() ? serializeRun(latestRun()) : null,
  }),

  // --- session actions ----------------------------------------------------
  patchSession: ({ params, body }) => {
    const session = db.sessions.find((s) => s._id === params.sessionId);
    if (!session) throw new ApiError('No such session', { status: 404, code: 'not_found' });
    if (session.locked && body?.start) {
      throw new ApiError('Locked sessions cannot be moved', { status: 409, code: 'session_locked' });
    }
    if (typeof body?.completed === 'boolean') session.completed = body.completed;
    if (typeof body?.locked === 'boolean') session.locked = body.locked;
    if (body?.start) {
      session.start = body.start;
      session.end = addMinutesIso(body.start, session.duration_min);
    }
    return { session };
  },

  nudgeSession: ({ params }) => {
    const session = db.sessions.find((s) => s._id === params.sessionId);
    if (!session) throw new ApiError('No such session', { status: 404, code: 'not_found' });

    // A thumbs-down is a preference entry, not a direct edit. The re-place below
    // stands in for the partial re-solve the backend would run.
    const pref = {
      _id: nextId('pref'),
      user_id: db.user._id,
      type: 'avoid_block',
      value: { start_slot: Math.floor((new Date(session.start).getHours() * 60) / 15), end_slot: Math.floor((new Date(session.start).getHours() * 60) / 15) + 4, hard: false },
      weight: 0.6,
      source: 'chat',
      source_message_id: null,
    };
    db.preferences.push(pref);

    session.start = addMinutesIso(session.start, 60);
    session.end = addMinutesIso(session.start, session.duration_min);
    return { session, preference: pref };
  },

  // --- classes ------------------------------------------------------------
  getCourseBreakdown: ({ params }) => {
    const course = db.courses.find((c) => c._id === params.courseId);
    if (!course) throw new ApiError('No such course', { status: 404, code: 'not_found' });
    const syllabus = db.syllabus_data.find((s) => s.course_id === params.courseId);
    return {
      course_id: course._id,
      course_name: course.name,
      unit_breakdown: syllabus?.unit_breakdown ?? UNIT_BREAKDOWN,
    };
  },

  // --- chat ---------------------------------------------------------------
  listChatMessages: () => ({ messages: db.chat_messages }),

  sendChatMessage: ({ body }) => {
    const userMsg = {
      _id: nextId('msg'),
      user_id: db.user._id,
      role: 'user',
      text: body?.text ?? '',
      timestamp: new Date().toISOString(),
      context: body?.context ?? null,
    };
    db.chat_messages.push(userMsg);

    // A resource request is a lookup, never a scheduling constraint — it must
    // not become a preferences entry (SCHEMA.md).
    const isResourceRequest = Boolean(body?.context?.topic) || /resource|explain|help me understand/i.test(userMsg.text);

    let planChanged = false;
    if (!isResourceRequest) {
      const movable = db.sessions.find((s) => s.type === 'flexible' && !s.locked && !s.completed);
      if (movable) {
        db.preferences.push({
          _id: nextId('pref'),
          user_id: db.user._id,
          type: 'weight_adjustment',
          value: { task_id: movable.task_id, multiplier: 1.25 },
          weight: 0.7,
          source: 'chat',
          source_message_id: userMsg._id,
        });
        movable.start = addMinutesIso(movable.start, -60);
        movable.end = addMinutesIso(movable.start, movable.duration_min);
        planChanged = true;
      }
    }

    const botMsg = {
      _id: nextId('msg'),
      user_id: db.user._id,
      role: 'bot',
      text: isResourceRequest
        ? "Here's where I'd start: a worked-examples set and a short explainer. I'll link them once the resource index is wired up."
        : planChanged
          ? 'Got it — I logged that as a preference and moved the next session earlier.'
          : "Noted. There's nothing movable left in this week to apply it to yet.",
      timestamp: new Date().toISOString(),
      context: body?.context ?? null,
    };
    db.chat_messages.push(botMsg);

    return { messages: [userMsg, botMsg], plan_changed: planChanged };
  },
};
