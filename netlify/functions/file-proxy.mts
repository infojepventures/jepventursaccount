import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle } from '../lib/http';
import { openClaimFile } from '../lib/services/fileAccess';

export default handle(
  async (req) => {
    const deps = getDeps();
    const actor = await requireActor(deps, req);
    const url = new URL(req.url);
    return openClaimFile(deps, actor, url.searchParams.get('claimId'), url.searchParams.get('fileId'));
  },
  { method: 'GET' },
);
