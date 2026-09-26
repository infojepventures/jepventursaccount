import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../lib/pdfText';

async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 460;
  for (const line of lines) {
    if (line) page.drawText(line, { x: 40, y, size: 12, font });
    y -= 20;
  }
  return doc.save();
}

describe('extractPdfText', () => {
  it('reconstructs one line per row, keeping a label and its value together', async () => {
    const bytes = await makePdf(['Invoice No: ICS-000024', 'Total RM 450.00', 'CIMB BANK', 'Account No: 8011557404']);
    const text = await extractPdfText(bytes);
    const lines = text.split('\n');
    expect(lines).toContain('Invoice No: ICS-000024');
    expect(lines).toContain('Total RM 450.00');
    expect(lines).toContain('Account No: 8011557404');
  });

  it('preserves top-to-bottom order', async () => {
    const bytes = await makePdf(['First line', 'Second line', 'Third line']);
    const text = await extractPdfText(bytes);
    expect(text.split('\n')).toEqual(['First line', 'Second line', 'Third line']);
  });

  it('skips blank rows', async () => {
    const bytes = await makePdf(['Alpha', '', 'Beta']);
    const text = await extractPdfText(bytes);
    expect(text.split('\n')).toEqual(['Alpha', 'Beta']);
  });
});
