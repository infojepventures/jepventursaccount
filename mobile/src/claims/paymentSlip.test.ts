import { applyPaymentSuggestion, uploadPaymentSlip } from './paymentSlip';
import type { LocalAttachment } from './types';

describe('applyPaymentSuggestion', () => {
  it('fills what the slip showed and keeps the rest', () => {
    expect(applyPaymentSuggestion({ paidDate: '2026-09-28', reference: 'typed' }, { paidDate: '2026-09-27' })).toEqual({
      fields: { paidDate: '2026-09-27', reference: 'typed' },
      filled: 1,
    });
    expect(applyPaymentSuggestion({ paidDate: '2026-09-28', reference: '' }, { paidDate: '2026-09-27', reference: '6123' }).filled).toBe(2);
    expect(applyPaymentSuggestion({ paidDate: '2026-09-28', reference: '' }, {})).toEqual({
      fields: { paidDate: '2026-09-28', reference: '' },
      filled: 0,
    });
  });
});

describe('uploadPaymentSlip', () => {
  it('asks for a payment-slip upload session and PUTs the file to it', async () => {
    const file: LocalAttachment = { key: 'k', kind: 'local', uri: 'file:///slip.jpg', name: 'slip.jpg', mimeType: 'image/jpeg', size: 123 };
    const uploadSession = jest.fn().mockResolvedValue({ folderId: 'f', uploads: [{ name: 'payment-slip-slip.jpg', uploadUrl: 'https://up' }] });
    const putFile = jest.fn().mockResolvedValue('drive-1');
    const onProgress = jest.fn();
    await expect(uploadPaymentSlip({ uploadSession }, putFile, 'claim1', file, onProgress)).resolves.toBe('drive-1');
    expect(uploadSession).toHaveBeenCalledWith({
      claimId: 'claim1',
      purpose: 'paymentSlip',
      files: [{ name: 'slip.jpg', mimeType: 'image/jpeg', size: 123 }],
    });
    expect(putFile).toHaveBeenCalledWith('https://up', 'file:///slip.jpg', 'image/jpeg', onProgress);
  });
});
