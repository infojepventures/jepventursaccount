import type { Deps } from '../deps';

const ATTACHMENTS = '_attachments';

export async function attachmentsFolderFor(deps: Deps, year: string, claimId: string): Promise<string> {
  const yearId = await deps.drive.findOrCreateFolder(deps.rootFolderId, year);
  const attId = await deps.drive.findOrCreateFolder(yearId, ATTACHMENTS);
  return deps.drive.findOrCreateFolder(attId, claimId);
}
