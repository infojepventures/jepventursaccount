import type { MarkPaidRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { markPaid } from '../lib/services/claimActions';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return markPaid(deps, actor, await readJson<MarkPaidRequest>(req));
});
