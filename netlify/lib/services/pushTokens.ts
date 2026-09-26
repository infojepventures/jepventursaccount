import { Timestamp } from 'firebase-admin/firestore';
import type { RegisterPushTokenRequest, UnregisterPushTokenRequest } from '@jep/shared';
import type { Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL } from '../firestore';

const MAX_TOKEN_LEN = 4096;

export async function registerPushToken(
  deps: Deps,
  actor: Actor,
  req: RegisterPushTokenRequest,
): Promise<{ ok: true }> {
  if (typeof req?.token !== 'string' || req.token.length === 0 || req.token.length > MAX_TOKEN_LEN) {
    throw fail.invalid('Invalid push token');
  }
  if (req.platform !== 'android' && req.platform !== 'ios') {
    throw fail.invalid('platform must be android or ios');
  }
  await deps.db.collection(COL.pushTokens).doc(req.token).set({
    uid: actor.uid,
    platform: req.platform,
    updatedAt: Timestamp.fromDate(deps.now()),
  });
  return { ok: true };
}

export async function unregisterPushToken(
  deps: Deps,
  actor: Actor,
  req: UnregisterPushTokenRequest,
): Promise<{ ok: true }> {
  const token = typeof req?.token === 'string' ? req.token : '';
  if (token) {
    const ref = deps.db.collection(COL.pushTokens).doc(token);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as { uid: string }).uid === actor.uid) await ref.delete();
  }
  return { ok: true };
}
