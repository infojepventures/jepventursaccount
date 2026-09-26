import { formatRM } from '@jep/shared';

export interface WhatsAppClaimTextInput {
  refNo: string;
  totalCents: number;
  items: { description: string; amountCents: number }[];
  payment: { bankName: string; accountHolder: string; accountNumber: string };
  pdf: { driveFileId: string | null };
}

/** Collapses newlines/whitespace runs inside a value into single spaces, then trims. */
function clean(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the WhatsApp-markdown text message for a claim's "WhatsApp" share button: a quoted
 * supplier line + Drive link, one quoted block per item with its ref/amount, then a totals +
 * bank-details footer. Pure and native-mock-free so it's directly unit-testable.
 */
export function buildWhatsAppClaimText(claim: WhatsAppClaimTextInput): string {
  const refNo = clean(claim.refNo);
  const bankName = clean(claim.payment.bankName);
  const accountNumber = clean(claim.payment.accountNumber);
  const accountHolder = clean(claim.payment.accountHolder);

  const lines: string[] = [`> *Supplier: ${accountHolder}*`];
  if (claim.pdf.driveFileId) {
    lines.push(`https://drive.google.com/file/d/${claim.pdf.driveFileId}/view`);
  }
  lines.push('');

  claim.items.forEach((item, i) => {
    lines.push(`> ${clean(item.description)}`);
    lines.push(`${refNo} - ${formatRM(item.amountCents)}`);
    if (i < claim.items.length - 1) lines.push('');
  });

  lines.push('', `Total ${formatRM(claim.totalCents)}`, bankName, accountNumber, accountHolder, '', '*===============*');

  return lines.join('\n');
}
