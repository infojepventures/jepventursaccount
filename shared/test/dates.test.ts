import { describe, expect, it } from 'vitest';
import { formatYmd, formatYmdHms, formatYyyyMm, isValidYmd } from '../src/dates';

describe('dates (Malaysia time, UTC+8)', () => {
  it('uses the MYT month boundary', () => {
    expect(formatYyyyMm(new Date('2026-09-30T15:59:59Z'))).toBe('202609');
    expect(formatYyyyMm(new Date('2026-09-30T16:00:00Z'))).toBe('202610');
  });

  it('formats date and date-time in MYT', () => {
    const d = new Date('2026-09-25T15:05:43Z');
    expect(formatYmd(d)).toBe('2026-09-25');
    expect(formatYmdHms(d)).toBe('2026-09-25 23:05:43');
  });

  it('validates yyyy-MM-dd strings', () => {
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('26-2-1')).toBe(false);
  });
});
