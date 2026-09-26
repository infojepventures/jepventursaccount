import { itemErrors } from './draft';
import { orderByItem, receiptsForItem, unlinkedReceipts } from './itemReceipts';
import type { AnyAttachment } from './types';

const local = (key: string, itemKey?: string): AnyAttachment => ({
  key, kind: 'local', uri: `file:///${key}.jpg`, name: `${key}.jpg`, mimeType: 'image/jpeg', size: 1, ...(itemKey ? { itemKey } : {}),
});
const remote = (key: string): AnyAttachment => ({ key, kind: 'remote', driveFileId: `d-${key}`, name: `${key}.pdf`, mimeType: 'application/pdf', size: 1 });

const items = [{ key: 'i1' }, { key: 'i2' }];

describe('item receipts', () => {
  const list = [local('a', 'i2'), remote('old'), local('b', 'i1'), local('c', 'i2'), local('orphan', 'deleted-item')];

  it("picks one item's receipts in the order they were added", () => {
    expect(receiptsForItem(list, 'i2').map((a) => a.key)).toEqual(['a', 'c']);
    expect(receiptsForItem(list, 'i1').map((a) => a.key)).toEqual(['b']);
  });

  it('treats receipts without a (still existing) item as unlinked, e.g. a resubmitted claim\'s saved files', () => {
    expect(unlinkedReceipts(list, items).map((a) => a.key)).toEqual(['old', 'orphan']);
  });

  it("orders receipts for submission: a resubmitted claim's saved ones first, then item by item", () => {
    expect(orderByItem(list, items).map((a) => a.key)).toEqual(['old', 'orphan', 'b', 'a', 'c']);
  });
});

describe('itemErrors', () => {
  it('flags a missing description and a bad or non-positive amount', () => {
    expect(itemErrors({ key: 'x', description: ' ', amount: '12.50', reference: '' })).toEqual(['description is required']);
    expect(itemErrors({ key: 'x', description: 'Taxi', amount: 'abc', reference: '' })).toEqual(['enter an amount like 12.50']);
    expect(itemErrors({ key: 'x', description: 'Taxi', amount: '0', reference: '' })).toEqual(['amount must be greater than 0']);
    expect(itemErrors({ key: 'x', description: 'Taxi', amount: '12.50', reference: '' })).toEqual([]);
  });
});
