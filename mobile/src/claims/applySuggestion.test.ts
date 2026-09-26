import { applySuggestion } from './applySuggestion';
import { emptyDraft, type ClaimDraft } from './draft';

const bank = { bankName: 'Maybank', accountHolder: 'Tan', accountNumber: '1234' };
const twoItems = (): ClaimDraft => ({
  ...emptyDraft(null),
  items: [
    { key: 'i1', description: 'Parking', amount: '5.00', reference: 'P-1' },
    { key: 'i2', description: '', amount: '', reference: '' },
  ],
});

describe('applySuggestion', () => {
  it("fills the receipt's own item (its tab), leaving other items alone", () => {
    const draft = twoItems();
    const { draft: out, aiFields } = applySuggestion(
      draft,
      'i2',
      { reference: 'INV-1', description: 'Taxi', amountCents: 1050 },
      { payeeEditedByUser: false },
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual(draft.items[0]);
    expect(out.items[1]).toEqual({ key: 'i2', reference: 'INV-1', description: 'Taxi', amount: '10.50' });
    expect(aiFields).toEqual(new Set(['item:i2:reference', 'item:i2:description', 'item:i2:amount']));
  });

  it("overwrites the item's existing values with the newest receipt's, but only the fields it read", () => {
    const { draft: out, aiFields } = applySuggestion(twoItems(), 'i1', { amountCents: 800 }, { payeeEditedByUser: false });
    expect(out.items[0]).toEqual({ key: 'i1', description: 'Parking', amount: '8.00', reference: 'P-1' });
    expect(aiFields).toEqual(new Set(['item:i1:amount']));
  });

  it('skips the item part when the item was removed meanwhile, but still applies the payee', () => {
    const draft = { ...twoItems(), bank };
    const { draft: out, aiFields } = applySuggestion(
      draft,
      'gone',
      { description: 'Taxi', payee: { accountNumber: '99988877' } },
      { payeeEditedByUser: false },
    );
    expect(out.items).toEqual(draft.items);
    expect(out.bank.accountNumber).toBe('99988877');
    expect(aiFields).toEqual(new Set(['bank:accountNumber']));
  });

  it('overwrites payee fields the suggestion provides, keeping others, when not user-edited', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(
      draft,
      draft.items[0]!.key,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: false },
    );
    expect(out.bank).toEqual({ bankName: 'Maybank', accountHolder: 'Ah Kow', accountNumber: '99988877' });
    expect(aiFields).toEqual(new Set(['bank:accountHolder', 'bank:accountNumber']));
  });

  it('does not touch payee fields once the user has edited Pay to', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(
      draft,
      draft.items[0]!.key,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: true },
    );
    expect(out.bank).toEqual(bank);
    expect(aiFields.size).toBe(0);
  });

  it('does not overwrite payee when the suggestion has neither accountHolder nor accountNumber', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(draft, draft.items[0]!.key, { payee: { bankName: 'CIMB' } }, { payeeEditedByUser: false });
    expect(out.bank).toEqual(bank);
    expect(aiFields.size).toBe(0);
  });

  it('is a no-op when the suggestion is empty', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(draft, draft.items[0]!.key, {}, { payeeEditedByUser: false });
    expect(out).toEqual(draft);
    expect(aiFields.size).toBe(0);
  });
});
