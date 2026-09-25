import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { loadPdfAssets } from '../../lib/assets';
import { buildClaimPdf, type ClaimPdfInput } from '../../lib/pdf/buildClaimPdf';
import { extractText } from '../pdfText';

const input: ClaimPdfInput = {
  refNo: 'PR-JEP-202609-draft',
  isDraft: true,
  applicant: { name: '陈大文 Tan Ah Kow', position: 'Operations Executive' },
  date: '2026-09-25',
  items: [
    { description: '停车费 Parking at KLCC', amountCents: 1050 },
    { description: 'Lunch with client', amountCents: 13950 },
  ],
  totalCents: 15000,
  payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' },
  approval: null,
  generatedAt: '2026-09-25 12:00:00',
};

async function twoPagePdf() {
  const d = await PDFDocument.create();
  d.addPage();
  d.addPage();
  return d.save();
}

describe('buildClaimPdf', () => {
  it('puts the form first, then one page per image and every PDF page', async () => {
    const bytes = await buildClaimPdf(
      input,
      [
        { mimeType: 'image/jpeg', data: readFileSync('test/fixtures/receipt.jpg') },
        { mimeType: 'image/png', data: readFileSync('test/fixtures/receipt.png') },
        { mimeType: 'application/pdf', data: await twoPagePdf() },
      ],
      await loadPdfAssets(),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
    expect(bytes.length).toBeLessThan(500_000);
    const text = await extractText(bytes, 1);
    expect(text).toContain('PAYMENT REQUEST');
    expect(text).toContain('REF: PR-JEP-202609-draft');
    expect(text).toContain('DRAFT');
    expect(text).toContain('陈大文');
    expect(text).toContain('停车费');
    expect(text).toContain('RM 150.00');
    expect(text).toContain('JEP VENTURES SDN BHD (1521088-K)');
  });

  it('shows the approval block and no draft marker on the final version', async () => {
    const bytes = await buildClaimPdf(
      { ...input, refNo: 'PR-JEP-202610-006', isDraft: false, approval: { byName: 'Boss', date: '2026-10-01' } },
      [],
      await loadPdfAssets(),
    );
    const text = await extractText(bytes, 1);
    expect(text).toContain('REF: PR-JEP-202610-006');
    expect(text).not.toContain('DRAFT');
    expect(text).toContain('Approved by');
    expect(text).toContain('Boss');
  });

  it('continues long item lists on extra form pages', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      description: `Item ${i + 1} ` + 'long description '.repeat(6),
      amountCents: 100,
    }));
    const bytes = await buildClaimPdf({ ...input, items, totalCents: 5000 }, [], await loadPdfAssets());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
