// GET /api/auth/session — who am I?
//
// The frontend calls this on load to decide between the sign-in screen and the
// app. Returns 200 with user: null rather than 401, because "not signed in" is a
// normal answer to this question, not an error.
//
// `auth_mode` is here so the sign-in screen can tell the difference between
// "click to sign in" and "this deployment has no Google credentials" — a dead
// button with no explanation is the worst thing to hand someone on demo day.

import { NextResponse } from 'next/server';
import { authMode } from '@/lib/auth/env';
import { getSession } from '@/lib/auth/session';
import { DEMO_USER, loadUser } from '@/lib/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const mode = authMode();

  // The zero-config demo: one fixed student, no cookie, no Google project.
  if (mode === 'demo') {
    return NextResponse.json({ user: DEMO_USER, auth_mode: mode });
  }

  // Production with no Google credentials. Fail closed — never fall back to the
  // demo student here, or a dropped env var silently opens the app to everyone.
  if (mode === 'unconfigured') {
    return NextResponse.json({ user: null, auth_mode: mode });
  }

  try {
    const session = await getSession(request);
    if (!session?.userId) return NextResponse.json({ user: null, auth_mode: mode });

    // Read through to the stored document when there is one, so a deleted
    // account cannot keep using a cookie that is still cryptographically valid.
    const user = await loadUser(session);
    return NextResponse.json({ user, auth_mode: mode });
  } catch (err) {
    console.error('[auth] session lookup failed', err);
    return NextResponse.json(
      { code: 'server_error', message: 'Could not check your sign-in status.' },
      { status: 500 },
    );
  }
}
