/**
 * Reads the payment date and the bank's transaction reference from the text of a bank transfer slip
 * (Maybank2u, PBe, CIMB Clicks, DuitNow/IBG receipts, ...). Pure, so the app runs it on on-device OCR text
 * and the server runs it on a PDF's text layer.
 */

export interface PaymentSlipSuggestion {
  /** yyyy-MM-dd */
  paidDate?: string;
  reference?: string;
}

const MAX_LINE = 500;
const MAX_REFERENCE = 100;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, mac: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, ogo: 8, ogos: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dis: 12, disember: 12,
};
const MONTH_NAME = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
}

// Tried in order on each line; the first that yields a real calendar date wins.
const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpExecArray) => string | null }[] = [
  // 2026-09-28, 2026/09/28
  { re: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, parse: (m) => ymd(+m[1]!, +m[2]!, +m[3]!) },
  // 28/09/2026, 28-09-2026, 28.09.26 (day first, as printed in Malaysia)
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, parse: (m) => ymd(+m[3]!, +m[2]!, +m[1]!) },
  // 28 Sep 2026, 28-Sep-2026, 28 September, 2026
  {
    re: new RegExp(`\\b(\\d{1,2})[\\s-]*(${MONTH_NAME})\\.?[\\s,-]*(\\d{4}|\\d{2})\\b`, 'i'),
    parse: (m) => ymd(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!),
  },
  // Sep 28, 2026
  {
    re: new RegExp(`\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i'),
    parse: (m) => ymd(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!),
  },
];

function findDate(line: string): string | null {
  for (const { re, parse } of DATE_PATTERNS) {
    const m = re.exec(line);
    const d = m ? parse(m) : null;
    if (d) return d;
  }
  return null;
}

const DATE_LABEL = /\b(?:transaction|payment|transfer|posting|effective|value|txn)?\s*date\b|\btarikh\b/i;

// Most specific first. "Recipient reference" and similar are the payer's free-text note, not the bank's reference.
const REFERENCE_LABELS: RegExp[] = [
  /\b(?:transaction|txn|trx|trans\.?)\s*(?:reference|ref\.?)\s*(?:number|no\.?|id)?/i,
  /\b(?:duitnow|ibg|instant transfer|bank|payment)\s*(?:reference|ref\.?)\s*(?:number|no\.?|id)?/i,
  /\breference\s*(?:number|no\.?|id|code)/i,
  /\bref\.?\s*(?:number|no\.?|id)\b/i,
  /\b(?:transaction|txn|trx|trans\.?)\s*(?:id|no\.?|number)\b/i,
  /\b(?:confirmation|approval)\s*(?:number|no\.?|code)\b/i,
  /\bno\.?\s*rujukan\b|\brujukan\b/i,
  /\breference\b/i,
];
const NOT_BANK_REFERENCE = /\b(?:recipient|recipient's|beneficiary|payee|your|other|sender|payment details)\b/i;
const VALUE = /^[\s:：.#=-]*([A-Za-z0-9][A-Za-z0-9/-]{3,})/;

function referenceValue(s: string): string | null {
  const m = VALUE.exec(s);
  if (!m || !/\d/.test(m[1]!)) return null;
  return m[1]!.slice(0, MAX_REFERENCE);
}

function findReference(lines: string[]): string | null {
  for (const label of REFERENCE_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = label.exec(line);
      if (!m || NOT_BANK_REFERENCE.test(line.slice(0, m.index + m[0].length))) continue;
      const sameLine = referenceValue(line.slice(m.index + m[0].length));
      if (sameLine) return sameLine;
      // Label and value on separate lines (CIMB and others lay slips out as label / value pairs).
      const next = lines[i + 1];
      if (next && !REFERENCE_LABELS.some((l) => l.test(next))) {
        const nextValue = referenceValue(next);
        if (nextValue) return nextValue;
      }
    }
  }
  return null;
}

function findPaidDate(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!DATE_LABEL.test(lines[i]!)) continue;
    const d = findDate(lines[i]!) ?? (lines[i + 1] ? findDate(lines[i + 1]!) : null);
    if (d) return d;
  }
  for (const line of lines) {
    const d = findDate(line);
    if (d) return d;
  }
  return null;
}

export function extractPaymentSlipFromText(text: string): PaymentSlipSuggestion {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE))
    .filter(Boolean);
  const out: PaymentSlipSuggestion = {};
  const paidDate = findPaidDate(lines);
  if (paidDate) out.paidDate = paidDate;
  const reference = findReference(lines);
  if (reference) out.reference = reference;
  return out;
}
