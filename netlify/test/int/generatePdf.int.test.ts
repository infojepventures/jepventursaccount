import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim } from '../../lib/firestore';
import { markPaid } from '../../lib/services/claimActions';
import { generatePdf } from '../../lib/services/generatePdf';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { extractText } from '../pdfText';
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
    expect(c.pdf.fileName).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending.pdf');
    const file = t.drive.files.get(c.pdf.driveFileId!)!;
    expect(file.name).toBe(c.pdf.fileName);
    expect(t.drive.folderPath(file.parents[0]!)).toBe('JEP Claims/2026');
    expect((await PDFDocument.load(file.data)).getPageCount()).toBe(4);
    // The PDF link is shortened once, and the Sheet shows the short link.
    expect(t.shortener.calls).toEqual([`https://drive.google.com/file/d/${c.pdf.driveFileId}/view`]);
    expect(c.pdf.shortUrl).toBe('https://tinyurl.com/t1');
    expect(t.sheets.rows.get(claimId)?.[16]).toBe('https://tinyurl.com/t1');
    expect(t.drive.files.get(c.attachmentsFolderId)!.name).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending');
  });

  it('overwrites the same Drive file on later versions, so its links never change', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await generatePdf(t.deps, claimId, t.triggered[0]!.requestId);
    const first = (await getClaim(t.deps.db, claimId))!.pdf;

    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[1]!.requestId)).toBe('done');

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.fileName).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending.pdf');
    expect(c.pdf.driveFileId).toBe(first.driveFileId);
    expect(c.pdf.shortUrl).toBe(first.shortUrl);
    expect(t.drive.overwrites).toBe(1);
    expect(t.drive.files.get(first.driveFileId!)!.trashed).toBe(false);
    expect(t.drive.livePdfs().map((f) => f.name)).toEqual(['PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending.pdf']);
    expect(t.drive.files.get(c.attachmentsFolderId)!.name).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending');
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

  it('still marks the PDF ready, with the full Drive link, when shortening fails or is not configured', async () => {
    const { t, alice } = await setup();
    t.shortener.error = new Error('TinyURL down');
    const { claimId } = await submitNewClaim(t, alice);
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('done');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('ready');
    expect(c.pdf.shortUrl).toBeNull();
    expect(t.sheets.rows.get(claimId)?.[16]).toBe(`https://drive.google.com/file/d/${c.pdf.driveFileId}/view`);

    t.deps.shortener = null;
    const { claimId: second } = await submitNewClaim(t, alice);
    expect(await generatePdf(t.deps, second, t.triggered[1]!.requestId)).toBe('done');
    expect((await getClaim(t.deps.db, second))!.pdf.shortUrl).toBeNull();
  });

  it('prints the ref number on the PDF and ends the file name with the status', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('done');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.fileName).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Pending.pdf');
    const text = await extractText(t.drive.files.get(c.pdf.driveFileId!)!.data, 1);
    expect(text).toContain('REF: PR-JEP-202609-0001');
    expect(text).not.toContain('Pending');
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

  it('uploads a new file when the old PDF was deleted from Drive', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await generatePdf(t.deps, claimId, t.triggered[0]!.requestId);
    const oldId = (await getClaim(t.deps.db, claimId))!.pdf.driveFileId!;
    await t.drive.trash(oldId);

    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[1]!.requestId)).toBe('done');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.driveFileId).not.toBe(oldId);
    expect(t.drive.livePdfs()).toHaveLength(1);
  });

  it('rewrites the current version when an older one overwrote the file after it finished', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await generatePdf(t.deps, claimId, t.triggered[0]!.requestId);
    const fileId = (await getClaim(t.deps.db, claimId))!.pdf.driveFileId!;

    // Version 2 (approved) is requested; while it writes, version 3 (paid) is requested and finishes first.
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    const original = t.drive.overwrite.bind(t.drive);
    let raced = false;
    t.drive.overwrite = async (id, p) => {
      if (!raced) {
        raced = true;
        await markPaid(t.deps, boss, { claimId, paidDate: '2026-09-28', reference: 'R1' });
        await generatePdf(t.deps, claimId, t.triggered.at(-1)!.requestId);
      }
      return original(id, p);
    };
    await generatePdf(t.deps, claimId, t.triggered[1]!.requestId);

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf).toMatchObject({ status: 'ready', driveFileId: fileId, fileName: 'PR-JEP-202609-0001-Tan Ah Kow-150.00-Paid.pdf' });
    expect(t.drive.files.get(fileId)!.name).toBe('PR-JEP-202609-0001-Tan Ah Kow-150.00-Paid.pdf');
    expect(await extractText(t.drive.files.get(fileId)!.data, 1)).toContain('Paid on');
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
