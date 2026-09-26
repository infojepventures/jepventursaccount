import type { ReviewClaimRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { reviewClaim } from '../lib/services/reviewClaim';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return reviewClaim(deps, actor, await readJson<ReviewClaimRequest>(req));
});
