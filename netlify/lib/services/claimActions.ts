import { Timestamp } from 'firebase-admin/firestore';
import {
  isAllowedMime, isValidClaimId, isValidYmd, MAX_ATTACHMENT_BYTES, PDF_STUCK_AFTER_MS,
  type Attachment, type ClaimDoc, type ClaimIdRequest, type ClaimStatus, type HistoryAction, type MarkPaidRequest, type StatusResponse,
} from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import type { Transaction } from 'firebase-admin/firestore';
import { claimRef, getClaim } from '../firestore';
import { refNoOfClaim } from '../refNumbers';
import { notifyClaimEvent } from './notify';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

/** Runs `mutate` on the current claim inside a transaction, then mirrors the claim to the Sheet. */
async function transition(
  deps: Deps,
  claimId: unknown,
  mutate: (cur: ClaimDoc, now: Timestamp, tx: Transaction) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<void> {
  if (!isValidClaimId(claimId)) throw fail.invalid('Invalid claimId');
  const ref = claimRef(deps.db, claimId);
  const now = Timestamp.fromDate(deps.now());
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Claim not found');
    tx.update(ref, { ...(await mutate(snap.data() as ClaimDoc, now, tx)), updatedAt: now });
  });
  await syncClaimToSheet(deps, claimId);
}

/**
 * The fields for moving a claim to `status`: the PDF is regenerated (its file name ends in the status), and a
 * claim from before numbering-on-submit gets its number. Call from inside `transition` after the status checks.
 */
async function statusChange(deps: Deps, tx: Transaction, cur: ClaimDoc, now: Timestamp, status: ClaimStatus, requestId: string) {
  const number = await refNoOfClaim(tx, deps.db, cur);
  number.commit();
  return {
    status,
    refNo: number.refNo,
    pdf: { ...cur.pdf, status: 'generating', requestId, requestedAt: now, error: null },
  };
}

const history = (cur: ClaimDoc, actor: Actor, action: HistoryAction, at: Timestamp, note: string | null = null) => [
  ...cur.history,
  { action, byUid: actor.uid, byName: actor.name, at, note },
];

export async function cancelClaim(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<StatusResponse> {
  const requestId = deps.newId();
  await transition(deps, req?.claimId, async (cur, now, tx) => {
    assertCan('cancel', cur, actor);
    return { ...(await statusChange(deps, tx, cur, now, 'cancelled', requestId)), history: history(cur, actor, 'cancel', now) };
  });
  await startPdf(deps, req.claimId, requestId);
  return { status: 'cancelled' };
}

/** Checks a slip uploaded with purpose 'paymentSlip' sits in this claim's receipts folder and isn't one of its receipts. */
async function paymentSlip(deps: Deps, actor: Actor, claimId: unknown, fileId: unknown): Promise<Attachment> {
  if (!isValidClaimId(claimId)) throw fail.invalid('Invalid claimId');
  if (typeof fileId !== 'string' || !fileId) throw fail.invalid('Invalid slipFileId');
  const claim = await getClaim(deps.db, claimId);
  if (!claim) throw fail.notFound('Claim not found');
  assertCan('mark_paid', claim, actor);
  const meta = await deps.drive.getFile(fileId);
  if (!meta || meta.trashed || !meta.parents.includes(claim.attachmentsFolderId) || claim.attachments.some((a) => a.driveFileId === fileId)) {
    throw fail.invalid('This payment slip does not belong to this claim. Please upload it again.');
  }
  if (!isAllowedMime(meta.mimeType)) throw fail.invalid('The payment slip must be a JPG, PNG or PDF');
  if (meta.size <= 0 || meta.size > MAX_ATTACHMENT_BYTES) throw fail.invalid('The payment slip is larger than 10MB');
  return { driveFileId: fileId, name: meta.name, mimeType: meta.mimeType, size: meta.size };
}

export async function markPaid(deps: Deps, actor: Actor, req: MarkPaidRequest): Promise<StatusResponse> {
  assertAdmin(actor);
  if (typeof req?.paidDate !== 'string' || !isValidYmd(req.paidDate)) throw fail.invalid('paidDate must be yyyy-MM-dd');
  const reference = typeof req.reference === 'string' ? req.reference.trim() : '';
  if (reference.length > 100) throw fail.invalid('Payment reference is too long');
  const slip = req.slipFileId === undefined ? null : await paymentSlip(deps, actor, req.claimId, req.slipFileId);
  const requestId = deps.newId();
  await transition(deps, req.claimId, async (cur, now, tx) => {
    assertCan('mark_paid', cur, actor);
    return {
      ...(await statusChange(deps, tx, cur, now, 'paid', requestId)),
      paidInfo: { byUid: actor.uid, byName: actor.name, at: now, paidDate: req.paidDate, reference, slip },
      history: history(cur, actor, 'mark_paid', now, `${req.paidDate} ${reference}`.trim()),
    };
  });
  await notifyClaimEvent(deps, 'paid', req.claimId, actor.uid);
  await startPdf(deps, req.claimId, requestId);
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
