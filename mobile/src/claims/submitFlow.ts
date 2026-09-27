import type { Api } from '../lib/api';
import { draftToItems, type ClaimDraft } from './draft';
import { payeeKey, splitByPayee } from './split';
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

export interface SubmittedGroup {
  claimId: string;
  /** Draft items that went into this claim. */
  itemKeys: string[];
  /** Receipts (form keys) that went into this claim. */
  attachmentKeys: string[];
  /** Original uploads (in the form's own upload folder) that were re-uploaded into this claim and can be discarded. */
  movedUploadIds: string[];
}

/**
 * Submits the draft as one claim per payee (see splitByPayee). Split-off payees become new claims first — their
 * receipts are uploaded again into the new claim's folder — and the payee with the most receipts already
 * uploaded keeps `input.claimId` and goes last, so if anything fails the original claim is still unsaved and
 * a retry resubmits only what's left. `onGroupSubmitted` fires after each claim is created; returns all ids.
 */
export async function runSplitSubmit(
  deps: { api: Pick<Api, 'uploadSession' | 'submitClaim'>; putFile: PutFile; newClaimId: () => string },
  input: SubmitFlowInput,
  onUpdate: (key: string, patch: Partial<LocalAttachment>) => void,
  onGroupSubmitted: (group: SubmittedGroup) => void = () => {},
): Promise<string[]> {
  const groups = splitByPayee(input.draft, input.attachments);
  const uploadedCount = (atts: AnyAttachment[]) => atts.filter((a) => a.kind === 'remote' || a.uploadedId).length;
  let primary = 0;
  groups.forEach((g, i) => {
    if (uploadedCount(g.attachments) > uploadedCount(groups[primary]!.attachments)) primary = i;
  });
  const defaultKey = payeeKey(input.draft.bank);
  const order = [...groups.keys()].filter((i) => i !== primary).concat(primary);

  const ids: string[] = [];
  for (const i of order) {
    const g = groups[i]!;
    const isPrimary = i === primary;
    const claimId = isPrimary ? input.claimId : deps.newClaimId();
    const draft: ClaimDraft = {
      ...input.draft,
      items: g.items,
      bank: g.payee,
      saveBankToProfile: input.draft.saveBankToProfile && payeeKey(g.payee) === defaultKey,
    };
    // Split-off claims need their own copies in their own upload folder (receipts are bound to a claim's folder).
    const attachments: AnyAttachment[] = isPrimary
      ? g.attachments
      : g.attachments.map((a) =>
          a.kind === 'local' ? { ...a, key: `${a.key}@${claimId}`, uploadedId: undefined, progress: undefined, error: undefined } : a,
        );
    await runSubmitFlow({ api: deps.api, putFile: deps.putFile }, { claimId, draft, attachments, resubmit: input.resubmit }, isPrimary ? onUpdate : () => {});
    ids.push(claimId);
    onGroupSubmitted({
      claimId,
      itemKeys: g.items.map((it) => it.key),
      attachmentKeys: g.attachments.map((a) => a.key),
      movedUploadIds: isPrimary ? [] : g.attachments.flatMap((a) => (a.kind === 'local' && a.uploadedId ? [a.uploadedId] : [])),
    });
  }
  return ids;
}
