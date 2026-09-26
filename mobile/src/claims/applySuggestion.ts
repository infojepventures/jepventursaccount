import { formatCents, type AttachmentSuggestion } from '@jep/shared';
import { newKey } from './types';
import type { ClaimDraft, DraftItem } from './draft';

const isItemEmpty = (i: DraftItem) => !i.reference.trim() && !i.description.trim() && !i.amount.trim();

export interface ApplySuggestionOpts {
  /** True once the user has typed into any "Pay to" field in this form session. */
  payeeEditedByUser: boolean;
}

export interface ApplySuggestionResult {
  draft: ClaimDraft;
  /** Field keys the suggestion filled in, e.g. `item:{key}:reference`, `bank:accountNumber`. */
  aiFields: Set<string>;
}

/**
 * Applies one attachment's OCR suggestion to a claim draft. Pure: takes the current draft and
 * returns a new one, plus the set of field keys that were AI-filled (for an "AI" badge in the UI).
 */
export function applySuggestion(draft: ClaimDraft, suggestion: AttachmentSuggestion, opts: ApplySuggestionOpts): ApplySuggestionResult {
  const aiFields = new Set<string>();
  let items = draft.items;

  const hasItemData = suggestion.reference !== undefined || suggestion.description !== undefined || suggestion.amountCents !== undefined;
  if (hasItemData) {
    const newItem: DraftItem = {
      key: newKey(),
      reference: suggestion.reference ?? '',
      description: suggestion.description ?? '',
      amount: suggestion.amountCents !== undefined ? formatCents(suggestion.amountCents) : '',
    };
    const replaceOnlyEmpty = draft.items.length === 1 && isItemEmpty(draft.items[0]!);
    items = replaceOnlyEmpty ? [newItem] : [...draft.items, newItem];
    if (suggestion.reference !== undefined) aiFields.add(`item:${newItem.key}:reference`);
    if (suggestion.description !== undefined) aiFields.add(`item:${newItem.key}:description`);
    if (suggestion.amountCents !== undefined) aiFields.add(`item:${newItem.key}:amount`);
  }

  let bank = draft.bank;
  const payee = suggestion.payee;
  if (payee && !opts.payeeEditedByUser && (payee.accountHolder !== undefined || payee.accountNumber !== undefined)) {
    bank = { ...bank };
    if (payee.accountHolder !== undefined) {
      bank.accountHolder = payee.accountHolder;
      aiFields.add('bank:accountHolder');
    }
    if (payee.bankName !== undefined) {
      bank.bankName = payee.bankName;
      aiFields.add('bank:bankName');
    }
    if (payee.accountNumber !== undefined) {
      bank.accountNumber = payee.accountNumber;
      aiFields.add('bank:accountNumber');
    }
  }

  return { draft: { ...draft, items, bank }, aiFields };
}
