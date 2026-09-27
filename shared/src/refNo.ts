import { formatYyyyMm } from './dates';
import type { ClaimStatus } from './types';

export const REF_PREFIX = 'PR-JEP';

/**
 * Ref no. = `PR-JEP-{submission yyyyMM}-{global sequence, 4+ digits}-{status}`, e.g. PR-JEP-202609-0005-Draft.
 * The number is taken when the claim is first submitted (the counter never resets); only the suffix follows
 * the status afterwards.
 */
const SUFFIX: Record<ClaimStatus, string> = {
  submitted: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** The fixed part of a claim's ref no.: prefix, submission month (Malaysia time) and sequence. */
export function refBaseFor(submittedAt: Date, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid claim sequence ${seq}`);
  return `${REF_PREFIX}-${formatYyyyMm(submittedAt)}-${String(seq).padStart(4, '0')}`;
}

/** The full ref no. for a claim in `status`. */
export function refNoFor(refBase: string, status: ClaimStatus): string {
  return `${refBase}-${SUFFIX[status]}`;
}

/** The base of a current-format ref no., or null for older formats (e.g. PR-JEP-202609-draft / -001). */
export function refBaseOf(refNo: string): string | null {
  const m = /^(PR-JEP-\d{6}-\d{4,})-(?:Draft|Approved|Rejected|Paid|Cancelled)$/.exec(refNo);
  return m ? m[1]! : null;
}

/**
 * The ref no. as shown in the app and on the PDF: the number without its status suffix. The suffix stays in
 * `refNo` itself, which names the PDF, its Drive folder and the Sheet row.
 */
export function displayRefNo(claim: { refNo: string; refBase?: string }): string {
  return claim.refBase || refBaseOf(claim.refNo) || claim.refNo;
}

export function refNoYear(refNo: string): string {
  const m = /^PR-JEP-(\d{4})\d{2}-/.exec(refNo);
  if (!m || !m[1]) throw new Error(`Invalid refNo ${refNo}`);
  return m[1];
}
