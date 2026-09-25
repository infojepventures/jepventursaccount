import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle } from '../lib/http';
import { resyncSheet } from '../lib/services/sheetSync';

export default handle(async (req) => {
  const deps = getDeps();
  return resyncSheet(deps, await requireActor(deps, req));
});
