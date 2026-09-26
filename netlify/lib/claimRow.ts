import { claimPdfLink, formatCents, formatYmdHms, type ClaimDoc, type TimestampLike } from '@jep/shared';
import type { SheetRow } from './sheets';

export const SHEET_HEADERS = [
  'Claim ID',
  'Ref No',
  'Status',
  'Submitted At',
  'Applicant',
  'Position',
  'Items',
  'Total (RM)',
  'Bank',
  'Account Holder',
  'Account Number',
  'Reviewed By',
  'Reviewed At',
  'Reject Reason',
  'Paid Date',
  'Payment Ref',
  'PDF Link',
  'Attachments Folder Link',
  'Updated At',
];

const ts = (t: TimestampLike | null | undefined) => (t ? formatYmdHms(t.toDate()) : '');

export function toSheetRow(claimId: string, c: ClaimDoc): SheetRow {
  return [
    claimId,
    c.refNo,
    c.status,
    ts(c.submittedAt),
    c.applicant.name,
    c.applicant.position,
    c.items
      .map((it, i) => `${i + 1}. ${it.reference ? `${it.reference} ` : ''}${it.description} RM${formatCents(it.amountCents)}`)
      .join('; '),
    c.totalCents / 100,
    c.payment.bankName,
    c.payment.accountHolder,
    c.payment.accountNumber,
    c.review?.byName ?? '',
    ts(c.review?.at),
    c.review?.reason ?? '',
    c.paidInfo?.paidDate ?? '',
    c.paidInfo?.reference ?? '',
    c.pdf.status === 'ready' ? (claimPdfLink(c.pdf) ?? '') : '',
    `https://drive.google.com/drive/folders/${c.attachmentsFolderId}`,
    ts(c.updatedAt),
  ];
}
