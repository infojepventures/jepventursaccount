import { formatCents, type AttachmentSuggestion } from '@jep/shared';
import type { ClaimDraft, DraftItem } from './draft';

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
 * Applies one receipt's OCR suggestion to the claim draft. The receipt belongs to one item (its tab), whose
 * fields are overwritten with whatever the suggestion read. Pure: returns a new draft plus the field keys
 * that were AI-filled (for an "AI" badge in the UI).
 */
export function applySuggestion(
  draft: ClaimDraft,
  itemKey: string,
  suggestion: AttachmentSuggestion,
  opts: ApplySuggestionOpts,
): ApplySuggestionResult {
  const aiFields = new Set<string>();
  let items = draft.items;

  const patch: Partial<DraftItem> = {};
  if (suggestion.reference !== undefined) patch.reference = suggestion.reference;
  if (suggestion.description !== undefined) patch.description = suggestion.description;
  if (suggestion.amountCents !== undefined) patch.amount = formatCents(suggestion.amountCents);
  if (Object.keys(patch).length && draft.items.some((i) => i.key === itemKey)) {
    items = draft.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i));
    for (const field of Object.keys(patch)) aiFields.add(`item:${itemKey}:${field}`);
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

  if (items === draft.items && bank === draft.bank) return { draft, aiFields };
  return { draft: { ...draft, items, bank }, aiFields };
}
