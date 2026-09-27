import { emptyDraft, type ClaimDraft, type DraftItem } from './draft';
import { effectivePayee, splitByPayee, splitErrors } from './split';
import type { AnyAttachment } from './types';

const me = { bankName: 'Public Bank', accountHolder: 'YU WAI LOONG', accountNumber: '6803149225' };
const ultra = { bankName: 'CIMB BANK', accountHolder: 'ULTRA CLEANING SDN BHD', accountNumber: '8605461067' };

const item = (key: string, amount: string, payee: DraftItem['payee'] = null): DraftItem => ({ key, description: `Item ${key}`, amount, reference: '', payee });
const receipt = (key: string, itemKey?: string): AnyAttachment => ({
  key, kind: 'local', uri: `file:///${key}.jpg`, name: `${key}.jpg`, mimeType: 'image/jpeg', size: 1, ...(itemKey ? { itemKey } : {}),
});
const draft = (items: DraftItem[], bank = me): ClaimDraft => ({ ...emptyDraft(bank), items });

describe('effectivePayee', () => {
  it("uses the item's own payee, else the default", () => {
    const d = draft([item('a', '1'), item('b', '1', ultra)]);
    expect(effectivePayee(d, d.items[0]!)).toEqual(me);
    expect(effectivePayee(d, d.items[1]!)).toEqual(ultra);
  });
});

describe('splitByPayee', () => {
  it('keeps everything in one claim when every item pays the same person', () => {
    const d = draft([item('a', '10'), item('b', '5', { ...me, accountHolder: 'yu wai loong ', accountNumber: '6803-149225' })]);
    const groups = splitByPayee(d, [receipt('r1', 'a'), receipt('r2', 'b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.key)).toEqual(['a', 'b']);
    expect(groups[0]!.attachments.map((r) => r.key)).toEqual(['r1', 'r2']);
    expect(groups[0]!.totalCents).toBe(1500);
  });

  it('splits by payee in first-appearance order, each claim taking its own items and receipts', () => {
    const d = draft([item('a', '439.55'), item('b', '2000', ultra), item('c', '10')]);
    const groups = splitByPayee(d, [receipt('r1', 'a'), receipt('r2', 'b'), receipt('r3', 'c'), receipt('r4', 'b')]);
    expect(groups.map((g) => g.payee.accountHolder)).toEqual(['YU WAI LOONG', 'ULTRA CLEANING SDN BHD']);
    expect(groups.map((g) => g.items.map((i) => i.key))).toEqual([['a', 'c'], ['b']]);
    expect(groups.map((g) => g.attachments.map((r) => r.key))).toEqual([['r1', 'r3'], ['r2', 'r4']]);
    expect(groups.map((g) => g.totalCents)).toEqual([44955, 200000]);
  });

  it("puts receipts that aren't tied to an item (a resubmitted claim's saved files) in the first claim", () => {
    const d = draft([item('a', '1')]);
    expect(splitByPayee(d, [receipt('old'), receipt('r1', 'a')])[0]!.attachments.map((r) => r.key)).toEqual(['old', 'r1']);
  });
});

describe('splitErrors', () => {
  it('has no errors for complete claims', () => {
    const d = draft([item('a', '1'), item('b', '1', ultra)]);
    expect(splitErrors(splitByPayee(d, [receipt('r1', 'a'), receipt('r2', 'b')]), { resubmit: false })).toEqual([]);
  });

  it('keeps the single-claim messages when there is one payee', () => {
    const d = draft([item('a', '1')], { ...me, accountNumber: '' });
    expect(splitErrors(splitByPayee(d, []), { resubmit: false })).toEqual(['Account number is required', 'Attach 1 to 10 receipts']);
  });

  it('names the payee when a split claim is missing a receipt or payment details', () => {
    const d = draft([item('a', '1'), item('b', '1', { ...ultra, bankName: '' })]);
    expect(splitErrors(splitByPayee(d, [receipt('r1', 'a')]), { resubmit: false })).toEqual([
      'Pay to ULTRA CLEANING SDN BHD: Bank name is required',
      'Pay to ULTRA CLEANING SDN BHD: add at least one receipt',
    ]);
  });

  it('refuses to split a resubmitted claim', () => {
    const d = draft([item('a', '1'), item('b', '1', ultra)]);
    expect(splitErrors(splitByPayee(d, [receipt('r1', 'a'), receipt('r2', 'b')]), { resubmit: true })).toEqual([
      'A resubmitted claim can have only one payee. Remove the other payee, or submit it as a new claim.',
    ]);
  });
});
