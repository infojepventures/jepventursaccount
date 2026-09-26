import { isValidClaimId } from '@jep/shared';
import type { Actor } from '../actor';
import { canReadClaim } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { getClaim } from '../firestore';

export const MAX_PROXY_BYTES = 19 * 1024 * 1024;

export async function openClaimFile(
  deps: Deps,
  actor: Actor,
  claimId: string | null,
  fileId: string | null,
): Promise<Response> {
  if (!isValidClaimId(claimId) || !fileId) throw fail.invalid('claimId and fileId are required');
  const claim = await getClaim(deps.db, claimId);
  if (!claim) throw fail.notFound('Claim not found');
  if (!canReadClaim(claim, actor)) throw fail.forbidden();
  const belongs = claim.attachments.some((a) => a.driveFileId === fileId) || claim.pdf.driveFileId === fileId;
  if (!belongs) throw fail.notFound('File not found');
  const meta = await deps.drive.getFile(fileId);
  if (!meta || meta.trashed) throw fail.notFound('File not found');
  if (meta.size > MAX_PROXY_BYTES) {
    throw fail.tooLarge('This file is too large to open in the app. Please open it in Google Drive.');
  }
  const upstream = await deps.drive.downloadResponse(fileId);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': meta.mimeType,
      'Content-Length': String(meta.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
