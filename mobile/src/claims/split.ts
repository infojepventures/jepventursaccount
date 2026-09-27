import { MAX_ATTACHMENTS, MIN_ATTACHMENTS, parseAmountToCents, validateBank, type BankDetails } from '@jep/shared';
import type { ClaimDraft, DraftItem } from './draft';
import { receiptsForItem, unlinkedReceipts } from './itemReceipts';
import type { AnyAttachment } from './types';

/** One claim to submit: the items (and their receipts) that pay the same person. */
export interface ClaimGroup {
  key: string;
  payee: BankDetails;
  items: DraftItem[];
  attachments: AnyAttachment[];
  totalCents: number;
}

/** An item pays its own payee when it has one, else the claim's default "Pay to". */
export function effectivePayee(draft: ClaimDraft, item: DraftItem): BankDetails {
  return item.payee ?? draft.bank;
}

/** Same person if holder, bank and account number match, ignoring case, spaces and punctuation in the number. */
export function payeeKey(p: BankDetails): string {
  const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return [norm(p.accountHolder), norm(p.bankName), (p.accountNumber ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()].join('|');
}

/**
 * Groups the draft into one claim per payee (first-appearance order). Each claim gets its items' receipts;
 * receipts not tied to an item (a resubmitted claim's saved files) go to the first claim.
 */
export function splitByPayee(draft: ClaimDraft, attachments: AnyAttachment[]): ClaimGroup[] {
  const groups: ClaimGroup[] = [];
  const byKey = new Map<string, ClaimGroup>();
  for (const item of draft.items) {
    const payee = effectivePayee(draft, item);
    const key = payeeKey(payee);
    let group = byKey.get(key);
    if (!group) {
      group = { key, payee, items: [], attachments: [], totalCents: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    group.attachments.push(...receiptsForItem(attachments, item.key));
    group.totalCents += parseAmountToCents(item.amount) ?? 0;
  }
  const unlinked = unlinkedReceipts(attachments, draft.items);
  if (groups[0] && unlinked.length) groups[0].attachments = [...unlinked, ...groups[0].attachments];
  return groups;
}

/** Problems that block submitting, per claim. Single-claim messages stay as before; split claims name the payee. */
export function splitErrors(groups: ClaimGroup[], opts: { resubmit: boolean }): string[] {
  if (opts.resubmit && groups.length > 1) {
    return ['A resubmitted claim can have only one payee. Remove the other payee, or submit it as a new claim.'];
  }
  const errors: string[] = [];
  const single = groups.length <= 1;
  for (const g of groups) {
    const prefix = single ? '' : `Pay to ${g.payee.accountHolder.trim() || 'another payee'}: `;
    for (const e of validateBank(g.payee)) errors.push(prefix + (single ? e : e.charAt(0).toUpperCase() + e.slice(1)));
    const n = g.attachments.length;
    if (single) {
      if (n < MIN_ATTACHMENTS || n > MAX_ATTACHMENTS) errors.push(`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} receipts`);
    } else if (n < MIN_ATTACHMENTS) {
      errors.push(`${prefix}add at least one receipt`);
    } else if (n > MAX_ATTACHMENTS) {
      errors.push(`${prefix}at most ${MAX_ATTACHMENTS} receipts`);
    }
  }
  return errors;
}

/**
 * Payees to offer as one-tap choices in an item's Pay to: the default (when filled in) and every payee another
 * item uses, once each in first-appearance order, leaving out the one the item already pays.
 */
export function payeeChoices(draft: ClaimDraft, itemKey: string): { payee: BankDetails; isDefault: boolean }[] {
  const item = draft.items.find((i) => i.key === itemKey);
  const seen = new Set<string>(item ? [payeeKey(effectivePayee(draft, item))] : []);
  const out: { payee: BankDetails; isDefault: boolean }[] = [];
  const offer = (payee: BankDetails, isDefault: boolean) => {
    const k = payeeKey(payee);
    if (seen.has(k) || validateBank(payee).length) return;
    seen.add(k);
    out.push({ payee, isDefault });
  };
  offer(draft.bank, true);
  for (const other of draft.items) if (other.key !== itemKey && other.payee) offer(other.payee, false);
  return out;
}
