import { describe, expect, it } from 'vitest';
import type { DocAiDocument, DocAiEntity } from '../../lib/docai';
import { extractSuggestion } from '../../lib/ocrExtract';

function doc(text: string, entities: DocAiEntity[] = []): DocAiDocument {
  return { text, entities };
}

describe('extractSuggestion', () => {
  it('prefers invoice_id, falls back to receipt_id', () => {
    expect(extractSuggestion(doc('', [{ type: 'invoice_id', mentionText: 'INV-100' }]))).toMatchObject({
      reference: 'INV-100',
    });
    expect(extractSuggestion(doc('', [{ type: 'receipt_id', mentionText: 'RCPT-7' }]))).toMatchObject({
      reference: 'RCPT-7',
    });
    expect(
      extractSuggestion(
        doc('', [
          { type: 'invoice_id', mentionText: 'INV-100' },
          { type: 'receipt_id', mentionText: 'RCPT-7' },
        ]),
      ),
    ).toMatchObject({ reference: 'INV-100' });
  });

  it('description from first line_item description, falling back to supplier_name', () => {
    const entities: DocAiEntity[] = [
      {
        type: 'line_item',
        properties: [
          { type: 'line_item/quantity', mentionText: '2' },
          { type: 'line_item/description', mentionText: 'Office chairs' },
        ],
      },
      { type: 'supplier_name', mentionText: 'Inventrac Sdn Bhd' },
    ];
    expect(extractSuggestion(doc('', entities))).toMatchObject({ description: 'Office chairs' });
    expect(extractSuggestion(doc('', [{ type: 'supplier_name', mentionText: 'Inventrac Sdn Bhd' }]))).toMatchObject({
      description: 'Inventrac Sdn Bhd',
    });
  });

  it('amountCents prefers total_amount normalizedValue.moneyValue over net_amount', () => {
    const entities: DocAiEntity[] = [
      { type: 'net_amount', normalizedValue: { moneyValue: { units: '90', nanos: 0 } } },
      { type: 'total_amount', normalizedValue: { moneyValue: { units: '105', nanos: 500000000 } } },
    ];
    expect(extractSuggestion(doc('', entities))).toMatchObject({ amountCents: 10550 });
  });

  it('amountCents falls back to net_amount when total_amount is absent', () => {
    const entities: DocAiEntity[] = [{ type: 'net_amount', normalizedValue: { moneyValue: { units: '42', nanos: 0 } } }];
    expect(extractSuggestion(doc('', entities))).toMatchObject({ amountCents: 4200 });
  });

  it('amountCents parses mentionText like "RM 1,234.50" when no normalizedValue', () => {
    const entities: DocAiEntity[] = [{ type: 'total_amount', mentionText: 'RM 1,234.50' }];
    expect(extractSuggestion(doc('', entities))).toMatchObject({ amountCents: 123450 });
  });

  it('amountCents parses plain "1234.50"', () => {
    const entities: DocAiEntity[] = [{ type: 'total_amount', mentionText: '1234.50' }];
    expect(extractSuggestion(doc('', entities))).toMatchObject({ amountCents: 123450 });
  });

  it('accountHolder from supplier_name, falling back to remit_to_name', () => {
    expect(extractSuggestion(doc('', [{ type: 'supplier_name', mentionText: 'Inventrac Sdn Bhd' }]))).toMatchObject({
      payee: { accountHolder: 'Inventrac Sdn Bhd' },
    });
    expect(extractSuggestion(doc('', [{ type: 'remit_to_name', mentionText: 'ABC Trading' }]))).toMatchObject({
      payee: { accountHolder: 'ABC Trading' },
    });
  });

  it('extracts a realistic CIMB invoice: bank name and account number near a label', () => {
    const text = [
      'INVENTRAC SDN BHD',
      'Tax Invoice',
      '',
      'CIMB BANK',
      'Account No: 8011557404',
      'INVENTRAC SDN BHD',
      '',
      'Total: RM 250.00',
    ].join('\n');
    const result = extractSuggestion(doc(text));
    expect(result.payee).toMatchObject({ bankName: 'CIMB BANK', accountNumber: '8011557404' });
  });

  it('reads an account number on the line after the label', () => {
    const text = ['MAYBANK', 'Account Number:', '5123 4567 8901', 'Please pay by 30/09/2026'].join('\n');
    expect(extractSuggestion(doc(text)).payee).toMatchObject({
      bankName: 'MAYBANK',
      accountNumber: '512345678901',
    });
  });

  it('reads an account number right after the bank name when no label is present', () => {
    const text = ['PUBLIC BANK', '3141592653', 'Kuala Lumpur'].join('\n');
    expect(extractSuggestion(doc(text)).payee).toMatchObject({
      bankName: 'PUBLIC BANK',
      accountNumber: '3141592653',
    });
  });

  it('ignores phone numbers and dates near the account label', () => {
    const text = ['RHB Bank', 'Tel: 012-3456789', 'Date: 25/09/2026', 'Account No: 7001122334', 'Thank you'].join('\n');
    const result = extractSuggestion(doc(text));
    expect(result.payee?.accountNumber).toBe('7001122334');
  });

  it('does not invent an account number when nothing matches', () => {
    const text = 'Just a plain receipt with no bank details.';
    expect(extractSuggestion(doc(text)).payee).toBeUndefined();
  });

  it('recognises multiple banks with normalised display names', () => {
    expect(extractSuggestion(doc('Paid via Hong Leong Bank Berhad')).payee).toMatchObject({
      bankName: 'HONG LEONG BANK',
    });
    expect(extractSuggestion(doc('Bank Simpanan Nasional (BSN)')).payee).toMatchObject({
      bankName: 'BANK SIMPANAN NASIONAL',
    });
    expect(extractSuggestion(doc('Malayan Banking Berhad')).payee).toMatchObject({ bankName: 'MAYBANK' });
  });

  it('trims fields and omits empty ones', () => {
    const entities: DocAiEntity[] = [{ type: 'invoice_id', mentionText: '  INV-9  ' }];
    const result = extractSuggestion(doc('', entities));
    expect(result.reference).toBe('INV-9');
    expect(result.description).toBeUndefined();
    expect(result.amountCents).toBeUndefined();
    expect(result.payee).toBeUndefined();
  });
});
