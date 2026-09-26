import { buildWhatsAppClaimText } from './claimShareText';

const baseClaim = {
  refNo: 'PR-JEP-202609-001',
  totalCents: 3000,
  items: [
    { description: 'Parkinh', amountCents: 1000 },
    { description: 'Food', amountCents: 2000 },
  ],
  payment: { bankName: 'Public Bank', accountNumber: '6803149225', accountHolder: 'YU WAI LOONG' },
  pdf: { driveFileId: 'ABC', fileName: 'PR-JEP-202609-001-YU WAI LOONG-30.00.pdf' },
};

describe('buildWhatsAppClaimText', () => {
  it('matches the exact WhatsApp-formatted example', () => {
    expect(buildWhatsAppClaimText(baseClaim)).toBe(
      [
        '> *Supplier: YU WAI LOONG*',
        'PR-JEP-202609-001-YU WAI LOONG-30.00',
        'https://drive.google.com/file/d/ABC/view',
        '',
        '> Parkinh',
        'PR-JEP-202609-001 - RM 10.00',
        '',
        '> Food',
        'PR-JEP-202609-001 - RM 20.00',
        '',
        'Total RM 30.00',
        'Public Bank',
        '6803149225',
        'YU WAI LOONG',
        '',
        '*===============*',
      ].join('\n'),
    );
  });

  it('omits the Drive URL line entirely when the PDF has no driveFileId yet', () => {
    const claim = { ...baseClaim, pdf: { driveFileId: null, fileName: null } };
    expect(buildWhatsAppClaimText(claim)).toBe(
      [
        '> *Supplier: YU WAI LOONG*',
        '',
        '> Parkinh',
        'PR-JEP-202609-001 - RM 10.00',
        '',
        '> Food',
        'PR-JEP-202609-001 - RM 20.00',
        '',
        'Total RM 30.00',
        'Public Bank',
        '6803149225',
        'YU WAI LOONG',
        '',
        '*===============*',
      ].join('\n'),
    );
  });

  it('trims values and collapses embedded newlines in descriptions', () => {
    const claim = {
      refNo: '  PR-JEP-202609-002  ',
      totalCents: 500,
      items: [{ description: 'Taxi\nride  home', amountCents: 500 }],
      payment: { bankName: ' Maybank ', accountNumber: ' 123 ', accountHolder: '  JOHN TAN  ' },
      pdf: { driveFileId: 'XYZ', fileName: 'PR-JEP-202609-002-JOHN TAN-5.00.pdf' },
    };
    expect(buildWhatsAppClaimText(claim)).toBe(
      [
        '> *Supplier: JOHN TAN*',
        'PR-JEP-202609-002-JOHN TAN-5.00',
        'https://drive.google.com/file/d/XYZ/view',
        '',
        '> Taxi ride home',
        'PR-JEP-202609-002 - RM 5.00',
        '',
        'Total RM 5.00',
        'Maybank',
        '123',
        'JOHN TAN',
        '',
        '*===============*',
      ].join('\n'),
    );
  });
});
