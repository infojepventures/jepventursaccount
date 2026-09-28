import { MAX_ATTACHMENTS } from '@jep/shared';
import { emptyItem, type DraftItem } from './draft';
import { receiptsForItem } from './itemReceipts';
import type { AnyAttachment, LocalAttachment } from './types';

const isBlank = (item: DraftItem, attachments: AnyAttachment[]) =>
  !item.description.trim() && !item.amount.trim() && !item.reference.trim() && receiptsForItem(attachments, item.key).length === 0;

/**
 * Receipts shared from another app each get their own item, so each is read into its own tab. The first one
 * reuses a still-blank item (a fresh form's empty first tab); what is already filled in is left alone.
 * Receipts beyond the claim's limit are dropped.
 */
export function planSharedReceipts(
  items: DraftItem[],
  attachments: AnyAttachment[],
  files: LocalAttachment[],
): { newItems: DraftItem[]; receipts: LocalAttachment[]; dropped: number } {
  const accepted = files.slice(0, Math.max(0, MAX_ATTACHMENTS - attachments.length));
  const blank = items.find((i) => isBlank(i, attachments));
  const newItems: DraftItem[] = [];
  const receipts = accepted.map((f, i) => {
    if (i === 0 && blank) return { ...f, itemKey: blank.key };
    const item = emptyItem();
    newItems.push(item);
    return { ...f, itemKey: item.key };
  });
  return { newItems, receipts, dropped: files.length - accepted.length };
}
