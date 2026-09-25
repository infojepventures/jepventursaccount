import { describe, expect, it } from 'vitest';
import { claimPdfFileName, sanitizeFileNamePart } from '../src/fileName';

describe('fileName', () => {
  it('builds the PDF file name', () => {
    expect(claimPdfFileName('PR-JEP-202609-005', 'Tan Ah Kow', 15000)).toBe(
      'PR-JEP-202609-005-Tan Ah Kow-150.00.pdf',
    );
    expect(claimPdfFileName('PR-JEP-202609-draft', 'Tan Ah Kow', 15000)).toBe(
      'PR-JEP-202609-draft-Tan Ah Kow-150.00.pdf',
    );
  });

  it('removes illegal characters and collapses whitespace', () => {
    expect(sanitizeFileNamePart('A/B: "C"  D')).toBe('AB C D');
    expect(claimPdfFileName('PR-JEP-202609-005', ' / ', 100)).toBe('PR-JEP-202609-005-Unknown-1.00.pdf');
  });
});
