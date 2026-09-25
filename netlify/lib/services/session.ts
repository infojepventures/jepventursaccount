import { Timestamp } from 'firebase-admin/firestore';
import { isProfileComplete, type InviteDoc, type SessionResponse, type UserDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, userRef } from '../firestore';

export interface SessionInput {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
  provider: string;
}

/** Called after every sign-in. Turns an invite into a user on first Google sign-in. */
export async function ensureSession(deps: Deps, s: SessionInput): Promise<SessionResponse> {
  const uref = userRef(deps.db, s.uid);
  const user = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    if (snap.exists) return snap.data() as UserDoc;
    if (!s.email || !s.emailVerified) throw fail.notInvited();
    const email = s.email.toLowerCase();
    const iref = deps.db.collection(COL.invites).doc(email);
    const inv = await tx.get(iref);
    if (!inv.exists) throw fail.notInvited();
    const now = Timestamp.fromDate(deps.now());
    const doc: UserDoc = {
      email,
      name: s.name ?? '',
      position: '',
      role: (inv.data() as InviteDoc).role,
      active: true,
      bank: null,
      authProvider: s.provider === 'password' ? 'password' : 'google',
      createdAt: now,
      updatedAt: now,
    };
    tx.create(uref, doc);
    tx.delete(iref);
    return doc;
  });
  if (!user.active) throw fail.inactive();
  return { uid: s.uid, role: user.role, profileComplete: isProfileComplete(user) };
}
