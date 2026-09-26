import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim } from '../../lib/firestore';
import { generatePdf } from '../../lib/services/generatePdf';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { jpgFile, makeTestDeps, pdfBytes, resetEmulators, seedActor, seedCounter, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  await seedCounter(t.deps);
  const alice = await seedActor(t.deps, 'alice');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, boss };
}

describe('generatePdf', () => {
  it('builds the draft PDF in the year folder and marks it ready', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice, {
      files: [jpgFile(), { name: 'inv.pdf', mimeType: 'application/pdf', data: await pdfBytes(2) }],
    });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('done');

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('ready');
    expect(c.pdf.fileName).toBe('PR-JEP-202609-draft-Tan Ah Kow-150.00.pdf');
    const file = t.drive.files.get(c.pdf.driveFileId!)!;
    expect(file.name).toBe(c.pdf.fileName);
    expect(t.drive.folderPath(file.parents[0]!)).toBe('JEP Claims/2026');
    expect((await PDFDocument.load(file.data)).getPageCount()).toBe(4);
    expect(String(t.sheets.rows.get(claimId)?.[16])).toContain(c.pdf.driveFileId!);
    expect(t.drive.files.get(c.attachmentsFolderId)!.name).toBe('PR-JEP-202609-draft-Tan Ah Kow-150.00');
  });

  it('replaces the draft with the numbered final PDF after approval', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await generatePdf(t.deps, claimId, t.triggered[0]!.requestId);
    const draftId = (await getClaim(t.deps.db, claimId))!.pdf.driveFileId!;

    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[1]!.requestId)).toBe('done');

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.fileName).toBe('PR-JEP-202609-001-Tan Ah Kow-150.00.pdf');
    expect(t.drive.files.get(draftId)!.trashed).toBe(true);
    expect(t.drive.livePdfs().map((f) => f.name)).toEqual(['PR-JEP-202609-001-Tan Ah Kow-150.00.pdf']);
    expect(t.drive.files.get(c.attachmentsFolderId)!.name).toBe('PR-JEP-202609-001-Tan Ah Kow-150.00');
  });

  it('still returns done when the attachments folder rename fails', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    t.drive.rename = async () => {
      throw new Error('rename unavailable');
    };
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('done');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('ready');
  });

  it('skips stale requests before doing any work', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('superseded');
    expect(t.drive.livePdfs()).toHaveLength(0);
  });

  it('trashes its upload when superseded mid-flight', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    const original = t.drive.upload.bind(t.drive);
    let uploadedId = '';
    t.drive.upload = async (p) => {
      const r = await original(p);
      uploadedId = r.id;
      await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
      return r;
    };
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('superseded');
    expect(t.drive.files.get(uploadedId)!.trashed).toBe(true);
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('generating');
    expect(c.pdf.requestId).toBe(t.triggered[1]!.requestId);
  });

  it('marks the PDF failed when an attachment is corrupt', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice, {
      files: [{ name: 'bad.pdf', mimeType: 'application/pdf', data: new TextEncoder().encode('not a pdf') }],
    });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('failed');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('failed');
    expect(c.pdf.error).toBeTruthy();
    expect(t.drive.livePdfs()).toHaveLength(0);
  });
});
