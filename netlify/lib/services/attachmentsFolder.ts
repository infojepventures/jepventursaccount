import { FOLDER_MIME } from '../drive';
import type { Deps } from '../deps';

const ATTACHMENTS = '_attachments';

export async function attachmentsFolderFor(deps: Deps, year: string, claimId: string): Promise<string> {
  const yearId = await deps.drive.findOrCreateFolder(deps.rootFolderId, year);
  const attId = await deps.drive.findOrCreateFolder(yearId, ATTACHMENTS);
  return deps.drive.findOrCreateFolder(attId, claimId);
}

export async function findAttachmentsFolder(deps: Deps, claimId: string, years: string[]): Promise<string | null> {
  for (const year of years) {
    const yearId = await deps.drive.findChild(deps.rootFolderId, year, FOLDER_MIME);
    if (!yearId) continue;
    const attId = await deps.drive.findChild(yearId, ATTACHMENTS, FOLDER_MIME);
    if (!attId) continue;
    const folder = await deps.drive.findChild(attId, claimId, FOLDER_MIME);
    if (folder) return folder;
  }
  return null;
}
