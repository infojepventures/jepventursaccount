import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { refBaseFor, type ClaimDoc } from '@jep/shared';
import { CLAIM_SEQ_DOC, COL } from './firestore';

export const claimSeqRef = (db: Firestore) => db.collection(COL.counters).doc(CLAIM_SEQ_DOC);

export interface TakenRefBase {
  refBase: string;
  /** Applies the counter write; call after all of the transaction's reads. */
  commit: () => void;
}

/**
 * Takes the next claim number inside `tx` (the global counter never resets; it starts at 1 when missing) and
 * returns the ref base for a claim submitted at `submittedAt`. Reads only; the counter write happens on commit().
 */
export async function takeRefBase(tx: Transaction, db: Firestore, submittedAt: Date): Promise<TakenRefBase> {
  const ref = claimSeqRef(db);
  const snap = await tx.get(ref);
  const next = snap.exists ? (snap.data() as { next?: unknown }).next : 1;
  if (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 1) throw new Error('counters/claimSeq is corrupt');
  return { refBase: refBaseFor(submittedAt, next), commit: () => tx.set(ref, { next: next + 1 }, { merge: true }) };
}

/** The claim's ref base; a claim from before numbering-on-submit gets one now, from its submission month. */
export async function refBaseOfClaim(tx: Transaction, db: Firestore, claim: ClaimDoc): Promise<TakenRefBase> {
  if (claim.refBase) return { refBase: claim.refBase, commit: () => {} };
  return takeRefBase(tx, db, claim.submittedAt.toDate());
}
