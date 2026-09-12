// GET /api/auth/session — who am I? The frontend calls this on load to decide
// between the sign-in screen and the app. Returns 200 with user: null rather
// than 401, because "not signed in" is a normal answer to this question.

import { ok, route } from '../../../../lib/api.js';
import { getSession } from '../../../../lib/session.js';
import { getUserById, publicUser } from '../../../../lib/users.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const session = await getSession(request);
  if (!session?.userId) return ok({ user: null });

  // Read through to the document so a deleted account can't keep using a cookie
  // that is still cryptographically valid.
  const user = await getUserById(session.userId);
  if (!user) return ok({ user: null });

  return ok({ user: publicUser(user) });
});
