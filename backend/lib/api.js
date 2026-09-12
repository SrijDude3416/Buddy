// Shared response helpers + the auth guard every data route goes through.

import { NextResponse } from 'next/server';
import { getSession } from './session.js';

export function ok(body, init = {}) {
  return NextResponse.json(body, { status: 200, ...init });
}

export function fail(status, code, message) {
  // Matches the shape frontend/src/lib/errors.js already parses.
  return NextResponse.json({ code, message }, { status });
}

/**
 * Every data route calls this first. Returns the session or a 401 response —
 * callers must check for `.response` before using `.session`.
 *
 * This is the only place user identity is established, so there is exactly one
 * place to audit for "can this request see someone else's data".
 */
export async function requireUser(request) {
  const session = await getSession(request);
  if (!session?.userId) {
    return { response: fail(401, 'unauthenticated', 'Sign in to continue.') };
  }
  return { session, userId: session.userId };
}

/** Wrap a handler so a thrown error becomes a clean JSON 500, never an HTML page. */
export function route(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      // Config mistakes are the most common cause here and are worth surfacing
      // verbatim in dev; in prod keep the detail server-side.
      console.error('[api] unhandled error', err);
      const message =
        process.env.NODE_ENV === 'production'
          ? 'Something went wrong on the server.'
          : err.message || String(err);
      return fail(500, 'server_error', message);
    }
  };
}

export const runtime = 'nodejs';
