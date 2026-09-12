// POST /api/sessions/:sessionId/nudge — the thumbs-down.
//
// Deliberately not a direct edit. A nudge appends a typed preference entry and
// then re-places the session, so the reason the schedule changed is recorded in
// `preferences` where the solver will read it on the next full solve. If this
// just moved the block, the next re-solve would put it straight back.

import { ok, fail, requireUser, route } from '../../../../../lib/api.js';
import { collections } from '../../../../../lib/mongo.js';
import { addMinutesIso } from '../../../../../lib/time.js';
import { SLOT_MINUTES } from '../../../../../lib/preferenceCatalog.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request, { params }) => {
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
  if (session.locked) return fail(409, 'session_locked', 'That block is fixed and cannot be moved');

  const startDate = new Date(session.start);
  const startSlot = Math.floor((startDate.getHours() * 60 + startDate.getMinutes()) / SLOT_MINUTES);

  const preference = {
    user_id: userId,
    type: 'avoid_block',
    value: { start_slot: startSlot, end_slot: startSlot + 4, hard: false },
    weight: 0.6,
    source: 'chat',
    source_message_id: null,
    created_at: new Date(),
  };
  const { insertedId } = await c.preferences.insertOne(preference);

  const start = addMinutesIso(session.start, 60);
  const end = addMinutesIso(start, session.duration_min);
  await c.sessions.updateOne(filter, { $set: { start, end } });

  return ok({
    session: {
      ...session,
      _id: String(session._id),
      task_id: session.task_id ? String(session.task_id) : null,
      start,
      end,
    },
    preference: { ...preference, _id: String(insertedId) },
  });
});
