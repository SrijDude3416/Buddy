// ---------------------------------------------------------------------------
// The user record — optional by design.
//
// With MONGODB_URI set, this is SCHEMA.md's `users` collection and matches
// backend/lib/users.js exactly: upsert on the Google `sub`, profile fields only,
// nothing here is an optimizer input.
//
// Without it, the signed session cookie *is* the user record. That keeps the
// README's "no MongoDB required" promise for the demo, and it costs two things
// worth stating plainly rather than discovering later:
//
//   1. No read-through. The session route can normally re-read the document on
//      every request, so deleting an account immediately invalidates a cookie
//      that is still cryptographically valid. Cookie-only, a valid cookie is
//      valid until it expires — there is nothing to delete.
//   2. Nowhere to hang per-user state. `onboarding_complete`, preferences and
//      sessions all need a durable user id; cookie-only mode reports
//      onboarding_complete: false every time, because it genuinely cannot know.
//
// Both are fine for a demo and neither is fine for the real per-user product,
// which is why this degrades rather than pretending: set MONGODB_URI and the
// same sign-in starts persisting, with no other change anywhere.
// ---------------------------------------------------------------------------

import type { Collection, Document } from 'mongodb';
import { authEnv } from './env';
import type { GoogleClaims } from './google';
import type { SessionClaims } from './session';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  term: string;
  onboarding_complete: boolean;
};

/** The fixed student behind the zero-config demo. Never reachable in 'oauth' mode. */
export const DEMO_USER: PublicUser = {
  id: 'demo-student',
  email: 'demo@andrew.cmu.edu',
  name: 'Demo student',
  picture: null,
  term: 'F25',
  onboarding_complete: true,
};

export function isUserStoreConfigured(): boolean {
  return Boolean(authEnv.mongoUri);
}

// One MongoClient per process, cached across hot reloads and warm serverless
// invocations. Creating a client per request exhausts an Atlas free-tier
// connection limit almost immediately — the single most important thing to get
// right about Mongo on serverless.
const globalForMongo = globalThis as typeof globalThis & {
  __buddyAuthMongo?: Promise<Collection<Document>>;
};

function usersCollection(): Promise<Collection<Document>> {
  if (!globalForMongo.__buddyAuthMongo) {
    globalForMongo.__buddyAuthMongo = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(authEnv.mongoUri, {
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 8000,
        retryWrites: true,
      });
      await client.connect();
      return client.db(authEnv.mongoDb).collection('users');
    })().catch((err) => {
      // Don't cache a failed connection — the next request should retry.
      globalForMongo.__buddyAuthMongo = undefined;
      throw err;
    });
  }
  return globalForMongo.__buddyAuthMongo;
}

/**
 * Upsert on Google `sub`, not on email: an email can be reassigned between
 * people (a graduating student's Andrew ID being reissued is exactly this case),
 * while `sub` is a stable per-account identifier. Matching on email would hand a
 * new owner the previous person's schedule.
 */
export async function upsertUserFromGoogle(claims: GoogleClaims): Promise<PublicUser> {
  if (!isUserStoreConfigured()) {
    return {
      // Prefixed, and not a valid ObjectId, so a cookie minted in cookie-only
      // mode can never be mistaken for a real Mongo _id after one is configured.
      id: `google:${claims.sub}`,
      email: claims.email.toLowerCase(),
      name: claims.name ?? claims.email.split('@')[0],
      picture: claims.picture,
      term: 'F25',
      onboarding_complete: false,
    };
  }

  const users = await usersCollection();
  const now = new Date();
  const doc = await users.findOneAndUpdate(
    { google_sub: claims.sub },
    {
      $set: {
        email: claims.email.toLowerCase(),
        name: claims.name ?? claims.email.split('@')[0],
        picture: claims.picture ?? null,
        hosted_domain: claims.hd ?? null,
        last_login_at: now,
      },
      $setOnInsert: {
        google_sub: claims.sub,
        created_at: now,
        term: 'F25',
        onboarding_complete: false,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // upsert + returnDocument:'after' always yields a document; the driver's type
  // is nullable for the non-upsert case, so surface a real error rather than
  // asserting and letting a null reach the session token.
  const user = publicUser(doc);
  if (!user) throw new Error('User upsert returned no document');
  return user;
}

/**
 * Resolve the signed-in user for a request that already has a valid session.
 * Returns null when the account no longer exists, so a deleted user's still-valid
 * cookie stops working — only possible when a user store is configured.
 */
export async function loadUser(session: SessionClaims): Promise<PublicUser | null> {
  if (!isUserStoreConfigured()) {
    return {
      id: session.userId,
      email: session.email,
      name: session.name ?? session.email.split('@')[0],
      picture: session.picture,
      term: 'F25',
      onboarding_complete: false,
    };
  }

  const users = await usersCollection();
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(session.userId)) return null;
  const doc = await users.findOne({ _id: new ObjectId(session.userId) });
  return doc ? publicUser(doc) : null;
}

/** What the frontend is allowed to see about the signed-in user. */
export function publicUser(user: Document | null): PublicUser | null {
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
