import { describe, expect, it } from 'vitest';
import { displayRefNo, refBaseFor, refBaseOf, refNoFor, refNoYear } from '../src/refNo';

describe('refNo', () => {
  it('builds the base from the submission month (Malaysia time) and a 4-digit global sequence', () => {
    expect(refBaseFor(new Date('2026-09-25T04:00:00Z'), 5)).toBe('PR-JEP-202609-0005');
    // 30 Sep 23:30 in Kuala Lumpur is still September there.
    expect(refBaseFor(new Date('2026-09-30T15:30:00Z'), 12)).toBe('PR-JEP-202609-0012');
    expect(refBaseFor(new Date('2026-10-01T01:00:00Z'), 12345)).toBe('PR-JEP-202610-12345');
    expect(() => refBaseFor(new Date(), 0)).toThrow();
    expect(() => refBaseFor(new Date(), 1.5)).toThrow();
  });

  it('adds a suffix for each status', () => {
    const base = 'PR-JEP-202609-0005';
    expect(refNoFor(base, 'submitted')).toBe('PR-JEP-202609-0005-Draft');
    expect(refNoFor(base, 'approved')).toBe('PR-JEP-202609-0005-Approved');
    expect(refNoFor(base, 'rejected')).toBe('PR-JEP-202609-0005-Rejected');
    expect(refNoFor(base, 'paid')).toBe('PR-JEP-202609-0005-Paid');
    expect(refNoFor(base, 'cancelled')).toBe('PR-JEP-202609-0005-Cancelled');
  });

  it('reads the base back from a ref no. of the current format only', () => {
    expect(refBaseOf('PR-JEP-202609-0005-Paid')).toBe('PR-JEP-202609-0005');
    expect(refBaseOf('PR-JEP-202609-draft')).toBeNull();
    expect(refBaseOf('PR-JEP-202609-001')).toBeNull();
  });

  it('extracts the year', () => {
    expect(refNoYear('PR-JEP-202610-0006-Approved')).toBe('2026');
    expect(refNoYear('PR-JEP-202701-draft')).toBe('2027');
    expect(() => refNoYear('nope')).toThrow();
  });

  it('shows the number without the status suffix in the app and on the PDF', () => {
    expect(displayRefNo({ refNo: 'PR-JEP-202609-0005-Approved', refBase: 'PR-JEP-202609-0005' })).toBe('PR-JEP-202609-0005');
    expect(displayRefNo({ refNo: 'PR-JEP-202609-0005-Paid' })).toBe('PR-JEP-202609-0005');
    expect(displayRefNo({ refNo: 'PR-JEP-202609-draft' })).toBe('PR-JEP-202609-draft'); // older formats as they are
    expect(displayRefNo({ refNo: 'PR-JEP-202609-001' })).toBe('PR-JEP-202609-001');
  });
});
