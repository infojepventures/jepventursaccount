import { describe, expect, it } from 'vitest';
import { safeEqual } from '../../lib/http';

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('secret123', 'secret123')).toBe(true);
  });
  it('returns false for different strings of the same length', () => {
    expect(safeEqual('secret123', 'secret124')).toBe(false);
  });
  it('returns false for different lengths', () => {
    expect(safeEqual('secret123', 'secret12')).toBe(false);
  });
  it('returns false for empty vs non-empty', () => {
    expect(safeEqual('', 'secret123')).toBe(false);
  });
  it('returns true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
