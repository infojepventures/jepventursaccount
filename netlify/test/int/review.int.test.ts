import { FieldValue } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_SEQ_DOC, COL, getClaim } from '../../lib/firestore';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { submitClaim } from '../../lib/services/submitClaim';
import {
  BANK, jpgFile, makeTestDeps, pdfBytes, resetEmulators, seedActor, seedCounter, submitNewClaim, uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

async function setup(next = 1) {
  const t = makeTestDeps();
  await seedCounter(t.deps, next);
  const alice = await seedActor(t.deps, 'alice');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, boss };
}

describe('reviewClaim', () => {
  it('numbers claims when submitted (submission month, 4 digits) and only changes the suffix on review', async () => {
    const { t, alice, boss } = await setup(5);
    const a = await submitNewClaim(t, alice);
    const b = await submitNewClaim(t, alice);
    expect((await getClaim(t.deps.db, a.claimId))!).toMatchObject({ refBase: 'PR-JEP-202609-0005', refNo: 'PR-JEP-202609-0005-Draft' });
    expect((await getClaim(t.deps.db, b.claimId))!.refNo).toBe('PR-JEP-202609-0006-Draft');
    expect((await t.deps.db.collection(COL.counters).doc(CLAIM_SEQ_DOC).get()).data()).toEqual({ next: 7 });

    t.setNow(new Date('2026-10-01T02:00:00Z')); // approved next month: the ref keeps the submission month
    expect(await reviewClaim(t.deps, boss, { claimId: a.claimId, decision: 'approve' })).toEqual({
      status: 'approved', refNo: 'PR-JEP-202609-0005-Approved',
    });
    expect((await t.deps.db.collection(COL.counters).doc(CLAIM_SEQ_DOC).get()).data()).toEqual({ next: 7 });

    const c = (await getClaim(t.deps.db, a.claimId))!;
    expect(c.status).toBe('approved');
    expect(c.review).toMatchObject({ byUid: 'boss', byName: 'User boss', reason: null });
    expect(c.pdf.status).toBe('generating');
    expect(t.triggered.at(-1)).toEqual({ claimId: a.claimId, requestId: c.pdf.requestId });
    expect(t.sheets.rows.get(a.claimId)?.[1]).toBe('PR-JEP-202609-0005-Approved');
  });

  it('marks a rejected claim -Rejected and regenerates its PDF', async () => {
    const { t, alice, boss } = await setup();
    const a = await submitNewClaim(t, alice);
    const before = t.triggered.length;
    const rej = await reviewClaim(t.deps, boss, { claimId: a.claimId, decision: 'reject', reason: 'No receipt' });
    expect(rej).toEqual({ status: 'rejected', refNo: 'PR-JEP-202609-0001-Rejected' });
    const c = (await getClaim(t.deps.db, a.claimId))!;
    expect(c.review?.reason).toBe('No receipt');
    expect(c.pdf.status).toBe('generating');
    expect(t.triggered).toHaveLength(before + 1);
  });

  it('numbers a claim from before numbering-on-submit when it is reviewed, by its submission month', async () => {
    const { t, alice, boss } = await setup(9);
    const { claimId } = await submitNewClaim(t, alice);
    await t.deps.db.collection(COL.claims).doc(claimId).update({ refNo: 'PR-JEP-202609-draft', refBase: FieldValue.delete() });
    t.setNow(new Date('2026-10-01T02:00:00Z'));
    expect((await reviewClaim(t.deps, boss, { claimId, decision: 'approve' })).refNo).toBe('PR-JEP-202609-0010-Approved');
  });

  it('requires a reason to reject, and admin rights', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: '  ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(reviewClaim(t.deps, alice, { claimId, decision: 'approve' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a second review with STATUS_CHANGED', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(reviewClaim(t.deps, boss, { claimId, decision: 'approve' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
  });

  it('gives concurrent submissions unique consecutive numbers', async () => {
    const { t, alice } = await setup();
    const ids = await Promise.all([0, 1, 2, 3, 4].map(() => submitNewClaim(t, alice)));
    const refs = await Promise.all(ids.map(async ({ claimId }) => (await getClaim(t.deps.db, claimId))!.refNo));
    expect(refs.sort()).toEqual([1, 2, 3, 4, 5].map((n) => `PR-JEP-202609-000${n}-Draft`));
  });

  it('starts numbering at 1 when the counter does not exist yet', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const { claimId } = await submitNewClaim(t, alice);
    expect((await getClaim(t.deps.db, claimId))!.refNo).toBe('PR-JEP-202609-0001-Draft');
  });
});

describe('reject then resubmit', () => {
  it('resubmits a rejected claim and trashes removed attachments', async () => {
    const { t, alice, boss } = await setup();
    const { claimId, attachmentIds } = await submitNewClaim(t, alice, {
      files: [jpgFile('a.jpg'), { name: 'b.pdf', mimeType: 'application/pdf', data: await pdfBytes() }],
    });
    await reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: 'Missing receipt' });

    const [added] = await uploadFiles(t, alice, claimId, [jpgFile('c.jpg')]);
    t.setNow(new Date('2026-09-26T04:00:00Z'));
    await submitClaim(t.deps, alice, {
      claimId, items: [{ description: 'Fixed', amountCents: 500 }], payment: BANK,
      attachmentIds: [attachmentIds[0]!, added!], resubmit: true, saveBankToProfile: false,
    });

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('submitted');
    expect(c.refNo).toBe('PR-JEP-202609-0001-Draft'); // back to -Draft, same number
    expect(c.totalCents).toBe(500);
    expect(c.review).toBeNull();
    expect(c.resubmittedAt?.toDate().toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(c.attachments.map((a) => a.driveFileId)).toEqual([attachmentIds[0], added]);
    expect(c.history.map((h) => h.action)).toEqual(['submit', 'reject', 'resubmit']);
    expect(t.drive.files.get(attachmentIds[1]!)!.trashed).toBe(true);
    expect(t.triggered).toHaveLength(3); // submit, reject, resubmit
  });
});
