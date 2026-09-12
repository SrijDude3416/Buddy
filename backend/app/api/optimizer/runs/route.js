// POST /api/optimizer/runs — kick off a solve. Returns the run the generating
// screen then polls.

import { ok, requireUser, route } from '../../../../lib/api.js';
import { startRun, serializeRun } from '../../../../lib/runs.js';
import { markOnboardingComplete } from '../../../../lib/users.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const run = await startRun({
    userId,
    runContext: body.run_context,
    horizonDays: body.horizon_days ?? 7,
  });

  if (run.status === 'solved') await markOnboardingComplete(userId);

  return ok(serializeRun(run));
});
