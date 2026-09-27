import { describe, expect, it } from 'vitest';
import { claimPdfFileName, claimPdfLink, driveFileUrl, sanitizeFileNamePart } from '../src/fileName';

describe('fileName', () => {
  it('builds the PDF file name with the status at the end', () => {
    expect(claimPdfFileName('PR-JEP-202609-0005', 'Tan Ah Kow', 15000, 'submitted')).toBe('PR-JEP-202609-0005-Tan Ah Kow-150.00-Pending.pdf');
    expect(claimPdfFileName('PR-JEP-202609-0005', 'Tan Ah Kow', 15000, 'approved')).toBe('PR-JEP-202609-0005-Tan Ah Kow-150.00-Pending.pdf');
    expect(claimPdfFileName('PR-JEP-202609-0005', 'Tan Ah Kow', 15000, 'rejected')).toBe('PR-JEP-202609-0005-Tan Ah Kow-150.00-Rejected.pdf');
    expect(claimPdfFileName('PR-JEP-202609-0005', 'Tan Ah Kow', 15000, 'paid')).toBe('PR-JEP-202609-0005-Tan Ah Kow-150.00-Paid.pdf');
    expect(claimPdfFileName('PR-JEP-202609-0005', 'Tan Ah Kow', 15000, 'cancelled')).toBe('PR-JEP-202609-0005-Tan Ah Kow-150.00-Cancelled.pdf');
  });

  it('removes illegal characters and collapses whitespace', () => {
    expect(sanitizeFileNamePart('A/B: "C"  D')).toBe('AB C D');
    expect(claimPdfFileName('PR-JEP-202609-0005', ' / ', 100, 'paid')).toBe('PR-JEP-202609-0005-Unknown-1.00-Paid.pdf');
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
