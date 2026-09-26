import { beforeEach, describe, expect, it } from 'vitest';
import { COL } from '../../lib/firestore';
import { createUploadSessions } from '../../lib/services/uploadSession';
import { jpgFile, makeTestDeps, newClaimId, resetEmulators, seedActor } from './helpers';

beforeEach(resetEmulators);

describe('createUploadSessions (new claim folder binding)', () => {
  it('reuses the same Drive folder across two upload sessions for the same new claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);

    const first = await createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'a.jpg', mimeType: 'image/jpeg', size: 100 }] });
    const second = await createUploadSessions(t.deps, alice, { claimId, files: [{ name: 'b.jpg', mimeType: 'image/jpeg', size: 100 }] });

    expect(second.folderId).toBe(first.folderId);
    const bound = (await t.deps.db.collection(COL.uploadFolders).doc(claimId).get()).data();
    expect(bound).toMatchObject({ uid: 'alice', folderId: first.folderId });
  });

  it('refuses another user requesting an upload session for that claimId', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const claimId = newClaimId(t.deps);
    await createUploadSessions(t.deps, alice, { claimId, files: [jpgFile()].map((f) => ({ name: f.name, mimeType: f.mimeType, size: f.data.length })) });

    await expect(
      createUploadSessions(t.deps, bob, { claimId, files: [{ name: 'x.jpg', mimeType: 'image/jpeg', size: 10 }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
