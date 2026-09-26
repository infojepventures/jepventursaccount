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
    const bytes = await buildClaimPdf(toPdfInput(claim, deps.now()), files, assets);
    const fileName = claimPdfFileName(claim.refNo, claim.payment.accountHolder, claim.totalCents);
    const yearFolder = await deps.drive.findOrCreateFolder(deps.rootFolderId, refNoYear(claim.refNo));
    uploadedId = (await deps.drive.upload({ name: fileName, mimeType: 'application/pdf', parentId: yearFolder, data: bytes })).id;
    const newId = uploadedId;
    const shortUrl = await shortenPdfLink(deps, newId);

    const ref = claimRef(deps.db, claimId);
    const outcome = await deps.db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as ClaimDoc | undefined;
      if (!cur || cur.pdf.requestId !== requestId) return { superseded: true as const };
      tx.update(ref, {
        pdf: { status: 'ready', requestId, requestedAt: cur.pdf.requestedAt, driveFileId: newId, fileName, error: null, shortUrl },
        updatedAt: Timestamp.fromDate(deps.now()),
      });
      return { superseded: false as const, oldId: cur.pdf.driveFileId };
    });
    uploadedId = null; // committed or about to be trashed below; never trash it in the catch

    if (outcome.superseded) {
      await deps.drive.trash(newId).catch((e) => console.error('[generatePdf] trash superseded failed', newId, e));
      return 'superseded';
    }
    if (outcome.oldId && outcome.oldId !== newId) {
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
