// GET /api/courses — the shared course catalog for the onboarding picker.
// Shared/static data, so it needs a session but no per-user scoping.

import { ok, requireUser, route } from '../../../lib/api.js';
import { collections } from '../../../lib/mongo.js';
import { ensureSeeded } from '../../../lib/seed.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { response } = await requireUser(request);
  if (response) return response;

  await ensureSeeded();
  const { courses } = await collections();
  const docs = await courses.find({}).sort({ code: 1 }).toArray();

  return ok({
    courses: docs.map((c) => ({
      _id: c._id,
      code: c.code,
      section: c.section,
      name: c.name,
      term: c.term,
      department: c.department,
      units: c.units,
      meeting_times: c.meeting_times,
    })),
  });
});
