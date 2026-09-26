import type { AnalyzeAttachmentRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { analyzeAttachment } from '../lib/services/analyzeAttachment';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return analyzeAttachment(deps, actor, await readJson<AnalyzeAttachmentRequest>(req));
});
