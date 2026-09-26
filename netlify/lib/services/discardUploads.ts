import { Timestamp } from 'firebase-admin/firestore';
import { isValidClaimId, MAX_ATTACHMENTS, type DiscardUploadRequest, type DiscardUploadResponse } from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, getClaim } from '../firestore';

/** A new claim's uploads are kept this long without a submit before the scheduled cleanup trashes them. */
export const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 200;

interface UploadFolderDoc {
  uid: string;
  folderId: string;
  createdAt: Timestamp;
}

/**
 * Trashes receipts the applicant removed from the form before saving. On a new (unsaved) claim any file in
 * its bound upload folder may go; on a rejected claim being resubmitted only files uploaded since, never the
 * claim's saved attachments (those are trashed by submitClaim once the resubmission actually replaces them).
 */
export async function discardUploads(deps: Deps, actor: Actor, req: DiscardUploadRequest): Promise<DiscardUploadResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  const fileIds = req.fileIds;
  if (!Array.isArray(fileIds) || fileIds.length === 0 || fileIds.length > MAX_ATTACHMENTS || !fileIds.every((id) => typeof id === 'string' && id)) {
    throw fail.invalid('Invalid fileIds');
  }

  let folderId: string;
  const keep = new Set<string>();
  const claim = await getClaim(deps.db, req.claimId);
  if (claim) {
    assertCan('resubmit', claim, actor);
    folderId = claim.attachmentsFolderId;
    for (const a of claim.attachments) keep.add(a.driveFileId);
  } else {
    const snap = await deps.db.collection(COL.uploadFolders).doc(req.claimId).get();
    if (!snap.exists) return { trashed: 0 };
    const bound = snap.data() as UploadFolderDoc;
    if (bound.uid !== actor.uid) throw fail.forbidden();
    folderId = bound.folderId;
  }

  let trashed = 0;
  for (const id of new Set(fileIds)) {
    if (keep.has(id)) continue;
    const meta = await deps.drive.getFile(id);
    if (!meta || meta.trashed || !meta.parents.includes(folderId)) continue;
    await deps.drive.trash(id);
    trashed++;
  }
  return { trashed };
}

/**
 * Scheduled: a new claim whose receipts were uploaded but that was never submitted (app closed, form
 * abandoned) leaves an upload folder behind. Trash those older than ABANDONED_UPLOAD_MS, and drop the
 * binding for claims that were submitted (their folder now belongs to the claim).
 */
export async function cleanupAbandonedUploads(deps: Deps): Promise<{ trashed: number; forgotten: number }> {
  const cutoff = Timestamp.fromDate(new Date(deps.now().getTime() - ABANDONED_UPLOAD_MS));
  const snap = await deps.db.collection(COL.uploadFolders).where('createdAt', '<', cutoff).limit(CLEANUP_BATCH).get();

  let trashed = 0;
  let forgotten = 0;
  for (const doc of snap.docs) {
    const { folderId } = doc.data() as UploadFolderDoc;
    if (await getClaim(deps.db, doc.id)) {
      forgotten++;
    } else {
      try {
        await deps.drive.trash(folderId);
        trashed++;
      } catch (e) {
        // Keep the binding so the next run retries.
        console.error('[cleanupAbandonedUploads] trash failed', doc.id, folderId, e);
        continue;
      }
    }
    await doc.ref.delete();
  }
  return { trashed, forgotten };
}
