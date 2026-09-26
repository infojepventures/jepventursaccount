import { buildWhatsAppBatchText, buildWhatsAppClaimText } from './claimShareText';

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

  it('uses the short link when the PDF has one', () => {
    const claim = { ...baseClaim, pdf: { ...baseClaim.pdf, shortUrl: 'https://tinyurl.com/2p8xk3ab' } };
    const text = buildWhatsAppClaimText(claim);
    expect(text).toContain('https://tinyurl.com/2p8xk3ab');
    expect(text).not.toContain('drive.google.com');
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

describe('buildWhatsAppClaimText with a per-item reference', () => {
  it('uses the reference in place of the ref no. when present, and keeps ref no. for items without one', () => {
    const claim = {
      ...baseClaim,
      items: [
        { description: 'Parkinh', amountCents: 1000, reference: 'ICS-000024' },
        { description: 'Food', amountCents: 2000 },
      ],
    };
    expect(buildWhatsAppClaimText(claim)).toBe(
      [
        '> *Supplier: YU WAI LOONG*',
        'PR-JEP-202609-001-YU WAI LOONG-30.00',
        'https://drive.google.com/file/d/ABC/view',
        '',
        '> Parkinh',
        'ICS-000024 - RM 10.00',
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
});

describe('buildWhatsAppBatchText', () => {
  it('returns byte-identical output to buildWhatsAppClaimText for a single claim', () => {
    expect(buildWhatsAppBatchText([baseClaim])).toBe(buildWhatsAppClaimText(baseClaim));
  });

  it('groups claims by normalised payee account (dash-formatted account number, case-differing holder) and keeps a later different account in its own group, in first-appearance order', () => {
    const claim1 = {
      refNo: 'PR-JEP-202609-001',
      totalCents: 3000,
      items: [
        { description: 'Parking', amountCents: 1000 },
        { description: 'Food', amountCents: 2000 },
      ],
      payment: { bankName: 'Public Bank', accountNumber: '8011-557404', accountHolder: 'YU WAI LOONG' },
      pdf: { driveFileId: 'ABC', fileName: 'PR-JEP-202609-001-YU WAI LOONG-30.00.pdf' },
    };
    const claim2 = {
      refNo: 'PR-JEP-202609-003',
      totalCents: 700,
      items: [{ description: 'Stationery', amountCents: 700 }],
      payment: { bankName: 'Maybank', accountNumber: '112233', accountHolder: 'JOHN TAN' },
      pdf: { driveFileId: 'GHI', fileName: 'PR-JEP-202609-003-JOHN TAN-7.00.pdf' },
    };
    const claim3 = {
      refNo: 'PR-JEP-202609-002',
      totalCents: 1500,
      items: [{ description: 'Toll', amountCents: 1500 }],
      payment: { bankName: 'Public Bank', accountNumber: '8011557404', accountHolder: 'yu wai loong' },
      pdf: { driveFileId: 'DEF', fileName: 'PR-JEP-202609-002-YU WAI LOONG-15.00.pdf' },
    };

    expect(buildWhatsAppBatchText([claim1, claim2, claim3])).toBe(
      [
        '> *Supplier: YU WAI LOONG*',
        'PR-JEP-202609-001-YU WAI LOONG-30.00',
        'https://drive.google.com/file/d/ABC/view',
        '',
        '> Parking',
        'PR-JEP-202609-001 - RM 10.00',
        '',
        '> Food',
        'PR-JEP-202609-001 - RM 20.00',
        '',
        '',
        'PR-JEP-202609-002-YU WAI LOONG-15.00',
        'https://drive.google.com/file/d/DEF/view',
        '',
        '> Toll',
        'PR-JEP-202609-002 - RM 15.00',
        '',
        'Total RM 45.00',
        'Public Bank',
        '8011-557404',
        'YU WAI LOONG',
        '',
        '*===============*',
        '',
        '> *Supplier: JOHN TAN*',
        'PR-JEP-202609-003-JOHN TAN-7.00',
        'https://drive.google.com/file/d/GHI/view',
        '',
        '> Stationery',
        'PR-JEP-202609-003 - RM 7.00',
        '',
        'Total RM 7.00',
        'Maybank',
        '112233',
        'JOHN TAN',
        '',
        '*===============*',
      ].join('\n'),
    );
  });
});
