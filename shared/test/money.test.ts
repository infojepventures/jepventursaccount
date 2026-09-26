import { describe, expect, it } from 'vitest';
import { formatCents, formatRM, parseAmountToCents, sumCents } from '../src/money';

describe('money', () => {
  it('parses user input into cents', () => {
    expect(parseAmountToCents('150')).toBe(15000);
    expect(parseAmountToCents('150.5')).toBe(15050);
    expect(parseAmountToCents(' 1,234.56 ')).toBe(123456);
    expect(parseAmountToCents('0.1')).toBe(10);
    expect(parseAmountToCents('1.234')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
  });

  it('formats cents', () => {
    expect(formatCents(15000)).toBe('150.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatRM(123456789)).toBe('RM 1,234,567.89');
    expect(formatRM(200)).toBe('RM 2.00');
  });

  it('sums item amounts', () => {
    expect(sumCents([{ amountCents: 1050 }, { amountCents: 4550 }])).toBe(5600);
  });
});
