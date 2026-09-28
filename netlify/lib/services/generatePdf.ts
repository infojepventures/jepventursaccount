import { Timestamp } from 'firebase-admin/firestore';
import { claimPdfFileName, driveFileUrl, refNoYear, type ClaimDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { errorMessage } from '../errors';
import { claimRef, getClaim } from '../firestore';
import { buildClaimPdf, toPdfInput, type PdfAttachment } from '../pdf/buildClaimPdf';
import { markPdfFailed } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

/** Best effort: a PDF is still usable (shared with its full Drive link) when shortening is off or fails. */
async function shortenPdfLink(deps: Deps, fileId: string): Promise<string | null> {
  if (!deps.shortener) return null;
  try {
    return await deps.shortener.shorten(driveFileUrl(fileId));
  } catch (e) {
    console.error('[generatePdf] shortening the PDF link failed', fileId, e);
    return null;
  }
}

/** The claim's current PDF file, when it is still there to be overwritten in place. */
async function existingPdfId(deps: Deps, claim: ClaimDoc): Promise<string | null> {
  const id = claim.pdf.driveFileId;
  if (!id) return null;
  const meta = await deps.drive.getFile(id);
  return meta && !meta.trashed ? id : null;
}

/**
 * Builds the claim's PDF and saves it to Drive. A claim keeps one PDF file for life: later versions (approved,
 * paid, cancelled...) overwrite and rename that same file, so its Drive link and short link never change.
 */
export async function generatePdf(
  deps: Deps,
  claimId: string,
  requestId: string,
): Promise<'done' | 'superseded' | 'failed'> {
  const claim = await getClaim(deps.db, claimId);
  if (!claim || claim.pdf.requestId !== requestId) return 'superseded';

  let uploadedId: string | null = null;
  try {
    const assets = await deps.loadPdfAssets();
    const files: PdfAttachment[] = [];
    for (const a of claim.attachments) files.push({ mimeType: a.mimeType, data: await deps.drive.download(a.driveFileId) });
    // The bank slip goes after the receipts once the claim is paid.
    const slip = claim.status === 'paid' ? claim.paidInfo?.slip : null;
    if (slip) files.push({ mimeType: slip.mimeType, data: await deps.drive.download(slip.driveFileId) });
    const bytes = await buildClaimPdf(toPdfInput(claim, deps.now()), files, assets);
    const fileName = claimPdfFileName(claim.refNo, claim.payment.accountHolder, claim.totalCents, claim.status);

    const existingId = await existingPdfId(deps, claim);
    let fileId: string;
    if (existingId) {
      // Don't overwrite the shared file with a version that is already out of date.
      if ((await getClaim(deps.db, claimId))?.pdf.requestId !== requestId) return 'superseded';
      await deps.drive.overwrite(existingId, { name: fileName, mimeType: 'application/pdf', data: bytes });
      fileId = existingId;
    } else {
      const yearFolder = await deps.drive.findOrCreateFolder(deps.rootFolderId, refNoYear(claim.refNo));
      uploadedId = (await deps.drive.upload({ name: fileName, mimeType: 'application/pdf', parentId: yearFolder, data: bytes })).id;
      fileId = uploadedId;
    }
    const shortUrl = (existingId && claim.pdf.shortUrl) || (await shortenPdfLink(deps, fileId));

    const ref = claimRef(deps.db, claimId);
    const outcome = await deps.db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as ClaimDoc | undefined;
      if (!cur || cur.pdf.requestId !== requestId) {
        return { superseded: true as const, newerReady: cur?.pdf.status === 'ready' ? cur.pdf.requestId : null };
      }
      tx.update(ref, {
        pdf: { status: 'ready', requestId, requestedAt: cur.pdf.requestedAt, driveFileId: fileId, fileName, error: null, shortUrl },
        updatedAt: Timestamp.fromDate(deps.now()),
      });
      return { superseded: false as const, oldId: cur.pdf.driveFileId };
    });
    const created = uploadedId;
    uploadedId = null; // committed or handled below; never trash it in the catch

    if (outcome.superseded) {
      if (created) {
        await deps.drive.trash(created).catch((e) => console.error('[generatePdf] trash superseded failed', created, e));
      } else if (outcome.newerReady) {
        // A newer version finished while this one was writing, and this write may have landed on top of it:
        // write the current version again.
        return generatePdf(deps, claimId, outcome.newerReady);
      }
      return 'superseded';
    }
    if (outcome.oldId && outcome.oldId !== fileId) {
      await deps.drive.trash(outcome.oldId).catch((e) => console.error('[generatePdf] trash old PDF failed', outcome.oldId, e));
    }
    await deps.drive
      .rename(claim.attachmentsFolderId, fileName.replace(/\.pdf$/, ''))
      .catch((e) => console.error('[generatePdf] rename attachments folder failed', claim.attachmentsFolderId, e));
    await syncClaimToSheet(deps, claimId);
    return 'done';
  } catch (e) {
    console.error('[generatePdf] failed', claimId, e);
    if (uploadedId) {
      await deps.drive.trash(uploadedId).catch((e2) => console.error('[generatePdf] trash on failure also failed', uploadedId, e2));
    }
    await markPdfFailed(deps, claimId, requestId, errorMessage(e));
    return 'failed';
  }
}
