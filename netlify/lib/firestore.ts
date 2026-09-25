import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { ClaimDoc } from '@jep/shared';

export const COL = {
  users: 'users', claims: 'claims', invites: 'invites', counters: 'counters', uploadFolders: 'uploadFolders',
} as const;
export const CLAIM_SEQ_DOC = 'claimSeq';

export const claimRef = (db: Firestore, claimId: string): DocumentReference => db.collection(COL.claims).doc(claimId);
export const userRef = (db: Firestore, uid: string): DocumentReference => db.collection(COL.users).doc(uid);

export async function getClaim(db: Firestore, claimId: string): Promise<ClaimDoc | null> {
  const snap = await claimRef(db, claimId).get();
  return snap.exists ? (snap.data() as ClaimDoc) : null;
}
