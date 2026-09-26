import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { wrapText } from '../../lib/pdf/wrapText';

describe('wrapText', () => {
  let font: PDFFont;
  beforeAll(async () => {
    font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  });
  const w = (s: string) => font.widthOfTextAtSize(s, 10);

  it('wraps on spaces', () => {
    expect(wrapText('aaa bbb ccc', font, 10, w('aaa bbb'))).toEqual(['aaa bbb', 'ccc']);
  });
  it('hard-breaks tokens longer than the line', () => {
    const lines = wrapText('abcdefghij', font, 10, w('abcd'));
    expect(lines.join('')).toBe('abcdefghij');
    expect(lines.every((l) => w(l) <= w('abcd'))).toBe(true);
  });
  it('keeps explicit newlines as separate lines', () => {
    expect(wrapText('one\ntwo', font, 10, 500)).toEqual(['one', 'two']);
  });
  it('returns one empty line for empty text', () => {
    expect(wrapText('', font, 10, 100)).toEqual(['']);
  });
});
