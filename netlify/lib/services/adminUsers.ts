import { Timestamp } from 'firebase-admin/firestore';
import type { AdminUsersRequest, AdminUsersResponse, Role, UserDoc } from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, userRef } from '../firestore';

const isRole = (r: unknown): r is Role => r === 'member' || r === 'admin';

function normEmail(e: unknown): string {
  const email = typeof e === 'string' ? e.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail.invalid('A valid email is required');
  return email;
}

async function assertNoUserWithEmail(deps: Deps, email: string) {
  const existing = await deps.db.collection(COL.users).where('email', '==', email).limit(1).get();
  if (!existing.empty) throw fail.invalid('A user with this email already exists');
}

async function assertOtherExistingUser(deps: Deps, actor: Actor, uid: unknown): Promise<string> {
  if (typeof uid !== 'string' || !uid) throw fail.invalid('uid is required');
  if (uid === actor.uid) throw fail.forbidden('You cannot change your own account here');
  if (!(await userRef(deps.db, uid).get()).exists) throw fail.notFound('User not found');
  return uid;
}

export async function adminUsers(deps: Deps, actor: Actor, req: AdminUsersRequest): Promise<AdminUsersResponse> {
  assertAdmin(actor);
  const now = Timestamp.fromDate(deps.now());

  switch (req?.action) {
    case 'invite': {
      const email = normEmail(req.email);
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      await assertNoUserWithEmail(deps, email);
      await deps.db.collection(COL.invites).doc(email).set({ role: req.role, invitedByUid: actor.uid, invitedAt: now });
      return { ok: true };
    }
    case 'deleteInvite': {
      await deps.db.collection(COL.invites).doc(normEmail(req.email)).delete();
      return { ok: true };
    }
    case 'createPasswordUser': {
      const email = normEmail(req.email);
      const name = typeof req.name === 'string' ? req.name.trim() : '';
      if (!name || name.length > 100) throw fail.invalid('Name is required');
      if (typeof req.password !== 'string' || req.password.length < 8) {
        throw fail.invalid('Password must be at least 8 characters');
      }
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      await assertNoUserWithEmail(deps, email);
      let uid: string;
      try {
        uid = (await deps.auth.createUser({ email, password: req.password, displayName: name })).uid;
      } catch (e) {
        if ((e as { code?: string }).code === 'auth/email-already-exists') {
          throw fail.invalid('This email is already registered');
        }
        throw e;
      }
      const doc: UserDoc = {
        email, name, position: '', role: req.role, active: true, bank: null, authProvider: 'password', createdAt: now, updatedAt: now,
      };
      await userRef(deps.db, uid).set(doc);
      await deps.db.collection(COL.invites).doc(email).delete();
      return { ok: true, uid };
    }
    case 'setRole': {
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      const uid = await assertOtherExistingUser(deps, actor, req.uid);
      await userRef(deps.db, uid).update({ role: req.role, updatedAt: now });
      return { ok: true };
    }
    case 'setActive': {
      if (typeof req.active !== 'boolean') throw fail.invalid('active must be true or false');
      const uid = await assertOtherExistingUser(deps, actor, req.uid);
      await userRef(deps.db, uid).update({ active: req.active, updatedAt: now });
      await deps.auth.updateUser(uid, { disabled: !req.active });
      return { ok: true };
    }
    default:
      throw fail.invalid('Unknown action');
  }
}
