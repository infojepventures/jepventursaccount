import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const user = (role: 'member' | 'admin') => ({
  email: `${role}@example.com`,
  name: 'Name',
  position: 'Pos',
  role,
  active: true,
  bank: null,
  authProvider: 'password',
});

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'demo-jep',
    firestore: {
      rules: readFileSync(path.resolve('..', 'firebase', 'firestore.rules'), 'utf8'),
      host: host!,
      port: Number(port),
    },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), user('member'));
    await setDoc(doc(db, 'users/bob'), user('member'));
    await setDoc(doc(db, 'users/boss'), user('admin'));
    await setDoc(doc(db, 'claims/c1'), { applicant: { uid: 'alice', name: 'A', position: 'P' }, status: 'submitted' });
    await setDoc(doc(db, 'invites/x@example.com'), { role: 'member' });
    await setDoc(doc(db, 'counters/claimSeq'), { next: 1 });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('users', () => {
  it('owner and admins can read; others cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
    await assertSucceeds(getDoc(doc(as('boss'), 'users/alice')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice')));
  });
  it('owner may edit profile fields but not role or active', async () => {
    const db = as('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice'), {
        name: 'Alice Tan',
        position: 'Exec',
        bank: { bankName: 'Maybank', accountHolder: 'Alice', accountNumber: '1234' },
      }),
    );
    await assertFails(updateDoc(doc(db, 'users/alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users/alice'), { active: false }));
    await assertFails(updateDoc(doc(db, 'users/alice'), { bank: { bankName: 'x', evil: true } }));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice'), { name: 'Hacked' }));
  });
});

describe('claims', () => {
  it('applicant and admins can read; other members cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'claims/c1')));
    await assertSucceeds(getDoc(doc(as('boss'), 'claims/c1')));
    await assertFails(getDoc(doc(as('bob'), 'claims/c1')));
  });
  it('members can list only with their own uid filter', async () => {
    await assertSucceeds(getDocs(query(collection(as('alice'), 'claims'), where('applicant.uid', '==', 'alice'))));
    await assertFails(getDocs(collection(as('alice'), 'claims')));
    await assertSucceeds(getDocs(collection(as('boss'), 'claims')));
  });
  it('nobody can write claims from the client', async () => {
    await assertFails(setDoc(doc(as('alice'), 'claims/new1'), { applicant: { uid: 'alice' } }));
    await assertFails(updateDoc(doc(as('boss'), 'claims/c1'), { status: 'approved' }));
  });
});

describe('invites and counters', () => {
  it('only admins read invites; nobody touches counters', async () => {
    await assertSucceeds(getDoc(doc(as('boss'), 'invites/x@example.com')));
    await assertFails(getDoc(doc(as('alice'), 'invites/x@example.com')));
    await assertFails(getDoc(doc(as('boss'), 'counters/claimSeq')));
    await assertFails(setDoc(doc(as('boss'), 'counters/claimSeq'), { next: 99 }));
  });
});

describe('pushTokens', () => {
  it('clients cannot read or write, even their own', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'pushTokens/tok1'), { uid: 'alice', platform: 'android' });
    });
    await assertFails(getDoc(doc(as('alice'), 'pushTokens/tok1')));
    await assertFails(getDoc(doc(as('boss'), 'pushTokens/tok1')));
    await assertFails(setDoc(doc(as('alice'), 'pushTokens/tok2'), { uid: 'alice', platform: 'android' }));
  });
});

describe('appConfig', () => {
  it('signed-in users can read the app version config; nobody writes it from the client', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'appConfig/android'), { latestVersionCode: 4, apkUrl: 'https://expo.dev/a.apk' });
    });
    await assertSucceeds(getDoc(doc(as('alice'), 'appConfig/android')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'appConfig/android')));
    await assertFails(setDoc(doc(as('boss'), 'appConfig/android'), { latestVersionCode: 99, apkUrl: 'https://evil.test/x.apk' }));
  });
});
