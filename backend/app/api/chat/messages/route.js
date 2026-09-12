// GET/POST /api/chat/messages — the sidebar transcript.
//
// The important rule, from SCHEMA.md: a resource request is a lookup, never a
// scheduling constraint, so it must not become a `preferences` entry. Only a
// reschedule-shaped message writes one. Getting this backwards would mean asking
// for help on a topic quietly re-weights your schedule.

import { ok, requireUser, route } from '../../../../lib/api.js';
import { collections } from '../../../../lib/mongo.js';
import { addMinutesIso } from '../../../../lib/time.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const c = await collections();
  const messages = await c.chatMessages.find({ user_id: userId }).sort({ timestamp: 1 }).limit(200).toArray();
  return ok({ messages: messages.map((m) => ({ ...m, _id: String(m._id) })) });
});

export const POST = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const text = String(body.text ?? '').trim();
  const context = body.context ?? null;

  const c = await collections();
  const now = new Date();

  const userMsg = { user_id: userId, role: 'user', text, timestamp: now, context };
  const { insertedId: userMsgId } = await c.chatMessages.insertOne(userMsg);

  const isResourceRequest = Boolean(context?.topic) || /resource|explain|help me understand/i.test(text);

  let planChanged = false;
  if (!isResourceRequest) {
    const movable = await c.sessions.findOne({
      user_id: userId,
      type: 'flexible',
      locked: false,
      completed: false,
    });
    if (movable) {
      await c.preferences.insertOne({
        user_id: userId,
        type: 'weight_adjustment',
        value: { task_id: String(movable.task_id), multiplier: 1.25 },
        weight: 0.7,
        source: 'chat',
        // The traceability link: this entry exists because of that message.
        source_message_id: String(userMsgId),
        created_at: now,
      });
      const start = addMinutesIso(movable.start, -60);
      await c.sessions.updateOne(
        { _id: movable._id, user_id: userId },
        { $set: { start, end: addMinutesIso(start, movable.duration_min) } },
      );
      planChanged = true;
    }
  }

  // Placeholder replies. This is the seam where Gemini goes: it reads the
  // transcript plus context and emits typed preference entries — it never writes
  // to `sessions` directly.
  const botText = isResourceRequest
    ? "Here's where I'd start: a worked-examples set and a short explainer. Resource lookup isn't wired to a real index yet."
    : planChanged
      ? 'Got it — I logged that as a preference and moved the next session earlier.'
      : "Noted. There's nothing movable left in this week to apply it to yet.";

  const botMsg = { user_id: userId, role: 'bot', text: botText, timestamp: new Date(), context };
  const { insertedId: botMsgId } = await c.chatMessages.insertOne(botMsg);

  return ok({
    messages: [
      { ...userMsg, _id: String(userMsgId) },
      { ...botMsg, _id: String(botMsgId) },
    ],
    plan_changed: planChanged,
  });
});
