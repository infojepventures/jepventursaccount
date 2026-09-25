import { Timestamp } from 'firebase-admin/firestore';
import {
  draftRefNo, formatYyyyMm, isAllowedMime, isValidClaimId, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MIN_ATTACHMENTS,
  sumCents, validateBank, validateItems,
  type Attachment, type BankDetails, type ClaimDoc, type ClaimItem, type HistoryAction, type HistoryEntry,
  type SubmitClaimRequest, type SubmitClaimResponse,
} from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { claimRef, getClaim, userRef } from '../firestore';
import { findAttachmentsFolder } from './attachmentsFolder';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

export async function submitClaim(deps: Deps, actor: Actor, req: SubmitClaimRequest): Promise<SubmitClaimResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  if (!actor.name.trim()) throw fail.invalid('Please complete your profile (name) before submitting.');
  const errors = [...validateItems(req.items), ...validateBank(req.payment)];
  if (errors.length) throw fail.invalid(errors.join('; '));
  const ids = req.attachmentIds;
  if (
    !Array.isArray(ids) ||
    ids.length < MIN_ATTACHMENTS ||
    ids.length > MAX_ATTACHMENTS ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    throw fail.invalid(`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} files`);
  }

  const items: ClaimItem[] = req.items.map((i) => ({ description: i.description.trim(), amountCents: i.amountCents }));
  const payment: BankDetails = {
    bankName: req.payment.bankName.trim(),
    accountHolder: req.payment.accountHolder.trim(),
    accountNumber: req.payment.accountNumber.trim(),
  };

  const existing = await getClaim(deps.db, req.claimId);
  let folderId: string;
  if (req.resubmit) {
    if (!existing) throw fail.notFound('Claim not found');
    assertCan('resubmit', existing, actor);
    folderId = existing.attachmentsFolderId;
  } else {
    if (existing) throw fail.invalid('This claim was already submitted');
    const year = formatYyyyMm(deps.now()).slice(0, 4);
    const found = await findAttachmentsFolder(deps, req.claimId, [year, String(Number(year) - 1)]);
    if (!found) throw fail.invalid('Attachments were not uploaded for this claim');
    folderId = found;
  }

  const attachments: Attachment[] = [];
  for (const id of ids) {
    const meta = await deps.drive.getFile(id);
    if (!meta || meta.trashed || !meta.parents.includes(folderId)) {
      throw fail.invalid('An attachment does not belong to this claim. Please re-upload it.');
    }
    if (!isAllowedMime(meta.mimeType) || meta.size <= 0 || meta.size > MAX_ATTACHMENT_BYTES) {
      throw fail.invalid(`${meta.name}: file type or size is not allowed`);
    }
    attachments.push({ driveFileId: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size });
  }

  const now = Timestamp.fromDate(deps.now());
  const requestId = deps.newId();
  const totalCents = sumCents(items);
  const entry = (action: HistoryAction): HistoryEntry => ({ action, byUid: actor.uid, byName: actor.name, at: now, note: null });
  const ref = claimRef(deps.db, req.claimId);

  if (req.resubmit) {
    const removed = await deps.db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as ClaimDoc;
      if (cur.status !== 'rejected') throw fail.statusChanged();
      tx.update(ref, {
        status: 'submitted',
        applicant: { uid: actor.uid, name: actor.name, position: actor.position },
        items,
        totalCents,
        payment,
        attachments,
        review: null,
        pdf: { ...cur.pdf, status: 'generating', requestId, error: null },
        history: [...cur.history, entry('resubmit')],
        resubmittedAt: now,
        updatedAt: now,
      });
      const keep = new Set(ids);
      return cur.attachments.filter((a) => !keep.has(a.driveFileId));
    });
    for (const a of removed) {
      await deps.drive.trash(a.driveFileId).catch((e) => console.error('[submitClaim] trash failed', a.driveFileId, e));
    }
  } else {
    const doc: ClaimDoc = {
      refNo: draftRefNo(deps.now()),
      status: 'submitted',
      applicant: { uid: actor.uid, name: actor.name, position: actor.position },
      items,
      totalCents,
      payment,
      attachments,
      attachmentsFolderId: folderId,
      pdf: { status: 'generating', requestId, driveFileId: null, fileName: null, error: null },
      review: null,
      paidInfo: null,
      history: [entry('submit')],
      submittedAt: now,
      resubmittedAt: null,
      sheetSynced: false,
      createdAt: now,
      updatedAt: now,
    };
    await ref.create(doc);
  }

  if (req.saveBankToProfile) await userRef(deps.db, actor.uid).update({ bank: payment, updatedAt: now });
  await syncClaimToSheet(deps, req.claimId);
  await startPdf(deps, req.claimId, requestId);
  return { claimId: req.claimId };
}
