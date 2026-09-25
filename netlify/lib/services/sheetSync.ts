import type { ClaimDoc, ResyncSheetResponse } from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import { toSheetRow } from '../claimRow';
import type { Deps } from '../deps';
import { claimRef, COL } from '../firestore';

/** Mirrors one claim to the Sheet. Never throws; records the outcome in `sheetSynced`. */
export async function syncClaimToSheet(deps: Deps, claimId: string): Promise<boolean> {
  const ref = claimRef(deps.db, claimId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return false;
    await deps.sheets.upsertClaimRow(claimId, toSheetRow(claimId, snap.data() as ClaimDoc));
    await ref.update({ sheetSynced: true });
    return true;
  } catch (e) {
    console.error('[sheetSync] failed', claimId, e);
    await ref.update({ sheetSynced: false }).catch(() => undefined);
    return false;
  }
}

export async function resyncSheet(deps: Deps, actor: Actor): Promise<ResyncSheetResponse> {
  assertAdmin(actor);
  const snap = await deps.db.collection(COL.claims).where('sheetSynced', '==', false).get();
  let synced = 0;
  let failed = 0;
  for (const d of snap.docs) {
    if (await syncClaimToSheet(deps, d.id)) synced++;
    else failed++;
  }
  return { synced, failed };
}
