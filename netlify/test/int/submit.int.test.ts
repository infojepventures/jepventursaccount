import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@jep/shared';
import { COL, getClaim } from '../../lib/firestore';
import { submitClaim } from '../../lib/services/submitClaim';
import {
  BANK, jpgFile, makeTestDeps, newClaimId, resetEmulators, seedActor, submitNewClaim, uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

describe('submitClaim (new)', () => {
  it('creates a draft claim, mirrors it to the Sheet and triggers the PDF', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.refNo).toBe('PR-JEP-202609-draft');
    expect(c.status).toBe('submitted');
    expect(c.totalCents).toBe(15000);
    expect(c.applicant).toEqual({ uid: 'alice', name: 'User alice', position: 'Executive' });
    expect(c.attachments.map((a) => a.driveFileId)).toEqual(attachmentIds);
    expect(c.pdf).toEqual({
      status: 'generating', requestId: 'req_1', requestedAt: Timestamp.fromDate(t.deps.now()), driveFileId: null, fileName: null, error: null,
    });
    expect(c.history.map((h) => h.action)).toEqual(['submit']);
    expect(c.sheetSynced).toBe(true);
    expect(t.drive.folderPath(c.attachmentsFolderId)).toBe(`JEP Claims/2026/_attachments/${claimId}`);
    expect(t.sheets.rows.get(claimId)?.[1]).toBe('PR-JEP-202609-draft');
    expect(t.triggered).toEqual([{ claimId, requestId: 'req_1' }]);
  });

  it('rejects attachments that belong to another claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const bobs = await submitNewClaim(t, bob);
    const claimId = newClaimId(t.deps);
    await uploadFiles(t, alice, claimId, [jpgFile()]);
    await expect(
      submitClaim(t.deps, alice, {
        claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK,
        attachmentIds: bobs.attachmentIds, resubmit: false, saveBankToProfile: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('validates items, bank details and attachment count', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    const base = { claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK, attachmentIds: ids, resubmit: false, saveBankToProfile: false };
    await expect(submitClaim(t.deps, alice, { ...base, items: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, payment: { ...BANK, accountNumber: '' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, attachmentIds: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, claimId: 'bad' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('requires a profile name', async () => {
    const t = makeTestDeps();
    const anon = await seedActor(t.deps, 'anon', { name: '' });
    await expect(submitNewClaim(t, anon)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('still succeeds when the Sheet is down, flagging sheetSynced=false', async () => {
    const t = makeTestDeps();
    t.sheets.failing = true;
    const alice = await seedActor(t.deps, 'alice');
    const { claimId } = await submitNewClaim(t, alice);
    expect((await getClaim(t.deps.db, claimId))!.sheetSynced).toBe(false);
  });

  it('saves bank details to the profile when asked', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice', { bank: null });
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    await submitClaim(t.deps, alice, {
      claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK, attachmentIds: ids, resubmit: false, saveBankToProfile: true,
    });
    const u = (await t.deps.db.collection(COL.users).doc('alice').get()).data() as UserDoc;
    expect(u.bank).toEqual(BANK);
  });

  it('persists a per-item reference only when non-empty', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    await submitClaim(t.deps, alice, {
      claimId,
      items: [
        { description: 'With doc no.', amountCents: 100, reference: '  ICS-000024  ' },
        { description: 'Without doc no.', amountCents: 200 },
      ],
      payment: BANK, attachmentIds: ids, resubmit: false, saveBankToProfile: false,
    });
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.items[0]!.reference).toBe('ICS-000024');
    expect(c.items[1]).not.toHaveProperty('reference');
  });

  it('rejects upload sessions with bad files', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    await expect(
      uploadFiles(t, alice, newClaimId(t.deps), [{ name: 'a.gif', mimeType: 'image/gif', data: new Uint8Array(5) }]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('submitClaim (new, idempotent retry)', () => {
  it('retrying the same submit returns the claimId and leaves the claim unchanged', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    const before = (await getClaim(t.deps.db, claimId))!;

    const req = {
      claimId, items: [{ description: 'Item 1', amountCents: 1050 }, { description: 'Item 2', amountCents: 13950 }],
      payment: BANK, attachmentIds, resubmit: false, saveBankToProfile: false,
    };
    await expect(submitClaim(t.deps, alice, req)).resolves.toEqual({ claimId });

    const after = (await getClaim(t.deps.db, claimId))!;
    expect(after).toEqual(before);
    expect(after.history).toHaveLength(1);
    expect(t.triggered).toHaveLength(1);
  });

  it('refuses another user submitting the same claimId', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    await expect(
      submitClaim(t.deps, bob, {
        claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK,
        attachmentIds, resubmit: false, saveBankToProfile: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('handles a concurrent double-submit race the same as a sequential retry', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    const req = {
      claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK,
      attachmentIds: ids, resubmit: false, saveBankToProfile: false,
    };
    const results = await Promise.all([submitClaim(t.deps, alice, req), submitClaim(t.deps, alice, req)]);
    expect(results).toEqual([{ claimId }, { claimId }]);
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.history).toHaveLength(1);
  });
});

describe('submitClaim (resubmit guards)', () => {
  // The full reject → resubmit flow is tested in Task 11 (review.int.test.ts).
  it('only the applicant may resubmit, and only when rejected', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    const req = { claimId, items: [{ description: 'x', amountCents: 1 }], payment: BANK, attachmentIds, resubmit: true, saveBankToProfile: false };
    await expect(submitClaim(t.deps, bob, req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(submitClaim(t.deps, alice, req)).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    await expect(uploadFiles(t, bob, claimId, [jpgFile()])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
