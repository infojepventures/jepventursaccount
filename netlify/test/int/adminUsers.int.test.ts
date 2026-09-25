import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@jep/shared';
import { COL, getClaim } from '../../lib/firestore';
import { adminUsers } from '../../lib/services/adminUsers';
import { resyncSheet } from '../../lib/services/sheetSync';
import { makeTestDeps, resetEmulators, seedActor, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  const alice = await seedActor(t.deps, 'alice');
  return { t, boss, alice };
}

describe('adminUsers', () => {
  it('invites a Google email (lower-cased) and refuses existing users', async () => {
    const { t, boss } = await setup();
    await adminUsers(t.deps, boss, { action: 'invite', email: ' New@Gmail.com ', role: 'member' });
    expect((await t.deps.db.collection(COL.invites).doc('new@gmail.com').get()).data()).toMatchObject({ role: 'member', invitedByUid: 'boss' });
    await expect(adminUsers(t.deps, boss, { action: 'invite', email: 'alice@example.com', role: 'member' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await adminUsers(t.deps, boss, { action: 'deleteInvite', email: 'new@gmail.com' });
    expect((await t.deps.db.collection(COL.invites).doc('new@gmail.com').get()).exists).toBe(false);
  });

  it('creates email/password accounts', async () => {
    const { t, boss } = await setup();
    const res = await adminUsers(t.deps, boss, {
      action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'Lee Mei Ling', role: 'member',
    });
    expect(res.ok).toBe(true);
    const user = (await t.deps.db.collection(COL.users).doc(res.uid!).get()).data() as UserDoc;
    expect(user).toMatchObject({ email: 'lee@example.com', name: 'Lee Mei Ling', role: 'member', active: true, authProvider: 'password' });
    expect((await t.deps.auth.getUser(res.uid!)).email).toBe('lee@example.com');
    await expect(
      adminUsers(t.deps, boss, { action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'X', role: 'member' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      adminUsers(t.deps, boss, { action: 'createPasswordUser', email: 'b@example.com', password: 'short', name: 'X', role: 'member' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('changes roles and deactivates accounts, but never your own', async () => {
    const { t, boss } = await setup();
    const { uid } = await adminUsers(t.deps, boss, {
      action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'Lee', role: 'member',
    });
    await adminUsers(t.deps, boss, { action: 'setRole', uid: uid!, role: 'admin' });
    expect(((await t.deps.db.collection(COL.users).doc(uid!).get()).data() as UserDoc).role).toBe('admin');
    await adminUsers(t.deps, boss, { action: 'setActive', uid: uid!, active: false });
    expect(((await t.deps.db.collection(COL.users).doc(uid!).get()).data() as UserDoc).active).toBe(false);
    expect((await t.deps.auth.getUser(uid!)).disabled).toBe(true);
    await expect(adminUsers(t.deps, boss, { action: 'setRole', uid: 'boss', role: 'member' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminUsers(t.deps, boss, { action: 'setActive', uid: 'boss', active: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminUsers(t.deps, boss, { action: 'setRole', uid: 'ghost', role: 'admin' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is admin-only', async () => {
    const { t, alice } = await setup();
    await expect(adminUsers(t.deps, alice, { action: 'invite', email: 'x@y.com', role: 'admin' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('setActive on a user with no Auth account fails without touching Firestore', async () => {
    const { t, boss } = await setup();
    await seedActor(t.deps, 'ghostuser');
    await expect(adminUsers(t.deps, boss, { action: 'setActive', uid: 'ghostuser', active: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(((await t.deps.db.collection(COL.users).doc('ghostuser').get()).data() as UserDoc).active).toBe(true);
  });
});

describe('resyncSheet', () => {
  it('pushes claims whose Sheet sync failed', async () => {
    const { t, boss, alice } = await setup();
    t.sheets.failing = true;
    const { claimId } = await submitNewClaim(t, alice);
    t.sheets.failing = false;
    expect(await resyncSheet(t.deps, boss)).toEqual({ synced: 1, failed: 0 });
    expect((await getClaim(t.deps.db, claimId))!.sheetSynced).toBe(true);
    expect(t.sheets.rows.has(claimId)).toBe(true);
    await expect(resyncSheet(t.deps, alice)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
