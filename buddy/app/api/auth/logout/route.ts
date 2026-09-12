// POST /api/auth/logout — clear the session cookie.
// POST, not GET, so a third-party <img src> can't log the user out.

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
