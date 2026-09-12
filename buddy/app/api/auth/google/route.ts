// GET /api/auth/google — start CMU sign-in.
// Stashes state/nonce/PKCE in short-lived httpOnly cookies, then redirects to
// Google. Nothing sensitive goes in the URL.

import { NextResponse } from 'next/server';
import { beginAuth } from '@/lib/auth/google';
import { appOrigin, authEnv, authMode, redirectUri } from '@/lib/auth/env';

export const runtime = 'nodejs';
// Never cache a redirect carrying a one-time state value.
export const dynamic = 'force-dynamic';

const TEN_MINUTES = 600;

/** Only same-origin paths, so an open redirect can't be smuggled through ?next. */
function safeNext(request: Request): string {
  const requested = new URL(request.url).searchParams.get('next') ?? '/';
  return requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
}

export async function GET(request: Request) {
  const mode = authMode();
  const next = safeNext(request);
  const home = new URL(next, appOrigin(request));

  // No Google project configured, and this deployment is running the zero-config
  // demo: /auth/session already reports the demo student, so just bounce back in.
  if (mode === 'demo') {
    home.searchParams.set('signed_in', '1');
    return NextResponse.redirect(home);
  }

  if (mode === 'unconfigured') {
    home.searchParams.set(
      'auth_error',
      'Sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET.',
    );
    return NextResponse.redirect(home);
  }

  const { url, state, nonce, codeVerifier } = await beginAuth(redirectUri(request));

  const response = NextResponse.redirect(url);
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: authEnv.isProd,
    path: '/',
    maxAge: TEN_MINUTES,
  };
  response.cookies.set('buddy_oauth_state', state, opts);
  response.cookies.set('buddy_oauth_nonce', nonce, opts);
  response.cookies.set('buddy_oauth_verifier', codeVerifier, opts);
  response.cookies.set('buddy_oauth_next', next, opts);
  return response;
}
