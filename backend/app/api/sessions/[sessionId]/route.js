// PATCH /api/sessions/:sessionId — mark done, lock, or move.
//
// A locked session refuses a move with 409. That is the fixed-vs-flexible rule
// enforced at the data boundary rather than trusted to the UI: the calendar
// doesn't offer to drag a lecture, but an API that allowed it would let any
// client break the one invariant the solver depends on.

import { ok, fail, requireUser, route } from '../../../../lib/api.js';
import { collections } from '../../../../lib/mongo.js';
import { addMinutesIso } from '../../../../lib/time.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(async (request, { params }) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const { sessionId } = await params;
  // Session _ids are the readable strings the plan engine generates, not
  // ObjectIds — see lib/planEngine.js. Validating them as ObjectIds would 404
  // every real session.
  if (!sessionId) return fail(404, 'not_found', 'No such session');

  const c = await collections();
  // user_id in the filter, never checked after the fetch: this is the line
  // standing between one account and another's data.
  const filter = { _id: sessionId, user_id: userId };
  const session = await c.sessions.findOne(filter);
  if (!session) return fail(404, 'not_found', 'No such session');

  const body = await request.json().catch(() => ({}));

  if (session.locked && body.start) {
    return fail(409, 'session_locked', 'Locked sessions cannot be moved');
  }

  const updates = {};
  if (typeof body.completed === 'boolean') updates.completed = body.completed;
  if (typeof body.locked === 'boolean') updates.locked = body.locked;
  if (body.start) {
    updates.start = body.start;
    updates.end = addMinutesIso(body.start, session.duration_min);
  }
  if (!Object.keys(updates).length) {
    return fail(422, 'nothing_to_update', 'No supported fields in the request body');
  }

  await c.sessions.updateOne(filter, { $set: updates });
  const updated = { ...session, ...updates };

  return ok({
    session: { ...updated, _id: String(updated._id), task_id: updated.task_id ? String(updated.task_id) : null },
  });
});
