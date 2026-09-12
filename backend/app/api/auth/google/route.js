// GET /api/auth/google — start the CMU sign-in.
// Stashes state/nonce/PKCE in short-lived httpOnly cookies, then redirects to
// Google. Nothing sensitive is put in the URL.

import { NextResponse } from 'next/server';
import { beginAuth } from '../../../../lib/google.js';
import { env } from '../../../../lib/env.js';
import { route } from '../../../../lib/api.js';

export const runtime = 'nodejs';
// Never cache a redirect that carries a one-time state value.
export const dynamic = 'force-dynamic';

const TEN_MINUTES = 600;

export const GET = route(async (request) => {
  const { url, state, nonce, codeVerifier } = await beginAuth();

  // Where to land after login; only same-origin paths, so an open redirect
  // can't be smuggled in through the query string.
  const requested = new URL(request.url).searchParams.get('next') ?? '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const response = NextResponse.redirect(url);
  const opts = { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', maxAge: TEN_MINUTES };
  response.cookies.set('buddy_oauth_state', state, opts);
  response.cookies.set('buddy_oauth_nonce', nonce, opts);
  response.cookies.set('buddy_oauth_verifier', codeVerifier, opts);
  response.cookies.set('buddy_oauth_next', next, opts);
  return response;
});
