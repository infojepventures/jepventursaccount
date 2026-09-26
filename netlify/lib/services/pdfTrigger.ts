import type { ClaimDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { errorMessage } from '../errors';
import { claimRef } from '../firestore';
import { syncClaimToSheet } from './sheetSync';

/** Marks the PDF failed, but only if `requestId` is still the latest request. */
export async function markPdfFailed(deps: Deps, claimId: string, requestId: string, error: string): Promise<void> {
  const ref = claimRef(deps.db, claimId);
  const updated = await deps.db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as ClaimDoc | undefined;
    if (!cur || cur.pdf.requestId !== requestId) return false;
    tx.update(ref, { 'pdf.status': 'failed', 'pdf.error': error.slice(0, 500) });
    return true;
  });
  if (updated) await syncClaimToSheet(deps, claimId);
}

export async function startPdf(deps: Deps, claimId: string, requestId: string): Promise<void> {
  try {
    await deps.triggerPdf(claimId, requestId);
  } catch (e) {
    console.error('[startPdf] trigger failed', claimId, e);
    await markPdfFailed(deps, claimId, requestId, `Could not start PDF generation: ${errorMessage(e)}`);
  }
}
