import { describe, expect, it } from 'vitest';
import type { ClaimDoc, TimestampLike } from '@jep/shared';
import { SHEET_HEADERS, toSheetRow } from '../../lib/claimRow';

const ts = (iso: string): TimestampLike => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });

const claim: ClaimDoc = {
  refNo: 'PR-JEP-202609-005',
  status: 'paid',
  applicant: { uid: 'u1', name: 'Tan Ah Kow', position: 'Executive' },
  items: [
    { description: 'Parking', amountCents: 1000 },
    { description: 'Lunch', amountCents: 4550 },
  ],
  totalCents: 5550,
  payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '0123 4567' },
  attachments: [],
  attachmentsFolderId: 'FOLDER1',
  pdf: { status: 'ready', requestId: 'r', driveFileId: 'PDF1', fileName: 'x.pdf', error: null },
  review: { byUid: 'a1', byName: 'Boss', at: ts('2026-09-26T02:00:00Z'), reason: null },
  paidInfo: { byUid: 'a1', byName: 'Boss', at: ts('2026-09-27T02:00:00Z'), paidDate: '2026-09-27', reference: 'IBG123' },
  history: [],
  submittedAt: ts('2026-09-25T04:00:00Z'),
  resubmittedAt: null,
  sheetSynced: true,
  createdAt: ts('2026-09-25T04:00:00Z'),
  updatedAt: ts('2026-09-27T02:00:00Z'),
};

describe('toSheetRow', () => {
  it('maps every header column', () => {
    const row = toSheetRow('CID', claim);
    expect(row).toHaveLength(SHEET_HEADERS.length);
    expect(row).toEqual([
      'CID',
      'PR-JEP-202609-005',
      'paid',
      '2026-09-25 12:00:00',
      'Tan Ah Kow',
      'Executive',
      '1. Parking RM10.00; 2. Lunch RM45.50',
      55.5,
      'Maybank',
      'Tan Ah Kow',
      '0123 4567',
      'Boss',
      '2026-09-26 10:00:00',
      '',
      '2026-09-27',
      'IBG123',
      'https://drive.google.com/file/d/PDF1/view',
      'https://drive.google.com/drive/folders/FOLDER1',
      '2026-09-27 10:00:00',
    ]);
  });

  it('omits the PDF link until the PDF is ready', () => {
    const row = toSheetRow('CID', { ...claim, pdf: { ...claim.pdf, status: 'generating' } });
    expect(row[16]).toBe('');
  });
});
