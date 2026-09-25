import { Timestamp } from 'firebase-admin/firestore';
import {
  formatYyyyMm, isValidClaimId, sanitizeFileNamePart, validateAttachmentMeta,
  type UploadSessionRequest, type UploadSessionResponse,
} from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail, isAlreadyExists } from '../errors';
import { COL, getClaim } from '../firestore';
import { attachmentsFolderFor } from './attachmentsFolder';

interface UploadFolderDoc {
  uid: string;
  folderId: string;
  createdAt: Timestamp;
}

/** Binds a new claim's upload folder to the uid that first requests it, so a second requester can't hijack it. */
async function resolveNewClaimFolder(deps: Deps, actor: Actor, claimId: string): Promise<string> {
  const ref = deps.db.collection(COL.uploadFolders).doc(claimId);
  const snap = await ref.get();
  if (snap.exists) {
    const bound = snap.data() as UploadFolderDoc;
    if (bound.uid !== actor.uid) throw fail.forbidden();
    return bound.folderId;
  }

  const folderId = await attachmentsFolderFor(deps, formatYyyyMm(deps.now()).slice(0, 4), claimId);
  try {
    await ref.create({ uid: actor.uid, folderId, createdAt: Timestamp.fromDate(deps.now()) } satisfies UploadFolderDoc);
    return folderId;
  } catch (e) {
    if (!isAlreadyExists(e)) throw e;
    const bound = (await ref.get()).data() as UploadFolderDoc;
    if (bound.folderId !== folderId) {
      await deps.drive.trash(folderId).catch((err) => console.error('[uploadSession] trash duplicate folder failed', folderId, err));
    }
    if (bound.uid !== actor.uid) throw fail.forbidden();
    return bound.folderId;
  }
}

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
    folderId = await resolveNewClaimFolder(deps, actor, req.claimId);
  }

  const uploads = await Promise.all(
    req.files.map(async (f) => {
      const name = sanitizeFileNamePart(f.name) || 'attachment';
      return { name, uploadUrl: await deps.drive.createResumableUpload({ name, mimeType: f.mimeType, size: f.size, parentId: folderId }) };
    }),
  );
  return { folderId, uploads };
}
