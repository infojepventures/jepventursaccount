import { formatCents } from './money';

export function sanitizeFileNamePart(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

export function claimPdfFileName(refNo: string, accountHolder: string, totalCents: number): string {
  const holder = sanitizeFileNamePart(accountHolder) || 'Unknown';
  return `${refNo}-${holder}-${formatCents(totalCents)}.pdf`;
}
