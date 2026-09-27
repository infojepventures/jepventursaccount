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
    expect(out.items[0]).toMatchObject({ key: 'i1', description: 'Parking', amount: '8.00', reference: 'P-1' });
    expect(aiFields).toEqual(new Set(['item:i1:amount']));
  });

  it('does nothing when the item was removed meanwhile (the payee now belongs to the item)', () => {
    const draft = { ...twoItems(), bank };
    const { draft: out, aiFields } = applySuggestion(
      draft,
      'gone',
      { description: 'Taxi', payee: { accountNumber: '99988877' } },
      { payeeEditedByUser: false },
    );
    expect(out).toEqual(draft);
    expect(aiFields.size).toBe(0);
  });

  it("sets a different supplier as the item's own payee, starting blank so it never mixes with the default bank", () => {
    const draft = emptyDraft(bank);
    const key = draft.items[0]!.key;
    const { draft: out, aiFields } = applySuggestion(
      draft,
      key,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: false },
    );
    expect(out.bank).toEqual(bank); // the default Pay to is untouched
    expect(out.items[0]!.payee).toEqual({ bankName: '', accountHolder: 'Ah Kow', accountNumber: '99988877' });
    expect(aiFields).toEqual(new Set([`item:${key}:payee:accountHolder`, `item:${key}:payee:accountNumber`]));
  });

  it('fills in the missing details when the receipt names the same payee', () => {
    const draft = emptyDraft(bank);
    const key = draft.items[0]!.key;
    const { draft: out } = applySuggestion(draft, key, { payee: { accountHolder: 'tan', accountNumber: '777' } }, { payeeEditedByUser: false });
    expect(out.items[0]!.payee).toEqual({ bankName: 'Maybank', accountHolder: 'tan', accountNumber: '777' });
  });

  it("does not touch the item's payee once the user has edited it", () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(
      draft,
      draft.items[0]!.key,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: true },
    );
    expect(out.items[0]!.payee ?? null).toBeNull();
    expect(aiFields.size).toBe(0);
  });

  it('does not set a payee when the suggestion has neither accountHolder nor accountNumber', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(draft, draft.items[0]!.key, { payee: { bankName: 'CIMB' } }, { payeeEditedByUser: false });
    expect(out).toEqual(draft);
    expect(aiFields.size).toBe(0);
  });

  it('is a no-op when the suggestion is empty', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(draft, draft.items[0]!.key, {}, { payeeEditedByUser: false });
    expect(out).toEqual(draft);
    expect(aiFields.size).toBe(0);
  });
});
