import type { UploadSessionRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { createUploadSessions } from '../lib/services/uploadSession';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return createUploadSessions(deps, actor, await readJson<UploadSessionRequest>(req));
});
