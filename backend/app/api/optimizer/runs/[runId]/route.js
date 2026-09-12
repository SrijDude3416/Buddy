// GET /api/optimizer/runs/:runId — the poll target for the generating screen.

import { ok, fail, requireUser, route } from '../../../../../lib/api.js';
import { getRun, serializeRun } from '../../../../../lib/runs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request, { params }) => {
  const { response, userId } = await requireUser(request);
  if (response) return response;

  const { runId } = await params;
  const run = await getRun({ userId, runId });
  if (!run) return fail(404, 'not_found', 'No such optimizer run');

  return ok(serializeRun(run));
});
