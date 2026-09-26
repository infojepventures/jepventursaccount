import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../lib/actor';
import { COL } from '../../lib/firestore';
import { ensureSession } from '../../lib/services/session';
import { makeTestDeps, resetEmulators, seedUser } from './helpers';

beforeEach(resetEmulators);

const google = (uid: string, email: string, emailVerified = true) => ({
  uid, email, emailVerified, name: 'New Person', provider: 'google.com',
});

describe('ensureSession', () => {
  it('creates the user from an invite on first Google sign-in', async () => {
    const { deps } = makeTestDeps();
    await deps.db.collection(COL.invites).doc('new@gmail.com').set({ role: 'admin', invitedByUid: 'setup', invitedAt: Timestamp.now() });
    const res = await ensureSession(deps, google('u1', 'New@Gmail.com'));
    expect(res).toEqual({ uid: 'u1', role: 'admin', profileComplete: false });
    const user = (await deps.db.collection(COL.users).doc('u1').get()).data();
    expect(user).toMatchObject({ email: 'new@gmail.com', name: 'New Person', role: 'admin', active: true, authProvider: 'google' });
    expect((await deps.db.collection(COL.invites).doc('new@gmail.com').get()).exists).toBe(false);
  });

  it('rejects uninvited or unverified accounts', async () => {
    const { deps } = makeTestDeps();
    await expect(ensureSession(deps, google('u2', 'stranger@gmail.com'))).rejects.toMatchObject({ code: 'NOT_INVITED' });
    await deps.db.collection(COL.invites).doc('x@gmail.com').set({ role: 'member', invitedByUid: 's', invitedAt: Timestamp.now() });
    await expect(ensureSession(deps, google('u3', 'x@gmail.com', false))).rejects.toMatchObject({ code: 'NOT_INVITED' });
  });

  it('returns existing users and blocks inactive ones', async () => {
    const { deps } = makeTestDeps();
    await seedUser(deps, 'alice');
    expect(await ensureSession(deps, google('alice', 'alice@example.com'))).toEqual({
      uid: 'alice', role: 'member', profileComplete: true,
    });
    await seedUser(deps, 'gone', { active: false });
    await expect(ensureSession(deps, google('gone', 'gone@example.com'))).rejects.toMatchObject({ code: 'INACTIVE' });
    await expect(loadActor(deps, 'gone')).rejects.toMatchObject({ code: 'INACTIVE' });
    await expect(loadActor(deps, 'nobody')).rejects.toMatchObject({ code: 'NOT_INVITED' });
  });
});
