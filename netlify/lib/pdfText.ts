import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PAGES = 15;
/** Text items whose baseline y differs by more than this (PDF points) start a new line. */
const LINE_TOLERANCE = 2;

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Extracts a PDF's text, reconstructing line breaks from each item's y-position so that labels
 * and their values (e.g. "Invoice No:" / "ICS-000024") stay on the same line even though pdfjs
 * otherwise only reports a flat, unordered stream of positioned text runs.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(data), useSystemFonts: false, verbosity: 0 }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue;
      const transform = (raw as { transform?: number[] }).transform ?? [1, 0, 0, 1, 0, 0];
      items.push({ str: raw.str, x: transform[4] ?? 0, y: transform[5] ?? 0 });
    }
    // Top-to-bottom, then left-to-right within a line.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: string[] = [];
    let lineY: number | null = null;
    let line: PositionedItem[] = [];
    const flush = () => {
      if (line.length) lines.push(line.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
      line = [];
    };
    for (const item of items) {
      if (lineY === null || Math.abs(item.y - lineY) > LINE_TOLERANCE) {
        flush();
        lineY = item.y;
      }
      line.push(item);
    }
    flush();

    pageTexts.push(lines.filter((l) => l.length > 0).join('\n'));
  }

  return pageTexts.join('\n');
}
