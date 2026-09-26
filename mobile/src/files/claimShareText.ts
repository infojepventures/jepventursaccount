import { claimPdfLink, formatRM } from '@jep/shared';

export interface WhatsAppClaimTextInput {
  refNo: string;
  totalCents: number;
  items: { description: string; amountCents: number; reference?: string }[];
  payment: { bankName: string; accountHolder: string; accountNumber: string };
  pdf: { driveFileId: string | null; fileName: string | null; shortUrl?: string | null };
}

/** Collapses newlines/whitespace runs inside a value into single spaces, then trims. */
function clean(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Normalises an account number for grouping by stripping everything but letters/digits. */
function normalizeAccountNumber(value: string): string {
  return clean(value).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/** Case/whitespace-insensitive key used to group claims sharing the same payee account. */
function payeeGroupKey(payment: WhatsAppClaimTextInput['payment']): string {
  return [
    clean(payment.accountHolder).toLowerCase(),
    clean(payment.bankName).toLowerCase(),
    normalizeAccountNumber(payment.accountNumber),
  ].join('|');
}

/** Builds one payee group's lines: the quoted supplier header, each claim's doc/items block, then the totals footer. */
function buildGroupText(claims: WhatsAppClaimTextInput[]): string {
  const first = claims[0];
  const bankName = clean(first.payment.bankName);
  const accountNumber = clean(first.payment.accountNumber);
  const accountHolder = clean(first.payment.accountHolder);

  const lines: string[] = [`> *Supplier: ${accountHolder}*`];

  claims.forEach((claim, ci) => {
    const refNo = clean(claim.refNo);
    if (claim.pdf.fileName) lines.push(clean(claim.pdf.fileName).replace(/\.pdf$/i, ''));
    const link = claimPdfLink(claim.pdf);
    if (link) lines.push(link);
    lines.push('');

    claim.items.forEach((item, ii) => {
      lines.push(`> ${clean(item.description)}`);
      lines.push(`${clean(item.reference ?? '') || refNo} - ${formatRM(item.amountCents)}`);
      if (ii < claim.items.length - 1) lines.push('');
    });

    if (ci < claims.length - 1) lines.push('', '');
  });

  const total = claims.reduce((sum, c) => sum + c.totalCents, 0);
  lines.push('', `Total ${formatRM(total)}`, bankName, accountNumber, accountHolder, '', '*===============*');

  return lines.join('\n');
}

/**
 * Builds the WhatsApp-markdown text message for sharing one or more claims at once, grouped by
 * payee account (normalised account holder + bank name + account number, ignoring case, whitespace
 * and non-alphanumeric characters in the account number). Groups are ordered by first appearance;
 * claims within a group keep their input order. Pure and native-mock-free so it's directly
 * unit-testable.
 */
export function buildWhatsAppBatchText(claims: WhatsAppClaimTextInput[]): string {
  const order: string[] = [];
  const byKey = new Map<string, WhatsAppClaimTextInput[]>();
  for (const claim of claims) {
    const key = payeeGroupKey(claim.payment);
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
      order.push(key);
    }
    group.push(claim);
  }

  return order.map((key) => buildGroupText(byKey.get(key)!)).join('\n\n');
}

/**
 * Builds the WhatsApp-markdown text message for a single claim's "WhatsApp" share button: a quoted
 * supplier line, document name and Drive link, one quoted block per item with its ref/amount, then a totals +
 * bank-details footer. Pure and native-mock-free so it's directly unit-testable.
 */
export function buildWhatsAppClaimText(claim: WhatsAppClaimTextInput): string {
  return buildWhatsAppBatchText([claim]);
}
