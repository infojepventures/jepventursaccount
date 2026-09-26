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
  /** Time of the latest upload session (refreshed on each one); the daily cleanup counts 24 h from here. */
  createdAt: Timestamp;
  /** Set by the daily cleanup once it has claimed the folder for trashing (see discardUploads.ts). */
  cleaning?: boolean;
}

/** Binds a new claim's upload folder to the uid that first requests it, so a second requester can't hijack it. */
async function resolveNewClaimFolder(deps: Deps, actor: Actor, claimId: string): Promise<string> {
  const ref = deps.db.collection(COL.uploadFolders).doc(claimId);
  // In a transaction with the cleanup's claim step, so an upload never lands in a folder being trashed.
  const existingFolder = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const bound = snap.data() as UploadFolderDoc;
    if (bound.uid !== actor.uid) throw fail.forbidden();
    if (bound.cleaning) throw fail.invalid('Receipts left unsubmitted for over 24 hours are being cleared. Please try again in a minute.');
    tx.update(ref, { createdAt: Timestamp.fromDate(deps.now()) });
    return bound.folderId;
  });
  if (existingFolder) return existingFolder;

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
