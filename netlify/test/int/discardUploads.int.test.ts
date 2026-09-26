import { beforeEach, describe, expect, it } from 'vitest';
import { COL } from '../../lib/firestore';
import { cleanupAbandonedUploads, discardUploads } from '../../lib/services/discardUploads';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { submitClaim } from '../../lib/services/submitClaim';
import { createUploadSessions } from '../../lib/services/uploadSession';
import { BANK, jpgFile, makeTestDeps, newClaimId, resetEmulators, seedActor, submitNewClaim, uploadFiles } from './helpers';

beforeEach(resetEmulators);

describe('discardUploads', () => {
  it('trashes a receipt removed from a new, unsaved claim, leaving the others', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const [a, b] = await uploadFiles(t, alice, claimId, [jpgFile('a.jpg'), jpgFile('b.jpg')]);

    const res = await discardUploads(t.deps, alice, { claimId, fileIds: [a!] });

    expect(res).toEqual({ trashed: 1 });
    expect(t.drive.files.get(a!)!.trashed).toBe(true);
    expect(t.drive.files.get(b!)!.trashed).toBe(false);
  });

  it("refuses someone else's new-claim uploads", async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const claimId = newClaimId(t.deps);
    const [a] = await uploadFiles(t, alice, claimId, [jpgFile()]);

    await expect(discardUploads(t.deps, bob, { claimId, fileIds: [a!] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(t.drive.files.get(a!)!.trashed).toBe(false);
  });

  it('ignores files that are not in the claim folder', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimA = newClaimId(t.deps);
    const claimB = newClaimId(t.deps);
    await uploadFiles(t, alice, claimA, [jpgFile()]);
    const [other] = await uploadFiles(t, alice, claimB, [jpgFile()]);

    expect(await discardUploads(t.deps, alice, { claimId: claimA, fileIds: [other!] })).toEqual({ trashed: 0 });
    expect(t.drive.files.get(other!)!.trashed).toBe(false);
  });

  it('is a no-op when nothing was ever uploaded for the claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    expect(await discardUploads(t.deps, alice, { claimId: newClaimId(t.deps), fileIds: ['nope'] })).toEqual({ trashed: 0 });
  });

  it("on a rejected claim being resubmitted, trashes a newly uploaded file but never the claim's saved attachments", async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const admin = await seedActor(t.deps, 'admin', { role: 'admin' });
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, admin, { claimId, decision: 'reject', reason: 'blurry' });
    const [fresh] = await uploadFiles(t, alice, claimId, [jpgFile('new.jpg')]);

    const res = await discardUploads(t.deps, alice, { claimId, fileIds: [fresh!, attachmentIds[0]!] });

    expect(res).toEqual({ trashed: 1 });
    expect(t.drive.files.get(fresh!)!.trashed).toBe(true);
    expect(t.drive.files.get(attachmentIds[0]!)!.trashed).toBe(false);
  });

  it('rejects malformed requests', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    await expect(discardUploads(t.deps, alice, { claimId, fileIds: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(discardUploads(t.deps, alice, { claimId: 'bad id!', fileIds: ['x'] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('cleanupAbandonedUploads', () => {
  it('trashes upload folders of new claims never submitted within 24 hours, and forgets submitted ones', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');

    const abandonedId = newClaimId(t.deps);
    const abandoned = await createUploadSessions(t.deps, alice, { claimId: abandonedId, files: [{ name: 'a.jpg', mimeType: 'image/jpeg', size: 10 }] });
    const { claimId: submittedId } = await submitNewClaim(t, alice);

    t.setNow(new Date('2026-09-26T05:00:00Z')); // 25 hours later
    const recentId = newClaimId(t.deps);
    const recent = await createUploadSessions(t.deps, alice, { claimId: recentId, files: [{ name: 'r.jpg', mimeType: 'image/jpeg', size: 10 }] });

    const res = await cleanupAbandonedUploads(t.deps);

    expect(res).toEqual({ trashed: 1, forgotten: 1 });
    expect(t.drive.files.get(abandoned.folderId)!.trashed).toBe(true);
    expect(t.drive.files.get(recent.folderId)!.trashed).toBe(false);
    const col = t.deps.db.collection(COL.uploadFolders);
    expect((await col.doc(abandonedId).get()).exists).toBe(false);
    expect((await col.doc(submittedId).get()).exists).toBe(false);
    expect((await col.doc(recentId).get()).exists).toBe(true);
    // The submitted claim's folder is untouched.
    const claim = (await t.deps.db.collection(COL.claims).doc(submittedId).get()).data()!;
    expect(t.drive.files.get(claim.attachmentsFolderId)!.trashed).toBe(false);
  });
});

describe('cleanup vs. an in-progress claim', () => {
  const submitReq = (claimId: string, attachmentIds: string[]) => ({
    claimId,
    items: [{ description: 'Taxi', amountCents: 1050 }],
    payment: BANK,
    attachmentIds,
    resubmit: false,
    saveBankToProfile: false,
  });

  it('a submit refuses (and creates nothing) once cleanup has claimed the upload folder', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    await t.deps.db.collection(COL.uploadFolders).doc(claimId).update({ cleaning: true });

    await expect(submitClaim(t.deps, alice, submitReq(claimId, ids))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await t.deps.db.collection(COL.claims).doc(claimId).get()).exists).toBe(false);
  });

  it('each upload restarts the 24-hour clock, so a form still being filled in is not cleaned up', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const first = await createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'a.jpg', mimeType: 'image/jpeg', size: 10 }] });
    t.setNow(new Date('2026-09-26T03:00:00Z')); // 23 hours later: another receipt
    await createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'b.jpg', mimeType: 'image/jpeg', size: 10 }] });
    t.setNow(new Date('2026-09-26T05:00:00Z')); // 25 hours after the first, 2 after the last

    expect(await cleanupAbandonedUploads(t.deps)).toEqual({ trashed: 0, forgotten: 0 });
    expect(t.drive.files.get(first.folderId)!.trashed).toBe(false);
  });

  it('refuses new uploads into a folder that is being cleaned up', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    await uploadFiles(t, alice, claimId, [jpgFile()]);
    await t.deps.db.collection(COL.uploadFolders).doc(claimId).update({ cleaning: true });

    await expect(
      createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'b.jpg', mimeType: 'image/jpeg', size: 10 }] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('finishes a cleanup that was interrupted after claiming the folder', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const session = await createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'a.jpg', mimeType: 'image/jpeg', size: 10 }] });
    await t.deps.db.collection(COL.uploadFolders).doc(claimId).update({ cleaning: true });
    t.setNow(new Date('2026-09-26T05:00:00Z'));

    expect(await cleanupAbandonedUploads(t.deps)).toEqual({ trashed: 1, forgotten: 0 });
    expect(t.drive.files.get(session.folderId)!.trashed).toBe(true);
    expect((await t.deps.db.collection(COL.uploadFolders).doc(claimId).get()).exists).toBe(false);
  });
});
