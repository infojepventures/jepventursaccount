import { formatCents } from './money';

export function sanitizeFileNamePart(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

export function claimPdfFileName(refNo: string, accountHolder: string, totalCents: number): string {
  const holder = sanitizeFileNamePart(accountHolder) || 'Unknown';
  return `${refNo}-${holder}-${formatCents(totalCents)}.pdf`;
}

/** Drive's web link for a file. */
export const driveFileUrl = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/view`;

/** Link to a claim's PDF for sharing: its short link when one was made, else the Drive link. */
export function claimPdfLink(pdf: { driveFileId: string | null; shortUrl?: string | null }): string | null {
  if (!pdf.driveFileId) return null;
  return pdf.shortUrl || driveFileUrl(pdf.driveFileId);
}
