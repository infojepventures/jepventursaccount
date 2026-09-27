import { formatCents } from './money';
import type { ClaimStatus } from './types';

export function sanitizeFileNamePart(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

/** The status at the end of a PDF's file name: anything not yet paid, rejected or cancelled is Pending. */
export const PDF_STATUS_LABEL: Record<ClaimStatus, string> = {
  submitted: 'Pending',
  approved: 'Pending',
  rejected: 'Rejected',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** `{ref no.}-{account holder}-{amount}-{status}.pdf`; the receipts folder in Drive gets the same name. */
export function claimPdfFileName(refNo: string, accountHolder: string, totalCents: number, status: ClaimStatus): string {
  const holder = sanitizeFileNamePart(accountHolder) || 'Unknown';
  return `${refNo}-${holder}-${formatCents(totalCents)}-${PDF_STATUS_LABEL[status]}.pdf`;
}

/** Drive's web link for a file. */
export const driveFileUrl = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/view`;

/** Link to a claim's PDF for sharing: its short link when one was made, else the Drive link. */
export function claimPdfLink(pdf: { driveFileId: string | null; shortUrl?: string | null }): string | null {
  if (!pdf.driveFileId) return null;
  return pdf.shortUrl || driveFileUrl(pdf.driveFileId);
}
