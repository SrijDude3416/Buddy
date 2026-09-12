// POST /api/auth/logout — clear the session cookie.
// POST, not GET, so a third-party <img src> can't log the user out.

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '../../../../lib/session.js';
import { route } from '../../../../lib/api.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async () => clearSessionCookie(NextResponse.json({ ok: true })));
