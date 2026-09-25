import type { AdminUsersRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { adminUsers } from '../lib/services/adminUsers';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return adminUsers(deps, actor, await readJson<AdminUsersRequest>(req));
});
