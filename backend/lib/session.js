// ---------------------------------------------------------------------------
// Session = a signed JWT in an httpOnly cookie.
//
// No session collection: the cookie is the session, signed with SESSION_SECRET
// so it can't be forged, and short-lived enough that revocation-by-expiry is
// acceptable for now. The tradeoff to know: a stolen cookie stays valid until it
// expires, and "log out everywhere" isn't possible without a server-side
// denylist. Both are fine for a student app; neither is fine for handling money.
// ---------------------------------------------------------------------------

import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

const COOKIE_NAME = 'buddy_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secretKey() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSessionToken({ userId, email, name, picture }) {
  return new SignJWT({ email, name, picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('buddy')
    .setAudience('buddy-app')
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'buddy',
      audience: 'buddy-app',
    });
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    // Expired, tampered with, or signed by an old secret — all mean "no session".
    return null;
  }
}

/** Read the session straight off a NextRequest, avoiding the async cookies() API. */
export async function getSession(request) {
  return readSessionToken(request.cookies.get(COOKIE_NAME)?.value);
}

export function setSessionCookie(response, token) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    // Lax, not Strict: the OAuth callback is a cross-site top-level navigation
    // back from Google, and Strict would drop the cookie on that first hop.
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    maxAge: 0,
  });
  return response;
}

export { COOKIE_NAME };
