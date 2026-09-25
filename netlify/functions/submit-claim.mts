import type { SubmitClaimRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { submitClaim } from '../lib/services/submitClaim';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return submitClaim(deps, actor, await readJson<SubmitClaimRequest>(req));
});
