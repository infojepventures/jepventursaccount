import { collection } from 'firebase/firestore';
import type { InviteDoc, UserDoc } from '@jep/shared';
import { db } from '../lib/firebase';
import { useLiveQuery, type Live } from './useLive';

export type UserRow = UserDoc & { uid: string };
export type InviteRow = InviteDoc & { email: string };

export function useUsers(enabled: boolean): Live<UserRow[]> {
  const live = useLiveQuery(enabled ? collection(db, 'users') : null, `users:${enabled}`, (uid, d) => ({ uid, ...(d as UserDoc) }));
  return { ...live, data: [...live.data].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) };
}

export function useInvites(enabled: boolean): Live<InviteRow[]> {
  return useLiveQuery(enabled ? collection(db, 'invites') : null, `invites:${enabled}`, (email, d) => ({ email, ...(d as InviteDoc) }));
}
