import { claimSummary } from './claimSummary';
import { emptyDraft, type ClaimDraft } from './draft';
import type { AnyAttachment } from './types';

const bank = { bankName: 'CIMB BANK', accountHolder: 'ULTRA CLEANING SDN BHD', accountNumber: '8605461067' };
const draft = (items: ClaimDraft['items'], b = bank): ClaimDraft => ({ ...emptyDraft(b), items });
const done = (key: string, itemKey: string): AnyAttachment => ({
  key, kind: 'local', uri: 'file:///x', name: 'x.jpg', mimeType: 'image/jpeg', size: 1, uploadedId: `f-${key}`, progress: 1, analyzed: true, itemKey,
});

describe('claimSummary', () => {
  it('is ready when every item, the receipts and Pay to are complete', () => {
    const d = draft([
      { key: 'i1', reference: '', description: 'Spa', amount: '439.55' },
      { key: 'i2', reference: '', description: 'Cleaning', amount: '2000' },
    ]);
    expect(claimSummary(d, [done('a', 'i1'), done('b', 'i2')])).toEqual({
      totalCents: 243955,
      itemCount: 2,
      receiptCount: 2,
      payee: 'ULTRA CLEANING SDN BHD',
      busyReceipts: 0,
      incompleteItems: [],
      issues: [],
      ready: true,
    });
  });

  it('lists incomplete items (with their index and key), missing receipts and unfinished Pay to', () => {
    const d = draft(
      [
        { key: 'i1', reference: '', description: 'Spa', amount: '439.55' },
        { key: 'i2', reference: '', description: '', amount: '' },
      ],
      { bankName: 'CIMB BANK', accountHolder: '', accountNumber: '' },
    );
    const s = claimSummary(d, []);
    expect(s.incompleteItems).toEqual([{ index: 1, key: 'i2' }]);
    expect(s.issues).toEqual(['Item 2 is incomplete', 'Add at least one receipt', 'Pay to details are incomplete']);
    expect(s.ready).toBe(false);
    expect(s.payee).toBe('');
  });

  it('is not ready while receipts are still uploading or being read', () => {
    const d = draft([{ key: 'i1', reference: '', description: 'Spa', amount: '439.55' }]);
    const reading: AnyAttachment = { ...(done('a', 'i1') as object), analyzed: false, analyzeStage: 'reading' } as AnyAttachment;
    const uploading: AnyAttachment = { key: 'b', kind: 'local', uri: 'file:///y', name: 'y.jpg', mimeType: 'image/jpeg', size: 1, progress: 0.3, itemKey: 'i1' };
    const s = claimSummary(d, [reading, uploading]);
    expect(s.busyReceipts).toBe(2);
    expect(s.issues).toEqual([]);
    expect(s.ready).toBe(false);
  });

  it('counts failed uploads as an issue', () => {
    const d = draft([{ key: 'i1', reference: '', description: 'Spa', amount: '439.55' }]);
    const failed: AnyAttachment = { key: 'b', kind: 'local', uri: 'file:///y', name: 'y.jpg', mimeType: 'image/jpeg', size: 1, error: 'Network', itemKey: 'i1' };
    expect(claimSummary(d, [done('a', 'i1'), failed]).issues).toEqual(['1 receipt failed to upload']);
  });

  it('groups several incomplete items into one line', () => {
    const d = draft([
      { key: 'i1', reference: '', description: '', amount: '' },
      { key: 'i2', reference: '', description: 'X', amount: '1' },
      { key: 'i3', reference: '', description: '', amount: '5' },
    ]);
    expect(claimSummary(d, [done('a', 'i2')]).issues).toEqual(['Items 1, 3 are incomplete']);
  });
});
