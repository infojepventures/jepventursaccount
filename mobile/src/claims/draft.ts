import {
  formatCents, MAX_ATTACHMENTS, MIN_ATTACHMENTS, parseAmountToCents, validateBank, validateItems,
  type BankDetails, type ClaimDoc, type ClaimItem,
} from '@jep/shared';
import { newKey, type RemoteAttachment } from './types';

export interface DraftItem {
  key: string;
  description: string;
  amount: string;
}

export interface ClaimDraft {
  items: DraftItem[];
  bank: BankDetails;
  saveBankToProfile: boolean;
}

const EMPTY_BANK: BankDetails = { bankName: '', accountHolder: '', accountNumber: '' };
export const emptyItem = (): DraftItem => ({ key: newKey(), description: '', amount: '' });

export function emptyDraft(bank: BankDetails | null): ClaimDraft {
  return { items: [emptyItem()], bank: bank ? { ...bank } : { ...EMPTY_BANK }, saveBankToProfile: false };
}

export function draftFromClaim(c: ClaimDoc): ClaimDraft {
  return {
    items: c.items.map((i) => ({ key: newKey(), description: i.description, amount: formatCents(i.amountCents) })),
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

export function draftErrors(d: ClaimDraft, attachmentCount: number): string[] {
  const errors: string[] = [];
  d.items.forEach((item, i) => {
    if (!item.description.trim()) errors.push(`Item ${i + 1}: description is required`);
    const cents = parseAmountToCents(item.amount);
    if (cents === null) errors.push(`Item ${i + 1}: enter an amount like 12.50`);
    else if (cents <= 0) errors.push(`Item ${i + 1}: amount must be greater than 0`);
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
  return d.items.map((i) => ({ description: i.description.trim(), amountCents: parseAmountToCents(i.amount) ?? 0 }));
}
