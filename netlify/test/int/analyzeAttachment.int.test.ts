import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeAttachment } from '../../lib/services/analyzeAttachment';
import { reviewClaim } from '../../lib/services/reviewClaim';
import {
  jpgFile, makeTestDeps, newClaimId, pdfBytesWithText, resetEmulators, seedActor, submitNewClaim, uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

describe('analyzeAttachment', () => {
  it('uses the on-device OCR text when the app supplies it (image attachment)', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    const text = ['CIMB BANK', 'Account No: 8011557404', 'Total RM 25.00', 'Invoice No: INV-9'].join('\n');
    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId!, text });

    expect(res.suggestion).toMatchObject({
      reference: 'INV-9',
      amountCents: 2500,
      payee: { bankName: 'CIMB BANK', accountNumber: '8011557404' },
    });
    expect(t.docai.calls).toHaveLength(0);
  });

  it('extracts text from a PDF attachment locally when no Document AI is configured', async () => {
    const t = makeTestDeps();
    t.deps.docai = null;
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const pdf = await pdfBytesWithText([
      'Invoice No: ICS-000024',
      'Widget A          2      100.00',
      'Total RM 450.00',
      'CIMB BANK',
      'Account No: 8011557404',
    ]);
    const [fileId] = await uploadFiles(t, alice, claimId, [{ name: 'invoice.pdf', mimeType: 'application/pdf', data: pdf }]);

    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId! });

    expect(res.suggestion).toMatchObject({
      reference: 'ICS-000024',
      amountCents: 45000,
      description: 'Widget A',
      payee: { bankName: 'CIMB BANK', accountNumber: '8011557404' },
    });
  });

  it('returns an empty suggestion for an image with no supplied text and no Document AI', async () => {
    const t = makeTestDeps();
    t.deps.docai = null;
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId! });
    expect(res.suggestion).toEqual({});
  });

  it('uses Document AI for a PDF when configured, without falling back to the local extractor', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const pdf = await pdfBytesWithText(['This local text should be ignored']);
    const [fileId] = await uploadFiles(t, alice, claimId, [{ name: 'invoice.pdf', mimeType: 'application/pdf', data: pdf }]);
    t.docai.result = { text: '', entities: [{ type: 'invoice_id', mentionText: 'FROM-DOCAI' }] };

    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId! });
    expect(res.suggestion).toMatchObject({ reference: 'FROM-DOCAI' });
    expect(t.docai.calls).toHaveLength(1);
  });

  it('falls back to the local PDF extractor when Document AI errors', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const pdf = await pdfBytesWithText(['Invoice No: INV-77', 'Total RM 12.00']);
    const [fileId] = await uploadFiles(t, alice, claimId, [{ name: 'invoice.pdf', mimeType: 'application/pdf', data: pdf }]);
    t.docai.error = new Error('quota exceeded');

    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId! });
    expect(res.suggestion).toMatchObject({ reference: 'INV-77', amountCents: 1200 });
  });

  it('maps an unreadable PDF (no Document AI, pdfjs cannot parse it) to OCR_FAILED', async () => {
    const t = makeTestDeps();
    t.deps.docai = null;
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const garbage = new TextEncoder().encode('not a real pdf'.repeat(50));
    const [fileId] = await uploadFiles(t, alice, claimId, [{ name: 'invoice.pdf', mimeType: 'application/pdf', data: garbage }]);

    await expect(analyzeAttachment(t.deps, alice, { claimId, fileId: fileId! })).rejects.toMatchObject({
      code: 'OCR_FAILED',
    });
  });

  it('refuses another user analysing a file bound to someone else\'s new-claim folder', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const claimId = newClaimId(t.deps);
    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    await expect(analyzeAttachment(t.deps, bob, { claimId, fileId: fileId! })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('requires the file to have been uploaded first when there is no claim or folder binding yet', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);

    await expect(analyzeAttachment(t.deps, alice, { claimId, fileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a file that does not sit inside the bound folder', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    await uploadFiles(t, alice, claimId, [jpgFile()]);
    const otherClaimId = newClaimId(t.deps);
    const [otherFileId] = await uploadFiles(t, alice, otherClaimId, [jpgFile()]);

    await expect(analyzeAttachment(t.deps, alice, { claimId, fileId: otherFileId! })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('allows the applicant to analyse an attachment while resubmitting a rejected claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: 'missing receipt' });

    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);
    const res = await analyzeAttachment(t.deps, alice, { claimId, fileId: fileId!, text: 'Public Bank' });
    expect(res.suggestion.payee).toMatchObject({ bankName: 'PUBLIC BANK' });
  });

  it('refuses a non-applicant analysing an attachment for an existing claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: 'missing receipt' });
    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    await expect(analyzeAttachment(t.deps, boss, { claimId, fileId: fileId! })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects text that is too long', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const [fileId] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    await expect(
      analyzeAttachment(t.deps, alice, { claimId, fileId: fileId!, text: 'x'.repeat(20_001) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
