import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Role, UserDoc } from '@jep/shared';
import type { Deps } from './deps';
import { fail } from './errors';
import { userRef } from './firestore';

export interface Actor {
  uid: string;
  email: string;
  name: string;
  position: string;
  role: Role;
  isAdmin: boolean;
}

export async function verifyRequest(deps: Deps, req: Request): Promise<DecodedIdToken> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m || !m[1]) throw fail.unauthenticated();
  try {
    return await deps.auth.verifyIdToken(m[1], true);
  } catch {
    throw fail.unauthenticated('Your session has expired. Please sign in again.');
  }
}

export async function loadActor(deps: Deps, uid: string): Promise<Actor> {
  const snap = await userRef(deps.db, uid).get();
  if (!snap.exists) throw fail.notInvited();
  const u = snap.data() as UserDoc;
  if (!u.active) throw fail.inactive();
  return { uid, email: u.email, name: u.name, position: u.position, role: u.role, isAdmin: u.role === 'admin' };
}

export async function requireActor(deps: Deps, req: Request): Promise<Actor> {
  const token = await verifyRequest(deps, req);
  return loadActor(deps, token.uid);
}

export function assertAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw fail.forbidden('Only admins can do this.');
}
