import type { ClaimIdRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { cancelClaim } from '../lib/services/claimActions';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return cancelClaim(deps, actor, await readJson<ClaimIdRequest>(req));
});
