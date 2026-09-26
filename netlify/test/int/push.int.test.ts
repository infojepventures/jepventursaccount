import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim, COL } from '../../lib/firestore';
import { markPaid } from '../../lib/services/claimActions';
import { registerPushToken, unregisterPushToken } from '../../lib/services/pushTokens';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { submitClaim } from '../../lib/services/submitClaim';
import {
  BANK, jpgFile, makeTestDeps, newClaimId, resetEmulators, seedActor, seedCounter, seedUser, submitNewClaim,
  uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

describe('registerPushToken / unregisterPushToken', () => {
  it('register then unregister; another user cannot unregister but can reassign; bad input is rejected', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');

    await expect(registerPushToken(t.deps, alice, { token: '', platform: 'android' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(registerPushToken(t.deps, alice, { token: 'tok1', platform: 'web' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(registerPushToken(t.deps, alice, { token: 'x'.repeat(4097), platform: 'android' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(await registerPushToken(t.deps, alice, { token: 'tok1', platform: 'android' })).toEqual({ ok: true });
    let snap = await t.deps.db.collection(COL.pushTokens).doc('tok1').get();
    expect(snap.data()).toMatchObject({ uid: 'alice', platform: 'android' });

    // unregister by another user is a silent no-op
    expect(await unregisterPushToken(t.deps, bob, { token: 'tok1' })).toEqual({ ok: true });
    snap = await t.deps.db.collection(COL.pushTokens).doc('tok1').get();
    expect(snap.exists).toBe(true);

    // re-register by another user reassigns the token
    expect(await registerPushToken(t.deps, bob, { token: 'tok1', platform: 'ios' })).toEqual({ ok: true });
    snap = await t.deps.db.collection(COL.pushTokens).doc('tok1').get();
    expect(snap.data()).toMatchObject({ uid: 'bob', platform: 'ios' });

    // unregister by the owner deletes
    expect(await unregisterPushToken(t.deps, bob, { token: 'tok1' })).toEqual({ ok: true });
    snap = await t.deps.db.collection(COL.pushTokens).doc('tok1').get();
    expect(snap.exists).toBe(false);
  });
});

async function seedAdminWithToken(t: ReturnType<typeof makeTestDeps>, uid: string, token: string) {
  const actor = await seedActor(t.deps, uid, { role: 'admin' });
  await registerPushToken(t.deps, actor, { token, platform: 'android' });
  return actor;
}

describe('notifyClaimEvent via submitClaim (new claim)', () => {
  it('notifies active admins but not the applicant-admin, inactive admins, or members', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice', { role: 'admin' }); // applicant, also an admin
    await registerPushToken(t.deps, alice, { token: 'alice-tok', platform: 'android' });
    const boss = await seedAdminWithToken(t, 'boss', 'boss-tok');

    await seedUser(t.deps, 'ia', { role: 'admin', active: false });
    await t.deps.db.collection(COL.pushTokens).doc('ia-tok').set({ uid: 'ia', platform: 'android', updatedAt: t.deps.now() });

    const mem = await seedActor(t.deps, 'mem');
    await registerPushToken(t.deps, mem, { token: 'mem-tok', platform: 'android' });

    const { claimId } = await submitNewClaim(t, alice);

    expect(t.push.calls).toHaveLength(1);
    expect(t.push.calls[0]!.tokens).toEqual(['boss-tok']);
    expect(t.push.calls[0]!.msg).toEqual({
      title: 'New claim',
      body: 'User alice submitted RM 150.00',
      data: { claimId, event: 'submitted' },
    });
    void boss;
  });

  it('sends nothing when the sole admin is the applicant', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const boss = await seedAdminWithToken(t, 'boss', 'boss-tok');
    await submitNewClaim(t, boss);
    expect(t.push.calls).toHaveLength(0);
  });
});

describe('notifyClaimEvent via submitClaim (resubmit)', () => {
  it('sends the resubmitted event to admins', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    const boss = await seedAdminWithToken(t, 'boss', 'boss-tok');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: 'fix it' });
    t.push.calls.length = 0;

    const [added] = await uploadFiles(t, alice, claimId, [jpgFile('c.jpg')]);
    await submitClaim(t.deps, alice, {
      claimId, items: [{ description: 'Fixed', amountCents: 500 }], payment: BANK,
      attachmentIds: [attachmentIds[0]!, added!], resubmit: true, saveBankToProfile: false,
    });

    expect(t.push.calls).toHaveLength(1);
    expect(t.push.calls[0]!.tokens).toEqual(['boss-tok']);
    expect(t.push.calls[0]!.msg).toEqual({
      title: 'Claim resubmitted',
      body: 'User alice resubmitted RM 5.00',
      data: { claimId, event: 'resubmitted' },
    });
  });
});

describe('notifyClaimEvent via reviewClaim / markPaid', () => {
  it('approve, reject and paid each notify only the applicant', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    await registerPushToken(t.deps, alice, { token: 'alice-tok', platform: 'android' });
    const boss = await seedAdminWithToken(t, 'boss', 'boss-tok');

    const a = await submitNewClaim(t, alice);
    t.push.calls.length = 0;
    await reviewClaim(t.deps, boss, { claimId: a.claimId, decision: 'approve' });
    expect(t.push.calls).toHaveLength(1);
    expect(t.push.calls[0]!.tokens).toEqual(['alice-tok']);
    expect(t.push.calls[0]!.msg).toMatchObject({ title: 'Claim approved', body: 'PR-JEP-202609-001 (RM 150.00) was approved' });

    const b = await submitNewClaim(t, alice);
    t.push.calls.length = 0;
    await reviewClaim(t.deps, boss, { claimId: b.claimId, decision: 'reject', reason: 'No receipt' });
    expect(t.push.calls).toHaveLength(1);
    expect(t.push.calls[0]!.tokens).toEqual(['alice-tok']);
    expect(t.push.calls[0]!.msg).toEqual({
      title: 'Claim rejected', body: 'Reason: No receipt', data: { claimId: b.claimId, event: 'rejected' },
    });

    t.push.calls.length = 0;
    await markPaid(t.deps, boss, { claimId: a.claimId, paidDate: '2026-09-27', reference: 'IBG' });
    expect(t.push.calls).toHaveLength(1);
    expect(t.push.calls[0]!.tokens).toEqual(['alice-tok']);
    expect(t.push.calls[0]!.msg).toMatchObject({ title: 'Claim paid', body: 'PR-JEP-202609-001 (RM 150.00) has been paid' });
  });

  it('sends nothing when the admin approves their own claim', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const boss = await seedAdminWithToken(t, 'boss', 'boss-tok');
    const { claimId } = await submitNewClaim(t, boss);
    t.push.calls.length = 0;
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(t.push.calls).toHaveLength(0);
  });
});

describe('invalid tokens and failures', () => {
  it('deletes invalid tokens reported by push.send', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    await seedAdminWithToken(t, 'boss', 'boss-tok');
    t.push.invalid.add('boss-tok');

    await submitNewClaim(t, alice);

    const snap = await t.deps.db.collection(COL.pushTokens).doc('boss-tok').get();
    expect(snap.exists).toBe(false);
  });

  it('still writes the claim when push.send throws', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    await seedAdminWithToken(t, 'boss', 'boss-tok');
    t.push.shouldThrow = true;

    const { claimId } = await submitNewClaim(t, alice);

    expect(await getClaim(t.deps.db, claimId)).not.toBeNull();
  });

  it('sends no second notification on an idempotent resubmit-retry of a new claim', async () => {
    const t = makeTestDeps();
    await seedCounter(t.deps);
    const alice = await seedActor(t.deps, 'alice');
    await seedAdminWithToken(t, 'boss', 'boss-tok');

    const claimId = newClaimId(t.deps);
    const attachmentIds = await uploadFiles(t, alice, claimId, [jpgFile()]);
    const req = {
      claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK, attachmentIds,
      resubmit: false, saveBankToProfile: false,
    };
    await submitClaim(t.deps, alice, req);
    expect(t.push.calls).toHaveLength(1);
    await submitClaim(t.deps, alice, req);
    expect(t.push.calls).toHaveLength(1);
  });
});
