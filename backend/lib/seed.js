// ---------------------------------------------------------------------------
// Seed the shared/static collections. `courses` and `syllabus_data` are the same
// for every user (SCHEMA.md), so they are upserted once per cluster rather than
// per account. Idempotent: safe to call on every cold start.
// ---------------------------------------------------------------------------

import { collections } from './mongo.js';
import { COURSE_CATALOG, assignmentKindsFor } from './catalog.js';
import { UNIT_BREAKDOWN } from './planEngine.js';
import { isoAt } from './time.js';

const globalForSeed = globalThis;
const DAYS_AWAY = [3, 6, 14];

export async function ensureSeeded() {
  // Once per warm process is enough; Mongo upserts make a repeat harmless anyway.
  if (globalForSeed.__buddySeeded) return;

  const { courses, syllabusData } = await collections();

  const courseOps = COURSE_CATALOG.map((course) => ({
    updateOne: {
      filter: { _id: course._id },
      update: { $set: { ...course } },
      upsert: true,
    },
  }));

  const syllabusOps = COURSE_CATALOG.map((course) => ({
    updateOne: {
      filter: { course_id: course._id },
      update: {
        $set: {
          course_id: course._id,
          assignments: assignmentKindsFor(course.department).map((kind, k) => ({
            name: `${kind} ${k + 1}`,
            type: 'assessment',
            due_date: isoAt(DAYS_AWAY[k % DAYS_AWAY.length], 23, 59),
            weight_in_grade: 0.15,
          })),
          topics: [],
          unit_breakdown: UNIT_BREAKDOWN,
          grading_breakdown: {},
          raw_text_ref: null,
        },
      },
      upsert: true,
    },
  }));

  await courses.bulkWrite(courseOps, { ordered: false });
  await syllabusData.bulkWrite(syllabusOps, { ordered: false });

  globalForSeed.__buddySeeded = true;
}

/**
 * Indexes. The per-user ones are the difference between a demo that stays fast
 * and one that table-scans every collection on every request.
 */
export async function ensureIndexes() {
  const c = await collections();
  await Promise.all([
    c.users.createIndex({ google_sub: 1 }, { unique: true }),
    c.users.createIndex({ email: 1 }),
    c.enrollments.createIndex({ user_id: 1, course_id: 1 }, { unique: true }),
    c.tasks.createIndex({ user_id: 1 }),
    c.preferences.createIndex({ user_id: 1 }),
    c.sessions.createIndex({ user_id: 1, start: 1 }),
    c.sessions.createIndex({ user_id: 1, task_id: 1 }),
    c.chatMessages.createIndex({ user_id: 1, timestamp: 1 }),
    c.optimizerRuns.createIndex({ user_id: 1, created_at: -1 }),
    c.syllabusData.createIndex({ course_id: 1 }, { unique: true }),
  ]);
}
