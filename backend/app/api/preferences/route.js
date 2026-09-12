// GET/POST /api/preferences — the only collection the AI/onboarding writes into.
//
// Every entry is validated against the fixed catalog before it lands. An unknown
// type is rejected with a 422 rather than stored and skipped later, because a
// preference the solver silently ignores is worse than one that never saved: the
// user thinks it applied.

import { ok, fail, requireUser, route } from '../../../lib/api.js';
import { collections } from '../../../lib/mongo.js';
import { validatePreferenceEntry } from '../../../lib/preferenceCatalog.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const { preferences } = await collections();
  const docs = await preferences.find({ user_id: userId }).toArray();
  return ok({ preferences: docs.map((d) => ({ ...d, _id: String(d._id) })) });
});

export const POST = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length) return fail(422, 'invalid_preference', 'No preference entries supplied');

  const problem = entries.map(validatePreferenceEntry).find(Boolean);
  if (problem) return fail(422, 'invalid_preference', problem);

  const { preferences } = await collections();

  // Re-running onboarding replaces its own entries rather than stacking a second
  // set on top, which would double-weight every window the user picked.
  if (body.replace_source) {
    await preferences.deleteMany({ user_id: userId, source: body.replace_source });
  }

  const docs = entries.map((entry) => ({
    user_id: userId,
    type: entry.type,
    value: entry.value,
    weight: entry.weight,
    source: entry.source,
    source_message_id: entry.source_message_id ?? null,
    created_at: new Date(),
  }));

  const result = await preferences.insertMany(docs);
  return ok({
    preferences: docs.map((d, i) => ({ ...d, _id: String(result.insertedIds[i]) })),
  });
});
