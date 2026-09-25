import { describe, expect, it } from 'vitest';
import {
  isValidClaimId,
  validateAttachmentMeta,
  validateBank,
  validateItems,
} from '../src/validation';
import { isProfileComplete } from '../src/profile';

const bank = { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' };

describe('validateItems', () => {
  it('requires at least one item', () => {
    expect(validateItems([])).toEqual(['At least one item is required']);
    expect(validateItems(undefined)).toEqual(['At least one item is required']);
  });
  it('accepts valid items', () => {
    expect(validateItems([{ description: 'Parking', amountCents: 1000 }])).toEqual([]);
  });
  it('reports each invalid field', () => {
    expect(validateItems([{ description: ' ', amountCents: 0 }])).toEqual([
      'Item 1: description is required',
      'Item 1: amount must be greater than 0',
    ]);
    expect(validateItems([{ description: 'x', amountCents: 10.5 }])).toEqual([
      'Item 1: amount must be greater than 0',
    ]);
  });
});

describe('validateBank', () => {
  it('accepts valid details', () => {
    expect(validateBank(bank)).toEqual([]);
  });
  it('reports missing and malformed fields', () => {
    expect(validateBank({ bankName: '', accountHolder: 'x', accountNumber: '12ab' })).toEqual([
      'Bank name is required',
      'Account number must be 4-30 digits',
    ]);
    expect(validateBank(null)).toEqual(['Bank details are required']);
  });
});

describe('validateAttachmentMeta', () => {
  const ok = { name: 'r.jpg', mimeType: 'image/jpeg', size: 1000 };
  it('enforces count limits', () => {
    expect(validateAttachmentMeta([])).toEqual(['Attach 1 to 10 files']);
    expect(validateAttachmentMeta(Array(11).fill(ok))).toEqual(['Attach 1 to 10 files']);
    expect(validateAttachmentMeta([ok])).toEqual([]);
  });
  it('enforces type and size', () => {
    expect(validateAttachmentMeta([{ name: 'a.gif', mimeType: 'image/gif', size: 10 }])).toEqual([
      'a.gif: only JPG, PNG or PDF files are allowed',
    ]);
    expect(
      validateAttachmentMeta([{ name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }]),
    ).toEqual(['big.pdf: file is larger than 10MB']);
  });
});

describe('isValidClaimId', () => {
  it('accepts 20-char Firestore auto IDs only', () => {
    expect(isValidClaimId('abcdefghij0123456789')).toBe(true);
    expect(isValidClaimId('short')).toBe(false);
    expect(isValidClaimId('abcdefghij012345678/')).toBe(false);
    expect(isValidClaimId(42)).toBe(false);
  });
});

describe('isProfileComplete', () => {
  it('needs name, position and valid bank details', () => {
    expect(isProfileComplete({ name: 'Tan', position: 'Exec', bank })).toBe(true);
    expect(isProfileComplete({ name: 'Tan', position: '', bank })).toBe(false);
    expect(isProfileComplete({ name: 'Tan', position: 'Exec', bank: null })).toBe(false);
  });
});
