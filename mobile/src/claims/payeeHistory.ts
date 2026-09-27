import type { BankDetails } from '@jep/shared';

/**
 * Which receipts overwrote an item's payee, oldest first, each with the value from just before it did
 * (null = the item used the claim's default Pay to). The last entry is the receipt whose details show now.
 */
export type PayeeHistory<T = BankDetails | null> = { key: string; before: T }[];

/** Records that receipt `key` just overwrote the payee, which was `before`. A re-read keeps its first "before". */
export function recordPayeeChange<T>(history: PayeeHistory<T>, key: string, before: T): PayeeHistory<T> {
  if (history.some((e) => e.key === key)) return history;
  return [...history, { key, before: before && typeof before === 'object' ? { ...before } : before }];
}

/**
 * Receipts were removed. Returns the history without them and, when the receipt now showing was among them,
 * what to put back (`restore.value`, possibly null = back to the default); otherwise `restore` is null and the
 * payee stays. A removed older entry hands its "before" to the next entry, so removing that one later still
 * goes back far enough.
 */
export function removePayeeSources<T>(
  history: PayeeHistory<T>,
  removed: string[],
): { history: PayeeHistory<T>; restore: { value: T } | null } {
  const gone = new Set(removed);
  if (!history.some((e) => gone.has(e.key))) return { history, restore: null };

  const out: PayeeHistory<T> = [];
  let carried: { value: T } | null = null; // "before" of removed entries waiting for the next kept one
  for (const entry of history) {
    if (gone.has(entry.key)) {
      carried ??= { value: entry.before };
      continue;
    }
    out.push(carried ? { key: entry.key, before: carried.value } : entry);
    carried = null;
  }
  return { history: out, restore: carried };
}
