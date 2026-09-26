import { describe, expect, it } from 'vitest';
import { claimPdfFileName, claimPdfLink, driveFileUrl, sanitizeFileNamePart } from '../src/fileName';

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

describe('claimPdfLink', () => {
  it('prefers the short link, falls back to the Drive link, and is null without a PDF', () => {
    expect(claimPdfLink({ driveFileId: 'F1', shortUrl: 'https://tinyurl.com/abc123' })).toBe('https://tinyurl.com/abc123');
    expect(claimPdfLink({ driveFileId: 'F1', shortUrl: null })).toBe('https://drive.google.com/file/d/F1/view');
    expect(claimPdfLink({ driveFileId: 'F1' })).toBe(driveFileUrl('F1'));
    expect(claimPdfLink({ driveFileId: null, shortUrl: 'https://tinyurl.com/abc123' })).toBeNull();
  });
});
