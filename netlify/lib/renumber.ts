import { refBaseFor, refNoFor, type ClaimStatus } from '@jep/shared';

export interface RenumberInput {
  id: string;
  submittedAt: Date;
  status: ClaimStatus;
  refNo: string;
}

export interface RenumberChange {
  id: string;
  from: string;
  refBase: string;
  refNo: string;
}

/**
 * One-off move to PR-JEP-{submission yyyyMM}-{NNNN}-{status}: every claim is numbered from 0001 in submission
 * order (ties by id, so a rerun is identical), and the counter continues after the last number.
 */
export function planRenumber(claims: RenumberInput[]): { changes: RenumberChange[]; nextCounter: number } {
  const ordered = [...claims].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const changes = ordered.map((c, i) => {
    const refBase = refBaseFor(c.submittedAt, i + 1);
    return { id: c.id, from: c.refNo, refBase, refNo: refNoFor(refBase, c.status) };
  });
  return { changes, nextCounter: changes.length + 1 };
}
