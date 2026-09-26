import type { DiscardUploadRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { discardUploads } from '../lib/services/discardUploads';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return discardUploads(deps, actor, await readJson<DiscardUploadRequest>(req));
});
