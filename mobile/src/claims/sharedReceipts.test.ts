import { MAX_ATTACHMENTS } from '@jep/shared';
import { emptyItem } from './draft';
import { planSharedReceipts } from './sharedReceipts';
import type { LocalAttachment } from './types';

const file = (key: string, itemKey?: string): LocalAttachment => ({
  key, kind: 'local', uri: `file:///${key}`, name: key, mimeType: 'image/jpeg', size: 1, itemKey,
});

describe('planSharedReceipts', () => {
  it('puts the first receipt in the blank item and gives each other one a new item', () => {
    const blank = emptyItem();
    const plan = planSharedReceipts([blank], [], [file('a'), file('b'), file('c')]);
    expect(plan.newItems).toHaveLength(2);
    expect(plan.receipts.map((r) => r.itemKey)).toEqual([blank.key, plan.newItems[0]!.key, plan.newItems[1]!.key]);
    expect(plan.dropped).toBe(0);
  });

  it('leaves items that are filled in or already have a receipt alone', () => {
    const typed = { ...emptyItem(), description: 'Taxi' };
    const withReceipt = emptyItem();
    const plan = planSharedReceipts([typed, withReceipt], [file('old', withReceipt.key)], [file('a')]);
    expect(plan.newItems).toHaveLength(1);
    expect(plan.receipts[0]!.itemKey).toBe(plan.newItems[0]!.key);
  });

  it('drops receipts beyond the claim limit', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => file(`e${i}`, 'x'));
    const plan = planSharedReceipts([emptyItem()], existing, [file('a'), file('b')]);
    expect(plan.receipts.map((r) => r.key)).toEqual(['a']);
    expect(plan.dropped).toBe(1);
  });
});
