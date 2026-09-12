// GET /api/plan — courses + tasks + sessions + latest run, for this user only.
// Exactly the payload frontend/src/lib/adapters.js already knows how to read.

import { ok, requireUser, route } from '../../../lib/api.js';
import { collections } from '../../../lib/mongo.js';
import { latestRun, serializeRun } from '../../../lib/runs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const c = await collections();

  const [tasks, sessions, enrollments] = await Promise.all([
    c.tasks.find({ user_id: userId }).toArray(),
    c.sessions.find({ user_id: userId }).sort({ start: 1 }).toArray(),
    c.enrollments.find({ user_id: userId }).toArray(),
  ]);

  const courseIds = enrollments.map((e) => e.course_id);
  const courses = courseIds.length ? await c.courses.find({ _id: { $in: courseIds } }).toArray() : [];

  // Course order decides class colors on the frontend, so it has to be stable
  // across requests — enrollment order, not whatever Mongo returns.
  const byId = new Map(courses.map((course) => [course._id, course]));
  const orderedCourses = courseIds.map((id) => byId.get(id)).filter(Boolean);

  const run = await latestRun(userId);

  return ok({
    courses: orderedCourses,
    tasks: tasks.map((t) => ({ ...t, _id: String(t._id) })),
    sessions: sessions.map((s) => ({
      ...s,
      _id: String(s._id),
      task_id: s.task_id ? String(s.task_id) : null,
    })),
    run: serializeRun(run),
  });
});
