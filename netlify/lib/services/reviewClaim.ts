import { Timestamp } from 'firebase-admin/firestore';
import {
  isValidClaimId,
  type ClaimDoc, type ReviewClaimRequest, type ReviewClaimResponse, type ReviewInfo,
} from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { claimRef } from '../firestore';
import { refNoOfClaim } from '../refNumbers';
import { notifyClaimEvent } from './notify';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

export async function reviewClaim(deps: Deps, actor: Actor, req: ReviewClaimRequest): Promise<ReviewClaimResponse> {
  assertAdmin(actor);
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  if (req.decision !== 'approve' && req.decision !== 'reject') throw fail.invalid('decision must be approve or reject');
  const reason = typeof req.reason === 'string' ? req.reason.trim() : '';
  if (req.decision === 'reject' && !reason) throw fail.invalid('A reason is required to reject a claim');
  if (reason.length > 500) throw fail.invalid('Reason is too long (max 500 characters)');

  const ref = claimRef(deps.db, req.claimId);
  const nowDate = deps.now();
  const now = Timestamp.fromDate(nowDate);
  const requestId = deps.newId();

  const result = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Claim not found');
    const cur = snap.data() as ClaimDoc;
    if (cur.status !== 'submitted') throw fail.statusChanged();
    const review: ReviewInfo = {
      byUid: actor.uid,
      byName: actor.name,
      at: now,
      reason: req.decision === 'reject' ? reason : null,
    };

    // The number was taken at submission (older claims are numbered now). The PDF is regenerated either way:
    // its file name ends in the status, and approval adds the approver's details.
    const number = await refNoOfClaim(tx, deps.db, cur);
    number.commit();
    const refNo = number.refNo;
    const pdf = { ...cur.pdf, status: 'generating', requestId, requestedAt: now, error: null };

    if (req.decision === 'approve') {
      tx.update(ref, {
        status: 'approved',
        refNo,
        review,
        pdf,
        history: [...cur.history, { action: 'approve', byUid: actor.uid, byName: actor.name, at: now, note: refNo }],
        updatedAt: now,
      });
      return { status: 'approved' as const, refNo };
    }

    tx.update(ref, {
      status: 'rejected',
      refNo,
      review,
      pdf,
      history: [...cur.history, { action: 'reject', byUid: actor.uid, byName: actor.name, at: now, note: reason }],
      updatedAt: now,
    });
    return { status: 'rejected' as const, refNo };
  });

  await syncClaimToSheet(deps, req.claimId);
  await notifyClaimEvent(deps, result.status === 'approved' ? 'approved' : 'rejected', req.claimId, actor.uid);
  await startPdf(deps, req.claimId, requestId);
  return result;
}
