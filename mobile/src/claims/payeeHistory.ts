import type { BankDetails } from '@jep/shared';

/**
 * Which receipts overwrote "Pay to", oldest first, each with the bank details from just before it did.
 * The last entry is the receipt whose details are showing now.
 */
export type PayeeHistory = { key: string; before: BankDetails }[];

/** Records that receipt `key` just overwrote Pay to, which was `before`. A re-read keeps its first "before". */
export function recordPayeeChange(history: PayeeHistory, key: string, before: BankDetails): PayeeHistory {
  if (history.some((e) => e.key === key)) return history;
  return [...history, { key, before: { ...before } }];
}

/**
 * Receipts were removed. Returns the history without them and, when the receipt now showing was among them,
 * the details to put back (`restore`); otherwise `restore` is null and Pay to stays. A removed older entry
 * hands its "before" to the next entry, so removing that one later still goes back far enough.
 */
export function removePayeeSources(history: PayeeHistory, removed: string[]): { history: PayeeHistory; restore: BankDetails | null } {
  const gone = new Set(removed);
  if (!history.some((e) => gone.has(e.key))) return { history, restore: null };

  const out: PayeeHistory = [];
  let carried: BankDetails | null = null; // "before" of removed entries waiting for the next kept one
  for (const entry of history) {
    if (gone.has(entry.key)) {
      carried ??= entry.before;
      continue;
    }
    out.push(carried ? { key: entry.key, before: carried } : entry);
    carried = null;
  }
  return { history: out, restore: carried };
}
