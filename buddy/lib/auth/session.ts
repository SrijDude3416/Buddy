// ---------------------------------------------------------------------------
// Session = a signed JWT in an httpOnly cookie. Ported from backend/lib/session.js.
//
// No session collection: the cookie is the session, signed with SESSION_SECRET
// so it cannot be forged, and short-lived enough that revocation-by-expiry is
// acceptable. The tradeoff to know: a stolen cookie stays valid until it
// expires, and "log out everywhere" is not possible without a server-side
// denylist. Both are fine for a student app; neither is fine for handling money.
//
// The JWT also carries the Google claims (sub/email/name/picture). With Mongo
// configured those are only a cache — lib/auth/users.ts reads through to the
// document. Without Mongo they are the whole user record; see that file for
// what that costs.
// ---------------------------------------------------------------------------

import { SignJWT, jwtVerify } from 'jose';
import type { NextResponse } from 'next/server';
import { authEnv } from './env';

export const COOKIE_NAME = 'buddy_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = {
  userId: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

function secretKey(): Uint8Array {
  const secret = authEnv.sessionSecret;
  if (secret.length < 32) {
    // Reaching here means a route tried to mint or read a session while the app
    // is in demo/unconfigured mode. That is a bug in the caller, not a runtime
    // condition to paper over with a weak fallback key.
    throw new Error(
      'SESSION_SECRET must be at least 32 characters — generate with: openssl rand -base64 48',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    google_sub: claims.googleSub,
    email: claims.email,
    name: claims.name,
    picture: claims.picture,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setIssuer('buddy')
    .setAudience('buddy-app')
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'buddy',
      audience: 'buddy-app',
    });
    return {
      userId: String(payload.sub),
      googleSub: String(payload.google_sub ?? ''),
      email: String(payload.email ?? ''),
      name: (payload.name as string | null) ?? null,
      picture: (payload.picture as string | null) ?? null,
    };
  } catch {
    // Expired, tampered with, or signed by an old secret — all mean "no session".
    return null;
  }
}

/** Read the session straight off the request, avoiding the async cookies() API. */
export async function getSession(request: Request): Promise<SessionClaims | null> {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  return readSessionToken(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)));
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    // Lax, not Strict: the OAuth callback is a cross-site top-level navigation
    // back from Google, and Strict would drop the cookie on that first hop.
    sameSite: 'lax',
    secure: authEnv.isProd,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: authEnv.isProd,
    path: '/',
    maxAge: 0,
  });
  return response;
}
