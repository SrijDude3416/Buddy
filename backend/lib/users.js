// ---------------------------------------------------------------------------
// User records. `users` stays profile-only per SCHEMA.md — nothing here is an
// optimizer input, and onboarding answers live in `preferences`, not here.
// ---------------------------------------------------------------------------

import { collections } from './mongo.js';

/**
 * Upsert on Google `sub`, not on email: an email can be reassigned between
 * people (a graduating student's andrew ID being reissued is exactly this case),
 * while `sub` is a stable per-account identifier. Matching on email would hand a
 * new owner the previous person's data.
 */
export async function upsertUserFromGoogle({ sub, email, name, picture, hd }) {
  const { users } = await collections();
  const now = new Date();

  const result = await users.findOneAndUpdate(
    { google_sub: sub },
    {
      $set: {
        email: email.toLowerCase(),
        name: name ?? email.split('@')[0],
        picture: picture ?? null,
        hosted_domain: hd ?? null,
        last_login_at: now,
      },
      $setOnInsert: {
        google_sub: sub,
        created_at: now,
        term: 'F25',
        onboarding_complete: false,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  return result;
}

export async function getUserById(userId) {
  const { users } = await collections();
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(userId)) return null;
  return users.findOne({ _id: new ObjectId(userId) });
}

export async function markOnboardingComplete(userId) {
  const { users } = await collections();
  const { ObjectId } = await import('mongodb');
  await users.updateOne({ _id: new ObjectId(userId) }, { $set: { onboarding_complete: true } });
}

/** What the frontend is allowed to see about the signed-in user. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    picture: user.picture ?? null,
    term: user.term ?? 'F25',
    onboarding_complete: Boolean(user.onboarding_complete),
  };
}
