import type { ClaimRow } from '../data/useClaims';

/** Only a claim with a ready PDF has a doc name + Drive link, so only those can be batch-shared. */
export const isShareable = (c: ClaimRow) => c.pdf.status === 'ready';

/** WhatsApp truncates very long messages; keep batches well under that so nothing silently drops. */
export const MAX_SHARE_TEXT_LENGTH = 60_000;

/**
 * `rows` comes from a live query: a selected claim can change status (leave the list) or its PDF
 * can flip away from 'ready' out from under the selection. Prunes `prev` down to ids that are both
 * still present in `rows` and still shareable, returning `prev` unchanged (same reference) when
 * nothing needs to be dropped so callers can skip a re-render.
 */
export function pruneSelectedIds(prev: Set<string>, rows: ClaimRow[]): Set<string> {
  if (prev.size === 0) return prev;
  const shareableIds = new Set(rows.filter(isShareable).map((c) => c.id));
  let changed = false;
  const next = new Set<string>();
  prev.forEach((id) => {
    if (shareableIds.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : prev;
}

/** The subset of `rows` that are both selected and still shareable, in `rows` order. */
export function computeSelectedClaims(rows: ClaimRow[], selectedIds: Set<string>): ClaimRow[] {
  return rows.filter((c) => selectedIds.has(c.id) && isShareable(c));
}
