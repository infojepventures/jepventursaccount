import {
  formatCents, MAX_ATTACHMENTS, MIN_ATTACHMENTS, parseAmountToCents, validateBank, validateItems,
  type BankDetails, type ClaimDoc, type ClaimItem,
} from '@jep/shared';
import { newKey, type RemoteAttachment } from './types';

export interface DraftItem {
  key: string;
  description: string;
  amount: string;
  reference: string;
}

export interface ClaimDraft {
  items: DraftItem[];
  bank: BankDetails;
  saveBankToProfile: boolean;
}

const EMPTY_BANK: BankDetails = { bankName: '', accountHolder: '', accountNumber: '' };
export const emptyItem = (): DraftItem => ({ key: newKey(), description: '', amount: '', reference: '' });

export function emptyDraft(bank: BankDetails | null): ClaimDraft {
  return { items: [emptyItem()], bank: bank ? { ...bank } : { ...EMPTY_BANK }, saveBankToProfile: false };
}

export function draftFromClaim(c: ClaimDoc): ClaimDraft {
  return {
    items: c.items.map((i) => ({
      key: newKey(),
      description: i.description,
      amount: formatCents(i.amountCents),
      reference: i.reference ?? '',
    })),
    bank: { ...c.payment },
    saveBankToProfile: false,
  };
}

export function remoteAttachments(c: ClaimDoc): RemoteAttachment[] {
  return c.attachments.map((a) => ({
    key: newKey(), kind: 'remote', driveFileId: a.driveFileId, name: a.name, mimeType: a.mimeType, size: a.size,
  }));
}

export function draftTotalCents(d: ClaimDraft): number {
  return d.items.reduce((sum, i) => sum + (parseAmountToCents(i.amount) ?? 0), 0);
}

/** Field errors for one item (shown on its tab). */
export function itemErrors(item: DraftItem): string[] {
  const errors: string[] = [];
  if (!item.description.trim()) errors.push('description is required');
  const cents = parseAmountToCents(item.amount);
  if (cents === null) errors.push('enter an amount like 12.50');
  else if (cents <= 0) errors.push('amount must be greater than 0');
  return errors;
}

export function draftErrors(d: ClaimDraft, attachmentCount: number): string[] {
  const errors: string[] = [];
  d.items.forEach((item, i) => {
    for (const e of itemErrors(item)) errors.push(`Item ${i + 1}: ${e}`);
  });
  if (d.items.length === 0) errors.push('Add at least one item');
  if (errors.length === 0) errors.push(...validateItems(draftToItems(d)));
  errors.push(...validateBank(d.bank));
  if (attachmentCount < MIN_ATTACHMENTS || attachmentCount > MAX_ATTACHMENTS) {
    errors.push(`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} receipts`);
  }
  return errors;
}

export function draftToItems(d: ClaimDraft): ClaimItem[] {
  return d.items.map((i) => {
    const reference = i.reference.trim();
    return {
      description: i.description.trim(),
      amountCents: parseAmountToCents(i.amount) ?? 0,
      ...(reference ? { reference } : {}),
    };
  });
}

/** True once the user has changed anything in the draft (item fields, item count, Pay to, save-to-profile). */
export function draftIsDirty(initial: ClaimDraft, current: ClaimDraft): boolean {
  const itemsOf = (d: ClaimDraft) => d.items.map((i) => [i.reference.trim(), i.description.trim(), i.amount.trim()].join('\u0000'));
  const a = itemsOf(initial);
  const b = itemsOf(current);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
  const bankOf = (d: ClaimDraft) => [d.bank.bankName, d.bank.accountHolder, d.bank.accountNumber].map((s) => s.trim()).join('\u0000');
  return bankOf(initial) !== bankOf(current) || initial.saveBankToProfile !== current.saveBankToProfile;
}
