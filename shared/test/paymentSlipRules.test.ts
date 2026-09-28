import { describe, expect, it } from 'vitest';
import { extractPaymentSlipFromText } from '../src/paymentSlipRules';

describe('extractPaymentSlipFromText', () => {
  it('reads a Maybank2u slip and ignores the recipient reference', () => {
    const text = [
      'Maybank2u',
      'Successful',
      'Recipient reference PR-JEP-202609-0001',
      'Reference number 6123456789',
      'Transaction date 28 Sep 2026 10:22:31',
      'Amount RM 30.00',
    ].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-09-28', reference: '6123456789' });
  });

  it('reads a PBe slip with day-first numeric dates', () => {
    const text = ['Transaction Reference No. : 0012345678', 'Date & Time : 05/10/2026 09:01:44', 'Amount : RM 150.00'].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-10-05', reference: '0012345678' });
  });

  it('takes the value from the next line when the label stands alone', () => {
    const text = ['Reference No.', 'CIMB88112233', 'Transaction Date', '1 Oct 2026', 'Recipient Reference', 'claim 5'].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-10-01', reference: 'CIMB88112233' });
  });

  it('reads DuitNow references and month-first dates', () => {
    const text = ['DuitNow Ref No: 20260928MBBEMYKL010ORB12345678', 'Sep 28, 2026 3:05 PM'].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-09-28', reference: '20260928MBBEMYKL010ORB12345678' });
  });

  it('understands Malay labels and months', () => {
    const text = ['No. Rujukan: 99887766', 'Tarikh: 3 Ogos 2026'].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-08-03', reference: '99887766' });
  });

  it('prefers the labelled date over other dates on the slip', () => {
    const text = ['Printed 2026-09-30', 'Payment Date: 2026-09-29', 'Transaction ID: TX-55123'].join('\n');
    expect(extractPaymentSlipFromText(text)).toEqual({ paidDate: '2026-09-29', reference: 'TX-55123' });
  });

  it('skips impossible dates and references without digits', () => {
    expect(extractPaymentSlipFromText('Date 31/02/2026\nReference number: PENDING')).toEqual({});
  });

  it('returns nothing for empty text', () => {
    expect(extractPaymentSlipFromText('')).toEqual({});
  });
});
