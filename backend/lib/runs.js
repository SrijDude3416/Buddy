// ---------------------------------------------------------------------------
// Optimizer runs.
//
// The run is a real document with a status the frontend polls, which is the shape
// CP-SAT needs: a solve that takes 20 seconds cannot happen inside one request.
// Today the solve is synchronous and fast, so a run is created already-solved —
// but the polling contract is honoured exactly, so swapping in a queued Python
// worker later changes this file and nothing else.
// ---------------------------------------------------------------------------

import { ObjectId } from 'mongodb';
import { collections } from './mongo.js';
import { buildPlanDocuments } from './planEngine.js';
import { ensureSeeded } from './seed.js';

export function serializeRun(run) {
  if (!run) return null;
  return {
    run_id: String(run._id),
    status: run.status,
    stage: run.stage,
    progress: run.progress,
    objective_value: run.objective_value ?? null,
    best_bound: run.best_bound ?? null,
    gap: run.gap ?? null,
    created_at: run.created_at,
    completed_at: run.completed_at ?? null,
    message: run.message ?? null,
  };
}

export async function startRun({ userId, runContext, horizonDays = 7 }) {
  await ensureSeeded();
  const c = await collections();
  const now = new Date();

  const prefs = await c.preferences.find({ user_id: userId }).toArray();

  const run = {
    user_id: userId,
    status: 'running',
    stage: 'ingesting',
    progress: 0,
    inputs_snapshot: {
      preference_count: prefs.length,
      horizon_days: horizonDays,
      run_context: runContext ?? { course_ids: [], pressure: 'Staying caught up day-to-day' },
    },
    objective_value: null,
    best_bound: null,
    gap: null,
    created_at: now,
    completed_at: null,
  };
  const { insertedId } = await c.optimizerRuns.insertOne(run);
  run._id = insertedId;

  try {
    const docs = buildPlanDocuments({
      userId,
      preferences: prefs,
      runContext: run.inputs_snapshot.run_context,
    });

    // A re-solve replaces this user's placed time. Only this user's documents are
    // touched — the filter is the thing standing between accounts.
    await c.tasks.deleteMany({ user_id: userId });
    await c.sessions.deleteMany({ user_id: userId });

    if (docs.tasks.length) await c.tasks.insertMany(docs.tasks);
    if (docs.sessions.length) await c.sessions.insertMany(docs.sessions);

    // Record what the user is enrolled in, so /plan knows which courses are theirs.
    const courseIds = docs.courses.map((course) => course._id);
    await c.enrollments.deleteMany({ user_id: userId });
    if (courseIds.length) {
      await c.enrollments.insertMany(
        courseIds.map((courseId) => ({ user_id: userId, course_id: courseId, term: 'F25' })),
      );
    }

    // Honest numbers once CP-SAT is wired in; placeholders that match its shape
    // until then. `gap` is the one the UI shows as "% optimized".
    const objective = 1840;
    const bound = 1955;
    const update = {
      status: 'solved',
      stage: 'finalizing',
      progress: 1,
      objective_value: objective,
      best_bound: bound,
      gap: Number(((bound - objective) / bound).toFixed(4)),
      completed_at: new Date(),
    };
    await c.optimizerRuns.updateOne({ _id: insertedId }, { $set: update });
    return { ...run, ...update };
  } catch (err) {
    const update = {
      status: 'failed',
      progress: 0,
      message: err.message,
      completed_at: new Date(),
    };
    await c.optimizerRuns.updateOne({ _id: insertedId }, { $set: update });
    return { ...run, ...update };
  }
}

export async function getRun({ userId, runId }) {
  if (!ObjectId.isValid(runId)) return null;
  const c = await collections();
  // user_id in the filter, not checked after the fetch: a missing scope here is
  // how one account reads another's run.
  return c.optimizerRuns.findOne({ _id: new ObjectId(runId), user_id: userId });
}

export async function cancelRun({ userId, runId }) {
  const run = await getRun({ userId, runId });
  if (!run) return null;
  if (run.status === 'running' || run.status === 'queued') {
    const c = await collections();
    const update = { status: 'cancelled', completed_at: new Date() };
    await c.optimizerRuns.updateOne({ _id: run._id }, { $set: update });
    return { ...run, ...update };
  }
  return run;
}

export async function latestRun(userId) {
  const c = await collections();
  const [run] = await c.optimizerRuns.find({ user_id: userId }).sort({ created_at: -1 }).limit(1).toArray();
  return run ?? null;
}
