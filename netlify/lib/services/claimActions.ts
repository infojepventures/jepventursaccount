import { Timestamp } from 'firebase-admin/firestore';
import {
  isValidClaimId, isValidYmd, PDF_STUCK_AFTER_MS,
  type ClaimDoc, type ClaimIdRequest, type HistoryAction, type MarkPaidRequest, type StatusResponse,
} from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { claimRef } from '../firestore';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

/** Runs `mutate` on the current claim inside a transaction, then mirrors the claim to the Sheet. */
async function transition(
  deps: Deps,
  claimId: unknown,
  mutate: (cur: ClaimDoc, now: Timestamp) => Record<string, unknown>,
): Promise<void> {
  if (!isValidClaimId(claimId)) throw fail.invalid('Invalid claimId');
  const ref = claimRef(deps.db, claimId);
  const now = Timestamp.fromDate(deps.now());
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Claim not found');
    tx.update(ref, { ...mutate(snap.data() as ClaimDoc, now), updatedAt: now });
  });
  await syncClaimToSheet(deps, claimId);
}

const history = (cur: ClaimDoc, actor: Actor, action: HistoryAction, at: Timestamp, note: string | null = null) => [
  ...cur.history,
  { action, byUid: actor.uid, byName: actor.name, at, note },
];

export async function cancelClaim(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<StatusResponse> {
  await transition(deps, req?.claimId, (cur, now) => {
    assertCan('cancel', cur, actor);
    return { status: 'cancelled', history: history(cur, actor, 'cancel', now) };
  });
  return { status: 'cancelled' };
}

export async function markPaid(deps: Deps, actor: Actor, req: MarkPaidRequest): Promise<StatusResponse> {
  assertAdmin(actor);
  if (typeof req?.paidDate !== 'string' || !isValidYmd(req.paidDate)) throw fail.invalid('paidDate must be yyyy-MM-dd');
  const reference = typeof req.reference === 'string' ? req.reference.trim() : '';
  if (reference.length > 100) throw fail.invalid('Payment reference is too long');
  await transition(deps, req.claimId, (cur, now) => {
    assertCan('mark_paid', cur, actor);
    return {
      status: 'paid',
      paidInfo: { byUid: actor.uid, byName: actor.name, at: now, paidDate: req.paidDate, reference },
      history: history(cur, actor, 'mark_paid', now, `${req.paidDate} ${reference}`.trim()),
    };
  });
  return { status: 'paid' };
}

export async function regeneratePdf(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<{ ok: true }> {
  const requestId = deps.newId();
  await transition(deps, req?.claimId, (cur, now) => {
    assertCan('regenerate_pdf', cur, actor);
    const stuckGenerating =
      cur.pdf.status === 'generating' &&
      (!cur.pdf.requestedAt || now.toMillis() - cur.pdf.requestedAt.toMillis() > PDF_STUCK_AFTER_MS);
    if (cur.pdf.status !== 'failed' && !stuckGenerating) throw fail.statusChanged();
    return {
      pdf: { ...cur.pdf, status: 'generating', requestId, requestedAt: now, error: null },
      history: history(cur, actor, 'pdf_regenerate', now),
    };
  });
  await startPdf(deps, req.claimId, requestId);
  return { ok: true };
}
