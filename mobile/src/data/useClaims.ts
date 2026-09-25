import { collection, doc, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import type { ClaimDoc, ClaimStatus } from '@jep/shared';
import { db } from '../lib/firebase';
import { useLiveDoc, useLiveQuery, type Live } from './useLive';

export type ClaimRow = ClaimDoc & { id: string };
export type StatusFilter = ClaimStatus | 'all';

const toRow = (id: string, data: unknown) => ({ id, ...(data as ClaimDoc) });
const claims = collection(db, 'claims');

export function useMyClaims(uid: string | undefined, status: StatusFilter): Live<ClaimRow[]> {
  const constraints: QueryConstraint[] = [where('applicant.uid', '==', uid ?? '__none__')];
  if (status !== 'all') constraints.push(where('status', '==', status));
  constraints.push(orderBy('submittedAt', 'desc'), limit(200));
  return useLiveQuery(uid ? query(claims, ...constraints) : null, `mine:${uid}:${status}`, toRow);
}

export function useClaimsByStatus(status: StatusFilter, enabled: boolean): Live<ClaimRow[]> {
  const constraints: QueryConstraint[] = [];
  if (status !== 'all') constraints.push(where('status', '==', status));
  // Pending first-come-first-served; everything else newest first.
  constraints.push(orderBy('submittedAt', status === 'submitted' ? 'asc' : 'desc'), limit(300));
  return useLiveQuery(enabled ? query(claims, ...constraints) : null, `status:${status}:${enabled}`, toRow);
}

export function useClaim(id: string | undefined): Live<ClaimRow | null> {
  return useLiveDoc(id ? doc(db, 'claims', id) : null, `claim:${id}`, toRow);
}
