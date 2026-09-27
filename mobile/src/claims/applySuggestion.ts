import { formatCents, type AttachmentSuggestion } from '@jep/shared';
import type { ClaimDraft, DraftItem } from './draft';

export interface ApplySuggestionOpts {
  /** True once the user has edited this item's payee (or, for its default payee, the default Pay to). */
  payeeEditedByUser: boolean;
}

export interface ApplySuggestionResult {
  draft: ClaimDraft;
  /** Field keys the suggestion filled in, e.g. `item:{key}:reference`, `item:{key}:payee:accountNumber`. */
  aiFields: Set<string>;
}

const sameHolder = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Applies one receipt's OCR suggestion to the claim draft. The receipt belongs to one item (its tab), whose
 * fields are overwritten with whatever the suggestion read; a payee it read becomes that item's own payee
 * (items with different payees are submitted as separate claims). Pure: returns a new draft plus the field
 * keys that were AI-filled (for an "AI" badge in the UI).
 */
export function applySuggestion(
  draft: ClaimDraft,
  itemKey: string,
  suggestion: AttachmentSuggestion,
  opts: ApplySuggestionOpts,
): ApplySuggestionResult {
  const aiFields = new Set<string>();
  const item = draft.items.find((i) => i.key === itemKey);
  if (!item) return { draft, aiFields };

  const patch: Partial<DraftItem> = {};
  if (suggestion.reference !== undefined) patch.reference = suggestion.reference;
  if (suggestion.description !== undefined) patch.description = suggestion.description;
  if (suggestion.amountCents !== undefined) patch.amount = formatCents(suggestion.amountCents);
  for (const field of Object.keys(patch)) aiFields.add(`item:${itemKey}:${field}`);

  const read = suggestion.payee;
  if (read && !opts.payeeEditedByUser && (read.accountHolder !== undefined || read.accountNumber !== undefined)) {
    const current = item.payee ?? draft.bank;
    // A different supplier starts blank, so its details never mix with (say) the claimant's own bank name.
    const base =
      read.accountHolder !== undefined && !sameHolder(read.accountHolder, current.accountHolder)
        ? { bankName: '', accountHolder: '', accountNumber: '' }
        : { ...current };
    if (read.accountHolder !== undefined) base.accountHolder = read.accountHolder;
    if (read.bankName !== undefined) base.bankName = read.bankName;
    if (read.accountNumber !== undefined) base.accountNumber = read.accountNumber;
    patch.payee = base;
    for (const field of ['accountHolder', 'bankName', 'accountNumber'] as const) {
      if (read[field] !== undefined) aiFields.add(`item:${itemKey}:payee:${field}`);
    }
  }

  if (Object.keys(patch).length === 0) return { draft, aiFields };
  return { draft: { ...draft, items: draft.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }, aiFields };
}
