import type { UnregisterPushTokenRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { unregisterPushToken } from '../lib/services/pushTokens';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return unregisterPushToken(deps, actor, await readJson<UnregisterPushTokenRequest>(req));
});
