import { describe, expect, it } from 'vitest';
import { draftRefNo, finalRefNo, isDraftRefNo, refNoYear } from '../src/refNo';

describe('refNo', () => {
  it('builds the draft ref from the submission month', () => {
    expect(draftRefNo(new Date('2026-09-25T04:00:00Z'))).toBe('PR-JEP-202609-draft');
  });

  it('builds the final ref from the approval month and global sequence', () => {
    expect(finalRefNo(new Date('2026-10-01T01:00:00Z'), 6)).toBe('PR-JEP-202610-006');
    expect(finalRefNo(new Date('2026-10-01T01:00:00Z'), 1234)).toBe('PR-JEP-202610-1234');
    expect(() => finalRefNo(new Date(), 0)).toThrow();
  });

  it('detects drafts and extracts the year', () => {
    expect(isDraftRefNo('PR-JEP-202609-draft')).toBe(true);
    expect(isDraftRefNo('PR-JEP-202609-005')).toBe(false);
    expect(refNoYear('PR-JEP-202610-006')).toBe('2026');
    expect(refNoYear('PR-JEP-202701-draft')).toBe('2027');
    expect(() => refNoYear('nope')).toThrow();
  });
});
