import type { PDFFont } from 'pdf-lib';

// CJK characters break anywhere; other text breaks at whitespace.
const CJK = '⺀-鿿가-힯豈-﫿＀-￯';
const TOKEN_RE = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

function splitLongToken(tok: string, fits: (s: string) => boolean): string[] {
  if (fits(tok)) return [tok];
  const out: string[] = [];
  let chunk = '';
  for (const ch of tok) {
    if (chunk && !fits(chunk + ch)) {
      out.push(chunk);
      chunk = ch;
    } else {
      chunk += ch;
    }
  }
  if (chunk) out.push(chunk);
  return out;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  const lines: string[] = [];
  for (const para of text.replace(/\t/g, ' ').split(/\r?\n/)) {
    const tokens = (para.match(TOKEN_RE) ?? []).flatMap((t) => splitLongToken(t, fits));
    let line = '';
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok);
      if (line === '' && isSpace) continue;
      if (fits(line + tok)) {
        line += tok;
      } else {
        lines.push(line.trimEnd());
        line = isSpace ? '' : tok;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
