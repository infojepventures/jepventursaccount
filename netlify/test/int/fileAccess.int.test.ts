import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PROXY_BYTES, openClaimFile } from '../../lib/services/fileAccess';
import { jpgBytes, makeTestDeps, resetEmulators, seedActor, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

describe('openClaimFile', () => {
  it('streams an attachment to its applicant and to admins only', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    const fileId = attachmentIds[0]!;

    const res = await openClaimFile(t.deps, alice, claimId, fileId);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpgBytes());
    expect((await openClaimFile(t.deps, boss, claimId, fileId)).status).toBe(200);
    await expect(openClaimFile(t.deps, bob, claimId, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses files that are not part of the claim, and files that are too large', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const a = await submitNewClaim(t, alice);
    const b = await submitNewClaim(t, alice);
    await expect(openClaimFile(t.deps, alice, a.claimId, b.attachmentIds[0]!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    t.drive.files.get(a.attachmentIds[0]!)!.size = MAX_PROXY_BYTES + 1;
    await expect(openClaimFile(t.deps, alice, a.claimId, a.attachmentIds[0]!)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(openClaimFile(t.deps, alice, null, 'x')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
