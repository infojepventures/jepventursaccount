import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UploadSessionRequest } from '@jep/shared';
import { getClaim } from '../../lib/firestore';
import { analyzeAttachment } from '../../lib/services/analyzeAttachment';
import { markPaid } from '../../lib/services/claimActions';
import { discardUploads } from '../../lib/services/discardUploads';
import { openClaimFile } from '../../lib/services/fileAccess';
import { generatePdf } from '../../lib/services/generatePdf';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { createUploadSessions } from '../../lib/services/uploadSession';
import type { Actor } from '../../lib/actor';
import {
  jpgFile, makeTestDeps, pdfBytesWithText, resetEmulators, seedActor, seedCounter, submitNewClaim, type TestFile,
} from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  await seedCounter(t.deps);
  const alice = await seedActor(t.deps, 'alice');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  const { claimId, attachmentIds } = await submitNewClaim(t, alice);
  await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
  return { t, alice, boss, claimId, attachmentIds };
}

type Kit = Awaited<ReturnType<typeof setup>>['t'];

async function uploadSlip(t: Kit, actor: Actor, claimId: string, file: TestFile = jpgFile('slip.jpg')): Promise<string> {
  const req: UploadSessionRequest = { claimId, purpose: 'paymentSlip', files: [{ name: file.name, mimeType: file.mimeType, size: file.data.length }] };
  const res = await createUploadSessions(t.deps, actor, req);
  return t.drive.completeUpload(res.uploads[0]!.uploadUrl, file.data);
}

describe('payment slip', () => {
  it('uploads into the claim folder for an admin marking an approved claim paid', async () => {
    const { t, alice, boss, claimId } = await setup();
    const slipId = await uploadSlip(t, boss, claimId);
    const c = (await getClaim(t.deps.db, claimId))!;
    const file = t.drive.files.get(slipId)!;
    expect(file.parents).toEqual([c.attachmentsFolderId]);
    expect(file.name).toBe('payment-slip-slip.jpg');
    await expect(uploadSlip(t, alice, claimId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses slips before approval and more than one file', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId } = await submitNewClaim(t, alice);
    await expect(uploadSlip(t, boss, claimId)).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    const meta = { name: 's.jpg', mimeType: 'image/jpeg', size: 10 };
    await expect(createUploadSessions(t.deps, boss, { claimId, purpose: 'paymentSlip', files: [meta, meta] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('reads the paid date and reference from the app OCR text or a PDF slip', async () => {
    const { t, boss, claimId } = await setup();
    const imgId = await uploadSlip(t, boss, claimId);
    const text = ['Reference number 6123456789', 'Transaction date 28 Sep 2026 10:22:31'].join('\n');
    expect(await analyzeAttachment(t.deps, boss, { claimId, fileId: imgId, purpose: 'paymentSlip', text })).toEqual({
      suggestion: {},
      payment: { paidDate: '2026-09-28', reference: '6123456789' },
    });

    t.deps.docai = null;
    const pdf = await pdfBytesWithText(['Transaction Reference No. : 0012345678', 'Date & Time : 05/10/2026 09:01:44']);
    const pdfId = await uploadSlip(t, boss, claimId, { name: 'slip.pdf', mimeType: 'application/pdf', data: pdf });
    expect((await analyzeAttachment(t.deps, boss, { claimId, fileId: pdfId, purpose: 'paymentSlip' })).payment).toEqual({
      paidDate: '2026-10-05',
      reference: '0012345678',
    });
  });

  it('records the slip on mark paid, lets readers open it, and appends it to the paid PDF', async () => {
    const { t, alice, boss, claimId, attachmentIds } = await setup();
    const slipId = await uploadSlip(t, boss, claimId);
    await expect(markPaid(t.deps, boss, { claimId, paidDate: '2026-09-28', reference: 'R1', slipFileId: attachmentIds[0]! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await markPaid(t.deps, boss, { claimId, paidDate: '2026-09-28', reference: '6123456789', slipFileId: slipId });

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.paidInfo?.slip).toMatchObject({ driveFileId: slipId, name: 'payment-slip-slip.jpg', mimeType: 'image/jpeg' });
    expect((await openClaimFile(t.deps, alice, claimId, slipId)).status).toBe(200);

    expect(await generatePdf(t.deps, claimId, c.pdf.requestId!)).toBe('done');
    const after = (await getClaim(t.deps.db, claimId))!;
    const pdf = await PDFDocument.load(t.drive.files.get(after.pdf.driveFileId!)!.data);
    expect(pdf.getPageCount()).toBe(3); // form, receipt, slip
    expect(after.pdf.fileName).toMatch(/-Paid\.pdf$/);
  });

  it('marks paid without a slip as before', async () => {
    const { t, boss, claimId } = await setup();
    await markPaid(t.deps, boss, { claimId, paidDate: '2026-09-28', reference: '' });
    expect((await getClaim(t.deps.db, claimId))!.paidInfo?.slip).toBeNull();
  });

  it('discards a cancelled slip but never the receipts', async () => {
    const { t, alice, boss, claimId, attachmentIds } = await setup();
    const slipId = await uploadSlip(t, boss, claimId);
    await expect(discardUploads(t.deps, alice, { claimId, fileIds: [slipId], purpose: 'paymentSlip' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await discardUploads(t.deps, boss, { claimId, fileIds: [slipId, attachmentIds[0]!], purpose: 'paymentSlip' })).toEqual({ trashed: 1 });
    expect(t.drive.files.get(slipId)!.trashed).toBe(true);
    expect(t.drive.files.get(attachmentIds[0]!)!.trashed).toBe(false);
  });
});
