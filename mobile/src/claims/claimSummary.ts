import { MIN_ATTACHMENTS, validateBank } from '@jep/shared';
import { draftTotalCents, itemErrors, type ClaimDraft } from './draft';
import type { AnyAttachment } from './types';

export interface ClaimSummary {
  totalCents: number;
  itemCount: number;
  receiptCount: number;
  /** Account holder from Pay to ('' until filled). */
  payee: string;
  /** Receipts still uploading or being read. */
  busyReceipts: number;
  /** Items missing a description or a valid amount, so the card can jump to them. */
  incompleteItems: { index: number; key: string }[];
  /** Plain-language problems that block submitting. */
  issues: string[];
  /** Nothing blocking and nothing still in progress. */
  ready: boolean;
}

/** Everything the summary card above the item tabs shows. Pure. */
export function claimSummary(draft: ClaimDraft, attachments: AnyAttachment[]): ClaimSummary {
  const incompleteItems = draft.items.flatMap((item, index) => (itemErrors(item).length ? [{ index, key: item.key }] : []));
  const local = attachments.filter((a) => a.kind === 'local');
  const failed = local.filter((a) => a.error).length;
  const busyReceipts = local.filter((a) => !a.error && (!a.uploadedId || a.analyzeStage !== undefined)).length;

  const issues: string[] = [];
  if (incompleteItems.length === 1) issues.push(`Item ${incompleteItems[0]!.index + 1} is incomplete`);
  else if (incompleteItems.length > 1) issues.push(`Items ${incompleteItems.map((i) => i.index + 1).join(', ')} are incomplete`);
  if (attachments.length < MIN_ATTACHMENTS) issues.push('Add at least one receipt');
  if (failed) issues.push(`${failed} receipt${failed === 1 ? '' : 's'} failed to upload`);
  if (validateBank(draft.bank).length) issues.push('Pay to details are incomplete');

  return {
    totalCents: draftTotalCents(draft),
    itemCount: draft.items.length,
    receiptCount: attachments.length,
    payee: draft.bank.accountHolder.trim(),
    busyReceipts,
    incompleteItems,
    issues,
    ready: issues.length === 0 && busyReceipts === 0,
  };
}
