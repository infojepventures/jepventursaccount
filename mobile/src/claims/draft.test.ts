import type { ClaimDoc } from '@jep/shared';
import { draftErrors, draftFromClaim, draftToItems, draftTotalCents, emptyDraft, remoteAttachments } from './draft';

const bank = { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678' };

describe('claim draft', () => {
  it('starts with one empty item and the profile bank', () => {
    const d = emptyDraft(bank);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ description: '', amount: '' });
    expect(d.bank).toEqual(bank);
    expect(emptyDraft(null).bank).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
  });

  it('totals only valid amounts', () => {
    const d = { ...emptyDraft(bank), items: [
      { key: 'a', description: 'Parking', amount: '10.50' },
      { key: 'b', description: 'Lunch', amount: 'abc' },
      { key: 'c', description: 'Taxi', amount: '1,000' },
    ] };
    expect(draftTotalCents(d)).toBe(101050);
  });

  it('reports per-item, bank and attachment errors', () => {
    const d = { ...emptyDraft({ ...bank, accountNumber: '' }), items: [{ key: 'a', description: '', amount: '1.234' }] };
    expect(draftErrors(d, 0)).toEqual([
      'Item 1: description is required',
      'Item 1: enter an amount like 12.50',
      'Account number is required',
      'Attach 1 to 10 receipts',
    ]);
    const ok = { ...emptyDraft(bank), items: [{ key: 'a', description: 'Parking', amount: '10' }] };
    expect(draftErrors(ok, 1)).toEqual([]);
    expect(draftToItems(ok)).toEqual([{ description: 'Parking', amountCents: 1000 }]);
  });

  it('rebuilds a draft and attachments from a claim for resubmission', () => {
    const claim = {
      items: [{ description: 'Parking', amountCents: 1050 }],
      payment: bank,
      attachments: [{ driveFileId: 'f1', name: 'r.jpg', mimeType: 'image/jpeg', size: 10 }],
    } as unknown as ClaimDoc;
    const d = draftFromClaim(claim);
    expect(d.items.map((i) => [i.description, i.amount])).toEqual([['Parking', '10.50']]);
    expect(d.saveBankToProfile).toBe(false);
    expect(remoteAttachments(claim)).toEqual([
      expect.objectContaining({ kind: 'remote', driveFileId: 'f1', name: 'r.jpg', mimeType: 'image/jpeg', size: 10 }),
    ]);
  });
});
