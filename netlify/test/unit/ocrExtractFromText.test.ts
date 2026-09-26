import { describe, expect, it } from 'vitest';
import { extractSuggestionFromText } from '../../lib/ocrExtract';

describe('extractSuggestionFromText (free, Document-AI-less path)', () => {
  it('parses a parking receipt: reference token fallback, no bank/account, a total amount', () => {
    const text = [
      'SUNWAY PARKING MANAGEMENT SDN BHD',
      'PARKING RECEIPT',
      'Ticket No: PKG-000871',
      'Entry: 25/09/2026 09:12',
      'Exit: 25/09/2026 11:45',
      'Duration: 2H33M',
      'Parking Fee            5.00',
      'Total RM 5.00',
      'Thank you, drive safe',
    ].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.amountCents).toBe(500);
    expect(result.description).toBe('Parking Fee');
    // No bank/account on a parking receipt; the all-caps company line still supplies a holder guess.
    expect(result.payee).toEqual({ accountHolder: 'SUNWAY PARKING MANAGEMENT SDN BHD' });
  });

  it('parses a restaurant receipt with SST/service charge, picking the grand total not the subtotal', () => {
    const text = [
      'KOPITIAM DELIGHT ENTERPRISE',
      'Receipt No: RCPT-004521',
      '',
      'Nasi Lemak Ayam        2      20.00',
      'Teh Tarik              2       6.00',
      'Subtotal                      26.00',
      'Service Charge 10%             2.60',
      'SST 6%                         1.72',
      'Grand Total RM 30.32',
      'Cash                           50.00',
      'Change                         19.68',
    ].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.reference).toBe('RCPT-004521');
    expect(result.amountCents).toBe(3032);
    expect(result.description).toBe('Nasi Lemak Ayam');
  });

  it('parses a supplier invoice with bank details for payment, reading the label-based account holder', () => {
    const text = [
      'TAX INVOICE',
      'Invoice No: INV-000317',
      'Bill To: JEP Ventures Sdn Bhd',
      '',
      'Office Chairs          4     400.00',
      'Delivery Fee           1      50.00',
      'Subtotal                     450.00',
      'Total Payable RM 450.00',
      '',
      'Payee: Ergo Furnishing Trading',
      'CIMB BANK',
      'Account No: 8011557404',
    ].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.reference).toBe('INV-000317');
    expect(result.amountCents).toBe(45000);
    expect(result.description).toBe('Office Chairs');
    expect(result.payee).toMatchObject({
      accountHolder: 'Ergo Furnishing Trading',
      bankName: 'CIMB BANK',
      accountNumber: '8011557404',
    });
  });

  it('falls back to a bare reference token and an all-caps company-name line when no labels match', () => {
    const text = [
      'ABC HARDWARE ENTERPRISE',
      'INV-000042',
      'Screws & Bolts          15.90',
      'Amount Due RM 15.90',
    ].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.reference).toBe('INV-000042');
    expect(result.amountCents).toBe(1590);
    expect(result.payee?.accountHolder).toBe('ABC HARDWARE ENTERPRISE');
  });

  it('handles a Chinese/English mixed receipt', () => {
    const text = [
      '美食阁 FOOD COURT SDN BHD',
      '收据编号 Receipt No: RC-88213',
      '',
      '炒粿条 Char Kway Teow       8.00',
      'Total RM 8.00',
      '多谢惠顾 Thank you',
    ].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.reference).toBe('RC-88213');
    expect(result.amountCents).toBe(800);
    expect(result.description).toContain('Char Kway Teow');
  });

  it('picks the largest/last total-labelled amount when several total-like lines are present', () => {
    const text = ['Subtotal 100.00', 'Total 100.00', 'Grand Total RM 106.00'].join('\n');
    expect(extractSuggestionFromText(text).amountCents).toBe(10600);
  });

  it('reads Nett Total as an amount label', () => {
    const text = ['Nett Total: RM 88.20'].join('\n');
    expect(extractSuggestionFromText(text).amountCents).toBe(8820);
  });

  it('omits description when no line looks confidently like a line item', () => {
    const text = ['Some Company Bhd', 'Invoice No: INV-1', 'Total RM 20.00'].join('\n');
    const result = extractSuggestionFromText(text);
    expect(result.description).toBeUndefined();
  });

  it('reads Account Name / A/C Name / Beneficiary / Pay To labels for the account holder', () => {
    expect(extractSuggestionFromText('Account Name: John Tan').payee).toMatchObject({ accountHolder: 'John Tan' });
    expect(extractSuggestionFromText('A/C Name: Jane Lim').payee).toMatchObject({ accountHolder: 'Jane Lim' });
    expect(extractSuggestionFromText('Beneficiary: XYZ Sdn Bhd').payee).toMatchObject({ accountHolder: 'XYZ Sdn Bhd' });
    expect(extractSuggestionFromText('Pay To: ABC Trading').payee).toMatchObject({ accountHolder: 'ABC Trading' });
  });

  it('returns an empty suggestion for text with nothing recognisable', () => {
    expect(extractSuggestionFromText('random unrelated text with no structure')).toEqual({});
  });

  it('returns an empty suggestion for empty text', () => {
    expect(extractSuggestionFromText('')).toEqual({});
  });

  it('reads a REF: label, ignores digit-less "invoice not valid" disclaimers, and strips the company reg. no. from the payee', () => {
    const text = [
      'ULTRA CLEANING SDN BHD. (1040447-X)',
      'NO. 91-1 JALAN PUTERI 5/7, BANDAR PUTERI, 47100 PUCHONG,SELANGOR',
      'PROFORMA INVOICE',
      'REF: DPM-PI2501009',
      'DATE: 03/01/2025',
      'ITEM CODE TAX CODE DESCRIPTION QTY PRICE (RM)',
      'PSS PSS - RESIDENTIAL 1 2,000.00',
      'Total (Inclusive of SST) 2,000.00',
      'This invoice not valid without signature',
      'CIMB BANK',
      'Account No: 8605461067',
    ].join('\n');
    const s = extractSuggestionFromText(text);
    expect(s.reference).toBe('DPM-PI2501009');
    expect(s.amountCents).toBe(200000);
    expect(s.payee?.accountHolder).toBe('ULTRA CLEANING SDN BHD');
    expect(s.payee?.bankName).toBe('CIMB BANK');
    expect(s.payee?.accountNumber).toBe('8605461067');
  });

  it('never returns a reference without a digit', () => {
    expect(extractSuggestionFromText('Invoice Date: today\nReceipt No: pending').reference).toBeUndefined();
  });

  it('parses a spa receipt: bare "No ." label, trailing unit-price/discount columns stripped from the description', () => {
    const text = [
      'Natural Healing Spa',
      '(W10-2310-32100031)',
      'L3-08, 152, Jalan Changkat Thambi Dollah',
      'BILL TO',
      'Name: Andy Ngooi(golf) No .0000018900',
      'Mobile: 60128627688 Sales Date 27/03/2026 22:23',
      'Description Unit Unit Qty Amount',
      'Price Discount',
      'Promo 60min Body + 15min Ear Candling 98.00 0.00 4 392.00',
      'Aroma oil 15.00 0.00 1 15.00',
      'Sub Total 407.00',
      'Sales Include Tax 439.56',
      'Rounding -0.01',
      'Grand Total 439.55',
      'Credit card 439.55',
    ].join('\n');
    const s = extractSuggestionFromText(text);
    expect(s.reference).toBe('0000018900');
    expect(s.description).toBe('Promo 60min Body + 15min Ear Candling');
    expect(s.amountCents).toBe(43955);
    expect(s.payee?.accountNumber).toBeUndefined();
  });

  it('does not treat phone or account "No" labels as a document number', () => {
    expect(extractSuggestionFromText('Tel No: 0321234567').reference).toBeUndefined();
    expect(extractSuggestionFromText('Mobile No. 60128627688').reference).toBeUndefined();
    expect(extractSuggestionFromText('Account No: 8605461067').reference).toBeUndefined();
    expect(extractSuggestionFromText('Room No 12').reference).toBeUndefined();
  });
});
