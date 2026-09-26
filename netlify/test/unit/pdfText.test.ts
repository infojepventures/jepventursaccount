import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../lib/pdfText';

async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 460;
  for (const line of lines) {
    if (line) page.drawText(line, { x: 40, y, size: 12, font });
    y -= 20;
  }
  return doc.save();
}

describe('extractPdfText', () => {
  it('reconstructs one line per row, keeping a label and its value together', async () => {
    const bytes = await makePdf(['Invoice No: ICS-000024', 'Total RM 450.00', 'CIMB BANK', 'Account No: 8011557404']);
    const text = await extractPdfText(bytes);
    const lines = text.split('\n');
    expect(lines).toContain('Invoice No: ICS-000024');
    expect(lines).toContain('Total RM 450.00');
    expect(lines).toContain('Account No: 8011557404');
  });

  it('preserves top-to-bottom order', async () => {
    const bytes = await makePdf(['First line', 'Second line', 'Third line']);
    const text = await extractPdfText(bytes);
    expect(text.split('\n')).toEqual(['First line', 'Second line', 'Third line']);
  });

  it('skips blank rows', async () => {
    const bytes = await makePdf(['Alpha', '', 'Beta']);
    const text = await extractPdfText(bytes);
    expect(text.split('\n')).toEqual(['Alpha', 'Beta']);
  });

  it('still works once esbuild inlines pdfjs into a single deployed file (no sibling pdf.worker.mjs)', async () => {
    // Regression: on Netlify every PDF failed with "Setting up fake worker failed" because the bundle had no
    // pdf.worker.mjs next to it. Bundle the way scripts/build-functions.mjs does and run it from a temp dir.
    const dir = mkdtempSync(path.join(tmpdir(), 'pdftext-bundle-'));
    try {
      const pdfPath = path.join(dir, 'in.pdf');
      writeFileSync(pdfPath, await makePdf(['Invoice No: IV-00615', 'Total 5000.00']));
      const entry = path.join(dir, 'entry.ts');
      writeFileSync(
        entry,
        `import { readFileSync } from 'node:fs';
import { extractPdfText } from ${JSON.stringify(path.resolve(__dirname, '../../lib/pdfText.ts'))};
extractPdfText(readFileSync(process.argv[2])).then((t) => process.stdout.write(t));`,
      );
      const outfile = path.join(dir, 'out.mjs');
      await esbuild.build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        logLevel: 'silent',
        banner: { js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" },
      });
      const text = execFileSync(process.execPath, [outfile, pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      expect(text.split('\n')).toEqual(['Invoice No: IV-00615', 'Total 5000.00']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
