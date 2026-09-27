import { describe, expect, it } from 'vitest';
import { claimRefNo, isNumberedRefNo, refNoYear } from '../src/refNo';

describe('refNo', () => {
  it('numbers a claim by its submission month (Malaysia time) and a 4-digit global sequence', () => {
    expect(claimRefNo(new Date('2026-09-25T04:00:00Z'), 5)).toBe('PR-JEP-202609-0005');
    // 30 Sep 23:30 in Kuala Lumpur is still September there.
    expect(claimRefNo(new Date('2026-09-30T15:30:00Z'), 12)).toBe('PR-JEP-202609-0012');
    expect(claimRefNo(new Date('2026-10-01T01:00:00Z'), 12345)).toBe('PR-JEP-202610-12345');
    expect(() => claimRefNo(new Date(), 0)).toThrow();
    expect(() => claimRefNo(new Date(), 1.5)).toThrow();
  });

  it('tells numbered refs from older formats', () => {
    expect(isNumberedRefNo('PR-JEP-202609-0005')).toBe(true);
    expect(isNumberedRefNo('PR-JEP-202609-draft')).toBe(false);
    expect(isNumberedRefNo('PR-JEP-202609-001')).toBe(false);
  });

  it('extracts the year', () => {
    expect(refNoYear('PR-JEP-202610-0006')).toBe('2026');
    expect(refNoYear('PR-JEP-202701-draft')).toBe('2027');
    expect(() => refNoYear('nope')).toThrow();
  });
});
