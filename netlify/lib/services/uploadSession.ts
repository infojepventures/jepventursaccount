import {
  formatYyyyMm, isValidClaimId, sanitizeFileNamePart, validateAttachmentMeta,
  type UploadSessionRequest, type UploadSessionResponse,
} from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { getClaim } from '../firestore';
import { attachmentsFolderFor } from './attachmentsFolder';

export async function createUploadSessions(
  deps: Deps,
  actor: Actor,
  req: UploadSessionRequest,
): Promise<UploadSessionResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  const errors = validateAttachmentMeta(req.files);
  if (errors.length) throw fail.invalid(errors.join('; '));

  const existing = await getClaim(deps.db, req.claimId);
  let folderId: string;
  if (existing) {
    assertCan('resubmit', existing, actor);
    folderId = existing.attachmentsFolderId;
  } else {
    folderId = await attachmentsFolderFor(deps, formatYyyyMm(deps.now()).slice(0, 4), req.claimId);
  }

  const uploads: UploadSessionResponse['uploads'] = [];
  for (const f of req.files) {
    const name = sanitizeFileNamePart(f.name) || 'attachment';
    uploads.push({
      name,
      uploadUrl: await deps.drive.createResumableUpload({ name, mimeType: f.mimeType, size: f.size, parentId: folderId }),
    });
  }
  return { folderId, uploads };
}
