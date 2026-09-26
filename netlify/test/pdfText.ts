import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Extracts the text of one page (1-based) as a single space-joined string. */
export async function extractText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
