import { formatYyyyMm } from './dates';

export const REF_PREFIX = 'PR-JEP';

/**
 * Ref no. = `PR-JEP-{submission yyyyMM}-{global sequence, 4+ digits}`, e.g. PR-JEP-202609-0005. The number is
 * taken when the claim is first submitted (the counter never resets) and never changes; the status only shows
 * at the end of the PDF's file name (see claimPdfFileName).
 */
export function claimRefNo(submittedAt: Date, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid claim sequence ${seq}`);
  return `${REF_PREFIX}-${formatYyyyMm(submittedAt)}-${String(seq).padStart(4, '0')}`;
}

/** False for claims from before numbering-on-submit (PR-JEP-yyyyMM-draft / -001), which get a number on their next change. */
export function isNumberedRefNo(refNo: string): boolean {
  return /^PR-JEP-\d{6}-\d{4,}$/.test(refNo);
}

export function refNoYear(refNo: string): string {
  const m = /^PR-JEP-(\d{4})\d{2}-/.exec(refNo);
  if (!m || !m[1]) throw new Error(`Invalid refNo ${refNo}`);
  return m[1];
}
