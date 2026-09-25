import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadPdfAssets } from '../lib/assets';
import { buildClaimPdf } from '../lib/pdf/buildClaimPdf';

const bytes = await buildClaimPdf(
  {
    refNo: 'PR-JEP-202609-draft',
    isDraft: true,
    applicant: { name: '陈大文 Tan Ah Kow', position: 'Operations Executive' },
    date: '2026-09-25',
    items: [
      { description: '停车费 Parking at KLCC', amountCents: 1050 },
      { description: 'Client lunch at Pavilion with a deliberately long description that wraps onto a second line', amountCents: 13950 },
    ],
    totalCents: 15000,
    payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' },
    approval: null,
    generatedAt: '2026-09-25 12:00:00',
  },
  [{ mimeType: 'image/jpeg', data: readFileSync('test/fixtures/receipt.jpg') }],
  await loadPdfAssets(),
);
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/sample.pdf', bytes);
console.log(`Wrote netlify/tmp/sample.pdf (${bytes.length} bytes)`);
