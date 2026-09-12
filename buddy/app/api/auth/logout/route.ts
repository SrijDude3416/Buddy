// POST /api/auth/logout — clear the session cookie.
// POST, not GET, so a third-party <img src> can't log the user out.

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = clearSessionCookie(NextResponse.json({ ok: true }));
  response.cookies.set('buddy_demo', '', { path: '/', maxAge: 0 });
  response.cookies.set('buddy_mode', '', { path: '/', maxAge: 0 });
  return response;
}
