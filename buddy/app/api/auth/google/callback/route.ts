// GET /api/auth/google/callback — Google sends the user back here.
//
// Verifies state (login CSRF), exchanges the code with PKCE, verifies the
// id_token signature/nonce/domain, upserts the user, then sets the session
// cookie and bounces to the app. Failures redirect back with a readable reason
// rather than dumping a stack trace in the browser.

import { NextResponse } from 'next/server';
import { completeAuth, DomainNotAllowedError } from '@/lib/auth/google';
import { upsertUserFromGoogle } from '@/lib/auth/users';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { appOrigin, authEnv, authMode, redirectUri } from '@/lib/auth/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OAUTH_COOKIES = [
  'buddy_oauth_state',
  'buddy_oauth_nonce',
  'buddy_oauth_verifier',
  'buddy_oauth_next',
];

function clearOAuthCookies(response: NextResponse): NextResponse {
  for (const name of OAUTH_COOKIES) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}

function cookieValue(request: Request, name: string): string | undefined {
  const match = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function backToApp(request: Request, path: string, params: Record<string, string | null> = {}) {
  const target = new URL(path, appOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  // A callback arriving while the app is not in oauth mode means stale state or
  // a mid-flight config change. There is no token to verify against, so refuse.
  if (authMode() !== 'oauth') {
    return clearOAuthCookies(
      backToApp(request, '/', { auth_error: 'Sign-in is not enabled on this deployment.' }),
    );
  }

  const params = new URL(request.url).searchParams;

  // The user hit "cancel" on Google's consent screen.
  if (params.get('error')) {
    return clearOAuthCookies(backToApp(request, '/', { auth_error: params.get('error') }));
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = cookieValue(request, 'buddy_oauth_state');
  const expectedNonce = cookieValue(request, 'buddy_oauth_nonce');
  const codeVerifier = cookieValue(request, 'buddy_oauth_verifier');
  const next = cookieValue(request, 'buddy_oauth_next') || '/';

  if (!code || !returnedState || !expectedState || !codeVerifier) {
    return clearOAuthCookies(
      backToApp(request, '/', { auth_error: 'Sign-in session expired. Please try again.' }),
    );
  }

  // A constant-time compare isn't required for a random 256-bit value, but the
  // comparison itself is not optional: this is the login-CSRF gate.
  if (returnedState !== expectedState) {
    return clearOAuthCookies(backToApp(request, '/', { auth_error: 'Sign-in verification failed.' }));
  }

  try {
    const claims = await completeAuth({
      code,
      codeVerifier,
      expectedNonce,
      redirectUri: redirectUri(request),
    });
    const user = await upsertUserFromGoogle(claims);

    const token = await createSessionToken({
      userId: user.id,
      googleSub: claims.sub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    });

    const response = backToApp(request, next, { signed_in: '1' });
    setSessionCookie(response, token);
    return clearOAuthCookies(response);
  } catch (err) {
    console.error('[auth] callback failed', err);
    const message =
      err instanceof DomainNotAllowedError
        ? err.message
        : authEnv.isProd
          ? 'Sign-in failed. Please try again.'
          : `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
    return clearOAuthCookies(backToApp(request, '/', { auth_error: message }));
  }
}
