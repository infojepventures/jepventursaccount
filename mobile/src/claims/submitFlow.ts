import type { Api } from '../lib/api';
import { draftToItems, type ClaimDraft } from './draft';
import type { AnyAttachment, LocalAttachment } from './types';

export type PutFile = (url: string, uri: string, mimeType: string, onProgress: (fraction: number) => void) => Promise<string>;

export interface SubmitFlowInput {
  claimId: string;
  draft: ClaimDraft;
  attachments: AnyAttachment[];
  resubmit: boolean;
}

/**
 * Uploads any local files that are not uploaded yet (straight to Drive), then submits the claim.
 * Upload progress and per-file results are reported through `onUpdate`, so a retry can skip files
 * that already succeeded.
 */
export async function runSubmitFlow(
  deps: { api: Pick<Api, 'uploadSession' | 'submitClaim'>; putFile: PutFile },
  input: SubmitFlowInput,
  onUpdate: (key: string, patch: Partial<LocalAttachment>) => void,
): Promise<void> {
  const uploaded = new Map<string, string>();
  for (const a of input.attachments) if (a.kind === 'local' && a.uploadedId) uploaded.set(a.key, a.uploadedId);
  const pending = input.attachments.filter((a): a is LocalAttachment => a.kind === 'local' && !a.uploadedId);

  if (pending.length > 0) {
    const session = await deps.api.uploadSession({
      claimId: input.claimId,
      files: pending.map((p) => ({ name: p.name, mimeType: p.mimeType, size: p.size })),
    });
    let failed = false;
    for (const [i, p] of pending.entries()) {
      const target = session.uploads[i];
      if (!target) throw new Error('Upload session is missing a file');
      try {
        onUpdate(p.key, { progress: 0, error: undefined });
        const id = await deps.putFile(target.uploadUrl, p.uri, p.mimeType, (f) => onUpdate(p.key, { progress: f }));
        uploaded.set(p.key, id);
        onUpdate(p.key, { uploadedId: id, progress: 1 });
      } catch (e) {
        failed = true;
        onUpdate(p.key, { error: e instanceof Error ? e.message : 'Upload failed', progress: undefined });
      }
    }
    if (failed) throw new Error('Some files failed to upload. Check your connection and tap Submit to retry.');
  }

  const attachmentIds = input.attachments.map((a) => (a.kind === 'remote' ? a.driveFileId : uploaded.get(a.key)!));
  await deps.api.submitClaim({
    claimId: input.claimId,
    items: draftToItems(input.draft),
    payment: {
      bankName: input.draft.bank.bankName.trim(),
      accountHolder: input.draft.bank.accountHolder.trim(),
      accountNumber: input.draft.bank.accountNumber.trim(),
    },
    attachmentIds,
    resubmit: input.resubmit,
    saveBankToProfile: input.draft.saveBankToProfile,
  });
}
