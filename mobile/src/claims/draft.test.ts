import type { ClaimDoc } from '@jep/shared';
import { draftErrors, draftFromClaim, draftToItems, draftTotalCents, emptyDraft, remoteAttachments } from './draft';

const bank = { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678' };

describe('claim draft', () => {
  it('starts with one empty item and the profile bank', () => {
    const d = emptyDraft(bank);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ description: '', amount: '', reference: '' });
    expect(d.bank).toEqual(bank);
    expect(emptyDraft(null).bank).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
  });

  it('totals only valid amounts', () => {
    const d = { ...emptyDraft(bank), items: [
      { key: 'a', description: 'Parking', amount: '10.50', reference: '' },
      { key: 'b', description: 'Lunch', amount: 'abc', reference: '' },
      { key: 'c', description: 'Taxi', amount: '1,000', reference: '' },
    ] };
    expect(draftTotalCents(d)).toBe(101050);
  });

  it('reports per-item, bank and attachment errors', () => {
    const d = { ...emptyDraft({ ...bank, accountNumber: '' }), items: [{ key: 'a', description: '', amount: '1.234', reference: '' }] };
    expect(draftErrors(d, 0)).toEqual([
      'Item 1: description is required',
      'Item 1: enter an amount like 12.50',
      'Account number is required',
      'Attach 1 to 10 receipts',
    ]);
    const ok = { ...emptyDraft(bank), items: [{ key: 'a', description: 'Parking', amount: '10', reference: '' }] };
    expect(draftErrors(ok, 1)).toEqual([]);
    expect(draftToItems(ok)).toEqual([{ description: 'Parking', amountCents: 1000 }]);
  });

  it('includes a trimmed reference when provided, omitting it otherwise', () => {
    const d = { ...emptyDraft(bank), items: [
      { key: 'a', description: 'Parking', amount: '10', reference: '  ICS-000024  ' },
      { key: 'b', description: 'Lunch', amount: '5', reference: '' },
    ] };
    expect(draftToItems(d)).toEqual([
      { description: 'Parking', amountCents: 1000, reference: 'ICS-000024' },
      { description: 'Lunch', amountCents: 500 },
    ]);
  });

  it('rebuilds a draft and attachments from a claim for resubmission', () => {
    const claim = {
      items: [{ description: 'Parking', amountCents: 1050, reference: 'ICS-000024' }],
      payment: bank,
      attachments: [{ driveFileId: 'f1', name: 'r.jpg', mimeType: 'image/jpeg', size: 10 }],
    } as unknown as ClaimDoc;
    const d = draftFromClaim(claim);
    expect(d.items.map((i) => [i.description, i.amount, i.reference])).toEqual([['Parking', '10.50', 'ICS-000024']]);
    expect(d.saveBankToProfile).toBe(false);
    expect(remoteAttachments(claim)).toEqual([
      expect.objectContaining({ kind: 'remote', driveFileId: 'f1', name: 'r.jpg', mimeType: 'image/jpeg', size: 10 }),
    ]);
  });
});
