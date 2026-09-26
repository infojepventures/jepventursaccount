import { applySuggestion } from './applySuggestion';
import { emptyDraft } from './draft';

const bank = { bankName: 'Maybank', accountHolder: 'Tan', accountNumber: '1234' };

describe('applySuggestion', () => {
  it('replaces the only item when it is completely empty', () => {
    const draft = emptyDraft(null);
    const { draft: out, aiFields } = applySuggestion(
      draft,
      { reference: 'INV-1', description: 'Taxi', amountCents: 1050 },
      { payeeEditedByUser: false },
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ reference: 'INV-1', description: 'Taxi', amount: '10.50' });
    const key = out.items[0]!.key;
    expect(aiFields).toEqual(new Set([`item:${key}:reference`, `item:${key}:description`, `item:${key}:amount`]));
  });

  it('appends a new item when the existing items already have data', () => {
    const draft = { ...emptyDraft(null), items: [{ key: 'i1', description: 'Parking', amount: '5.00', reference: '' }] };
    const { draft: out } = applySuggestion(draft, { description: 'Taxi', amountCents: 1050 }, { payeeEditedByUser: false });
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual(draft.items[0]);
    expect(out.items[1]).toMatchObject({ description: 'Taxi', amount: '10.50', reference: '' });
  });

  it('overwrites payee fields the suggestion provides, keeping others, when not user-edited', () => {
    const draft = { ...emptyDraft(bank) };
    const { draft: out, aiFields } = applySuggestion(
      draft,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: false },
    );
    expect(out.bank).toEqual({ bankName: 'Maybank', accountHolder: 'Ah Kow', accountNumber: '99988877' });
    expect(aiFields).toEqual(new Set(['bank:accountHolder', 'bank:accountNumber']));
  });

  it('does not touch payee fields once the user has edited Pay to', () => {
    const draft = { ...emptyDraft(bank) };
    const { draft: out, aiFields } = applySuggestion(
      draft,
      { payee: { accountHolder: 'Ah Kow', accountNumber: '99988877' } },
      { payeeEditedByUser: true },
    );
    expect(out.bank).toEqual(bank);
    expect(aiFields.size).toBe(0);
  });

  it('does not overwrite payee when the suggestion has neither accountHolder nor accountNumber', () => {
    const draft = { ...emptyDraft(bank) };
    const { draft: out, aiFields } = applySuggestion(draft, { payee: { bankName: 'CIMB' } }, { payeeEditedByUser: false });
    expect(out.bank).toEqual(bank);
    expect(aiFields.size).toBe(0);
  });

  it('handles a partial suggestion with only a reference', () => {
    const draft = emptyDraft(null);
    const { draft: out, aiFields } = applySuggestion(draft, { reference: 'INV-9' }, { payeeEditedByUser: false });
    expect(out.items[0]).toMatchObject({ reference: 'INV-9', description: '', amount: '' });
    const key = out.items[0]!.key;
    expect(aiFields).toEqual(new Set([`item:${key}:reference`]));
  });

  it('is a no-op when the suggestion is empty', () => {
    const draft = emptyDraft(bank);
    const { draft: out, aiFields } = applySuggestion(draft, {}, { payeeEditedByUser: false });
    expect(out).toEqual(draft);
    expect(aiFields.size).toBe(0);
  });
});
