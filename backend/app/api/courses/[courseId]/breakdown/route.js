// GET /api/courses/:courseId/breakdown — the Classes page unit/topic view.

import { ok, fail, requireUser, route } from '../../../../../lib/api.js';
import { collections } from '../../../../../lib/mongo.js';
import { ensureSeeded } from '../../../../../lib/seed.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request, { params }) => {
  const { response } = await requireUser(request);
  if (response) return response;

  const { courseId } = await params;
  await ensureSeeded();
  const { courses, syllabusData } = await collections();

  const course = await courses.findOne({ _id: courseId });
  if (!course) return fail(404, 'not_found', 'No such course');

  const syllabus = await syllabusData.findOne({ course_id: courseId });

  return ok({
    course_id: course._id,
    course_name: course.name,
    unit_breakdown: syllabus?.unit_breakdown ?? [],
  });
});
