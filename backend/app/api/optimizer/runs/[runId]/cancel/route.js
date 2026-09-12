// POST /api/optimizer/runs/:runId/cancel

import { ok, fail, requireUser, route } from '../../../../../../lib/api.js';
import { cancelRun, serializeRun } from '../../../../../../lib/runs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request, { params }) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const { runId } = await params;
  const run = await cancelRun({ userId, runId });
  if (!run) return fail(404, 'not_found', 'No such optimizer run');

  return ok(serializeRun(run));
});
