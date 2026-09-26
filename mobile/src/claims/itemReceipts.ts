import type { AnyAttachment } from './types';

/**
 * Receipts are tied to an item (its tab) only while the form is open: `itemKey` is never sent to the server.
 * Receipts with no item that still exists — a resubmitted claim's saved files — are "unlinked".
 */
export function receiptsForItem(list: AnyAttachment[], itemKey: string): AnyAttachment[] {
  return list.filter((a) => a.itemKey === itemKey);
}

export function unlinkedReceipts(list: AnyAttachment[], items: { key: string }[]): AnyAttachment[] {
  const keys = new Set(items.map((i) => i.key));
  return list.filter((a) => !a.itemKey || !keys.has(a.itemKey));
}

/**
 * Submission order: unlinked receipts first (a resubmitted claim's saved files keep their place), then each
 * item's receipts in item order — so the merged PDF follows the items.
 */
export function orderByItem(list: AnyAttachment[], items: { key: string }[]): AnyAttachment[] {
  return [...unlinkedReceipts(list, items), ...items.flatMap((i) => receiptsForItem(list, i.key))];
}
