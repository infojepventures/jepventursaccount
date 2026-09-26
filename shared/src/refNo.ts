import { formatYyyyMm } from './dates';

export const REF_PREFIX = 'PR-JEP';

export function draftRefNo(submittedAt: Date): string {
  return `${REF_PREFIX}-${formatYyyyMm(submittedAt)}-draft`;
}

export function finalRefNo(approvedAt: Date, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid claim sequence ${seq}`);
  return `${REF_PREFIX}-${formatYyyyMm(approvedAt)}-${String(seq).padStart(3, '0')}`;
}

export function isDraftRefNo(refNo: string): boolean {
  return refNo.endsWith('-draft');
}

export function refNoYear(refNo: string): string {
  const m = /^PR-JEP-(\d{4})\d{2}-/.exec(refNo);
  if (!m || !m[1]) throw new Error(`Invalid refNo ${refNo}`);
  return m[1];
}
