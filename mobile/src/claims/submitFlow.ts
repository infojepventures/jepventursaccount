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

export interface UploadResult {
  /** Drive file id for every attachment that is uploaded (previously, or just now). */
  uploaded: Map<string, string>;
  /** True if any pending file failed to upload. */
  failed: boolean;
}

/**
 * Uploads any local files in `attachments` that are not uploaded yet (straight to Drive).
 * Per-file progress and results are reported through `onUpdate`, so a caller can show live
 * progress and a retry can skip files that already succeeded. Individual failures do not throw;
 * check `failed` on the result.
 */
export async function uploadPendingAttachments(
  api: Pick<Api, 'uploadSession'>,
  putFile: PutFile,
  claimId: string,
  attachments: AnyAttachment[],
  onUpdate: (key: string, patch: Partial<LocalAttachment>) => void,
): Promise<UploadResult> {
  const uploaded = new Map<string, string>();
  for (const a of attachments) if (a.kind === 'local' && a.uploadedId) uploaded.set(a.key, a.uploadedId);
  const pending = attachments.filter((a): a is LocalAttachment => a.kind === 'local' && !a.uploadedId);

  if (pending.length === 0) return { uploaded, failed: false };

  const session = await api.uploadSession({
    claimId,
    files: pending.map((p) => ({ name: p.name, mimeType: p.mimeType, size: p.size })),
  });
  let failed = false;
  for (const [i, p] of pending.entries()) {
    const target = session.uploads[i];
    if (!target) throw new Error('Upload session is missing a file');
    try {
      onUpdate(p.key, { progress: 0, error: undefined });
      const id = await putFile(target.uploadUrl, p.uri, p.mimeType, (f) => onUpdate(p.key, { progress: f }));
      uploaded.set(p.key, id);
      onUpdate(p.key, { uploadedId: id, progress: 1 });
    } catch (e) {
      failed = true;
      onUpdate(p.key, { error: e instanceof Error ? e.message : 'Upload failed', progress: undefined });
    }
  }
  return { uploaded, failed };
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
  const { uploaded, failed } = await uploadPendingAttachments(deps.api, deps.putFile, input.claimId, input.attachments, onUpdate);
  if (failed) throw new Error('Some files failed to upload. Check your connection and tap Submit to retry.');

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
