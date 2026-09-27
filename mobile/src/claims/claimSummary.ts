import { MIN_ATTACHMENTS, validateBank } from '@jep/shared';
import { splitByPayee } from './split';
import { draftTotalCents, itemErrors, type ClaimDraft } from './draft';
import type { AnyAttachment } from './types';

export interface ClaimSummary {
  totalCents: number;
  itemCount: number;
  receiptCount: number;
  /** The single payee's account holder ('' until filled), or "N payees" when the draft splits. */
  payee: string;
  /** One entry per claim this draft submits as (more than one when items pay different people). */
  claims: { payee: string; totalCents: number; receiptCount: number }[];
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
  const groups = splitByPayee(draft, attachments);
  const holder = (name: string) => name.trim() || 'another payee';
  if (attachments.length < MIN_ATTACHMENTS) issues.push('Add at least one receipt');
  else if (groups.length > 1) {
    for (const g of groups) if (g.attachments.length < MIN_ATTACHMENTS) issues.push(`Add a receipt for ${holder(g.payee.accountHolder)}`);
  }
  if (failed) issues.push(`${failed} receipt${failed === 1 ? '' : 's'} failed to upload`);
  if (groups.length <= 1) {
    if (validateBank(groups[0]?.payee ?? draft.bank).length) issues.push('Pay to details are incomplete');
  } else {
    for (const g of groups) if (validateBank(g.payee).length) issues.push(`Pay to ${holder(g.payee.accountHolder)}: details are incomplete`);
  }

  return {
    totalCents: draftTotalCents(draft),
    itemCount: draft.items.length,
    receiptCount: attachments.length,
    payee: groups.length > 1 ? `${groups.length} payees` : (groups[0]?.payee ?? draft.bank).accountHolder.trim(),
    claims: groups.map((g) => ({ payee: g.payee.accountHolder.trim(), totalCents: g.totalCents, receiptCount: g.attachments.length })),
    busyReceipts,
    incompleteItems,
    issues,
    ready: issues.length === 0 && busyReceipts === 0,
  };
}
