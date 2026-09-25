import { emptyDraft } from './draft';
import { runSubmitFlow } from './submitFlow';
import type { AnyAttachment, LocalAttachment } from './types';

const bank = { bankName: 'Maybank', accountHolder: 'Tan', accountNumber: '1234' };
const draft = { ...emptyDraft(bank), items: [{ key: 'i', description: 'Parking', amount: '10.50' }] };
const local = (key: string, extra: Partial<LocalAttachment> = {}): LocalAttachment => ({
  key, kind: 'local', uri: `file:///${key}.jpg`, name: `${key}.jpg`, mimeType: 'image/jpeg', size: 100, ...extra,
});

function makeDeps(failOnce: string[] = []) {
  const failing = new Set(failOnce);
  const api = {
    uploadSession: jest.fn(async (req: { files: { name: string }[] }) => ({
      folderId: 'F',
      uploads: req.files.map((f) => ({ name: f.name, uploadUrl: `https://up/${f.name}` })),
    })),
    submitClaim: jest.fn(async () => ({ claimId: 'C1' })),
  };
  const putFile = jest.fn(async (url: string, _uri: string, _m: string, onProgress: (f: number) => void) => {
    const name = url.split('/').pop()!;
    if (failing.delete(name)) throw new Error('boom');
    onProgress(0.5);
    return `id-${name}`;
  });
  return { api, putFile };
}

describe('runSubmitFlow', () => {
  it('uploads local files, keeps remote ones in order, then submits', async () => {
    const deps = makeDeps();
    const attachments: AnyAttachment[] = [
      { key: 'r', kind: 'remote', driveFileId: 'old1', name: 'old.pdf', mimeType: 'application/pdf', size: 5 },
      local('a'),
    ];
    const updates: [string, Partial<LocalAttachment>][] = [];
    await runSubmitFlow(deps as never, { claimId: 'C1', draft, attachments, resubmit: true }, (k, p) => updates.push([k, p]));

    expect(deps.api.uploadSession).toHaveBeenCalledWith({ claimId: 'C1', files: [{ name: 'a.jpg', mimeType: 'image/jpeg', size: 100 }] });
    expect(deps.api.submitClaim).toHaveBeenCalledWith({
      claimId: 'C1',
      items: [{ description: 'Parking', amountCents: 1050 }],
      payment: bank,
      attachmentIds: ['old1', 'id-a.jpg'],
      resubmit: true,
      saveBankToProfile: false,
    });
    expect(updates).toContainEqual(['a', { uploadedId: 'id-a.jpg', progress: 1 }]);
  });

  it('stops before submitting when an upload fails, and skips already-uploaded files on retry', async () => {
    const deps = makeDeps(['b.jpg']);
    const updates = new Map<string, Partial<LocalAttachment>>();
    const onUpdate = (k: string, p: Partial<LocalAttachment>) => updates.set(k, { ...updates.get(k), ...p });
    const attachments = [local('a'), local('b')];

    await expect(runSubmitFlow(deps as never, { claimId: 'C1', draft, attachments, resubmit: false }, onUpdate)).rejects.toThrow(
      /failed to upload/,
    );
    expect(deps.api.submitClaim).not.toHaveBeenCalled();
    expect(updates.get('b')?.error).toBe('boom');

    const retry = attachments.map((a) => ({ ...a, ...updates.get(a.key) }));
    await runSubmitFlow(deps as never, { claimId: 'C1', draft, attachments: retry, resubmit: false }, onUpdate);
    expect(deps.api.uploadSession).toHaveBeenLastCalledWith({ claimId: 'C1', files: [{ name: 'b.jpg', mimeType: 'image/jpeg', size: 100 }] });
    expect(deps.api.submitClaim).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['id-a.jpg', 'id-b.jpg'] }));
  });

  it('skips the upload session when nothing new needs uploading', async () => {
    const deps = makeDeps();
    await runSubmitFlow(deps as never, { claimId: 'C1', draft, attachments: [local('a', { uploadedId: 'done' })], resubmit: false }, () => {});
    expect(deps.api.uploadSession).not.toHaveBeenCalled();
    expect(deps.api.submitClaim).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['done'] }));
  });
});
