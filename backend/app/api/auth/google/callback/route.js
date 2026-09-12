// GET /api/auth/google/callback — Google sends the user back here.
//
// Verifies state (login CSRF), exchanges the code with PKCE, verifies the
// id_token signature/nonce/domain, upserts the user, then sets the session
// cookie and bounces to the app. Failures redirect back with a readable reason
// rather than dumping a stack trace in the browser.

import { NextResponse } from 'next/server';
import { completeAuth } from '../../../../../lib/google.js';
import { upsertUserFromGoogle } from '../../../../../lib/users.js';
import { createSessionToken, setSessionCookie } from '../../../../../lib/session.js';
import { env } from '../../../../../lib/env.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clearOAuthCookies(response) {
  for (const name of ['buddy_oauth_state', 'buddy_oauth_nonce', 'buddy_oauth_verifier', 'buddy_oauth_next']) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}

function backToApp(path, params = {}) {
  const target = new URL(path, env.appOrigin);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}

export async function GET(request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // The user hit "cancel" on Google's consent screen.
  if (params.get('error')) {
    return clearOAuthCookies(backToApp('/', { auth_error: params.get('error') }));
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = request.cookies.get('buddy_oauth_state')?.value;
  const expectedNonce = request.cookies.get('buddy_oauth_nonce')?.value;
  const codeVerifier = request.cookies.get('buddy_oauth_verifier')?.value;
  const next = request.cookies.get('buddy_oauth_next')?.value || '/';

  if (!code || !returnedState || !expectedState || !codeVerifier) {
    return clearOAuthCookies(
      backToApp('/', { auth_error: 'Sign-in session expired. Please try again.' }),
    );
  }

  // Constant-time-ish comparison isn't required for a random 256-bit value, but
  // the comparison itself is not optional: this is the login-CSRF gate.
  if (returnedState !== expectedState) {
    return clearOAuthCookies(backToApp('/', { auth_error: 'Sign-in verification failed.' }));
  }

  try {
    const claims = await completeAuth({ code, codeVerifier, expectedNonce });
    const user = await upsertUserFromGoogle(claims);

    const token = await createSessionToken({
      userId: String(user._id),
      email: user.email,
      name: user.name,
      picture: user.picture,
    });

    const response = backToApp(next, { signed_in: '1' });
    setSessionCookie(response, token);
    return clearOAuthCookies(response);
  } catch (err) {
    console.error('[auth] callback failed', err);
    const message =
      err.code === 'domain_not_allowed'
        ? err.message
        : env.isProd
          ? 'Sign-in failed. Please try again.'
          : `Sign-in failed: ${err.message}`;
    return clearOAuthCookies(backToApp('/', { auth_error: message }));
  }
}
