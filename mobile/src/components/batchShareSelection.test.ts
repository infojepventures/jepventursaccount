import type { ClaimRow } from '../data/useClaims';
import { computeSelectedClaims, isShareable, pruneSelectedIds } from './batchShareSelection';

/** Builds a minimal ClaimRow for these pure-function tests; only `id` and `pdf.status` matter here. */
function row(id: string, pdfStatus: 'ready' | 'generating' | 'failed'): ClaimRow {
  return { id, pdf: { status: pdfStatus } } as unknown as ClaimRow;
}

describe('isShareable', () => {
  it('is true only when the PDF is ready', () => {
    expect(isShareable(row('a', 'ready'))).toBe(true);
    expect(isShareable(row('b', 'generating'))).toBe(false);
    expect(isShareable(row('c', 'failed'))).toBe(false);
  });
});

describe('pruneSelectedIds', () => {
  it('returns the same reference when nothing needs pruning', () => {
    const rows = [row('a', 'ready'), row('b', 'ready')];
    const prev = new Set(['a', 'b']);
    expect(pruneSelectedIds(prev, rows)).toBe(prev);
  });

  it('returns the same reference for an empty selection without inspecting rows', () => {
    const prev = new Set<string>();
    expect(pruneSelectedIds(prev, [])).toBe(prev);
  });

  it('drops ids for rows that left the list entirely', () => {
    const rows = [row('a', 'ready')];
    const next = pruneSelectedIds(new Set(['a', 'b']), rows);
    expect(next).toEqual(new Set(['a']));
  });

  it('drops ids whose PDF flipped away from ready', () => {
    const rows = [row('a', 'ready'), row('b', 'generating')];
    const next = pruneSelectedIds(new Set(['a', 'b']), rows);
    expect(next).toEqual(new Set(['a']));
  });
});

describe('computeSelectedClaims', () => {
  it('keeps only selected, shareable rows, in row order', () => {
    const rows = [row('a', 'ready'), row('b', 'generating'), row('c', 'ready')];
    const result = computeSelectedClaims(rows, new Set(['c', 'a', 'b']));
    expect(result.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array when nothing is selected', () => {
    const rows = [row('a', 'ready')];
    expect(computeSelectedClaims(rows, new Set())).toEqual([]);
  });
});
