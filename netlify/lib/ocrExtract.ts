import type { AttachmentSuggestion } from '@jep/shared';
import type { DocAiDocument, DocAiEntity } from './docai';

const BANKS: { pattern: RegExp; display: string }[] = [
  { pattern: /maybank|malayan\s+banking/i, display: 'MAYBANK' },
  { pattern: /cimb/i, display: 'CIMB BANK' },
  { pattern: /public\s*bank/i, display: 'PUBLIC BANK' },
  { pattern: /\brhb\b/i, display: 'RHB BANK' },
  { pattern: /hong\s*leong/i, display: 'HONG LEONG BANK' },
  { pattern: /ambank/i, display: 'AMBANK' },
  { pattern: /\buob\b/i, display: 'UOB' },
  { pattern: /\bocbc\b/i, display: 'OCBC BANK' },
  { pattern: /\bhsbc\b/i, display: 'HSBC BANK' },
  { pattern: /standard\s*chartered/i, display: 'STANDARD CHARTERED BANK' },
  { pattern: /bank\s*islam/i, display: 'BANK ISLAM' },
  { pattern: /bank\s*rakyat/i, display: 'BANK RAKYAT' },
  { pattern: /bsn|bank\s*simpanan\s*nasional/i, display: 'BANK SIMPANAN NASIONAL' },
  { pattern: /affin/i, display: 'AFFIN BANK' },
  { pattern: /alliance/i, display: 'ALLIANCE BANK' },
  { pattern: /agrobank/i, display: 'AGROBANK' },
  { pattern: /bank\s*muamalat/i, display: 'BANK MUAMALAT' },
  { pattern: /\bmbsb\b/i, display: 'MBSB BANK' },
  { pattern: /al\s*rajhi/i, display: 'AL RAJHI BANK' },
  { pattern: /citibank/i, display: 'CITIBANK' },
];

const ACCOUNT_LABEL = /(account|acc|a\/c)\s*(no\.?|number|#)?/i;
const DIGIT_RUN = /\b[\d](?:[\d \-]*[\d])?\b/g;

function findEntity(entities: DocAiEntity[], ...types: string[]): DocAiEntity | undefined {
  for (const type of types) {
    const hit = entities.find((e) => e.type === type);
    if (hit) return hit;
  }
  return undefined;
}

function textOf(e: DocAiEntity | undefined): string | undefined {
  const t = (e?.normalizedValue?.text ?? e?.mentionText)?.trim();
  return t ? t : undefined;
}

function moneyValueToCents(v: { units?: string; nanos?: number } | undefined): number | null {
  if (!v || (v.units === undefined && v.nanos === undefined)) return null;
  const units = Number(v.units ?? '0');
  const nanos = v.nanos ?? 0;
  if (!Number.isFinite(units)) return null;
  const cents = Math.round(units * 100 + nanos / 10_000_000);
  return Number.isFinite(cents) ? cents : null;
}

/** Parses "RM 1,234.50" / "1234.50" style amounts (thousands comma, dot decimal) into cents. */
function parseAmountText(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/[\d][\d,]*(?:\.\d{1,2})?/);
  if (!match) return null;
  const cleaned = match[0].replace(/,/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const dot = cleaned.indexOf('.');
  const cents = dot === -1 ? n * 100 : Math.round(n * 100);
  return Number.isInteger(cents) ? cents : Math.round(cents);
}

function amountCentsOf(e: DocAiEntity | undefined): number | undefined {
  if (!e) return undefined;
  const fromMoney = moneyValueToCents(e.normalizedValue?.moneyValue);
  if (fromMoney !== null) return fromMoney;
  const fromText = parseAmountText(e.normalizedValue?.text ?? e.mentionText);
  return fromText ?? undefined;
}

function firstLineItemDescription(entities: DocAiEntity[]): string | undefined {
  const lineItem = entities.find((e) => e.type === 'line_item');
  const desc = lineItem?.properties?.find((p) => p.type === 'line_item/description');
  return textOf(desc);
}

function looksLikePhoneOrDate(digits: string, context: string): boolean {
  if (/^(01|\+?60\s*1)/.test(digits.replace(/[\s-]/g, ''))) return true;
  // A date like 12/09/2026, 2026-09-25, or 25-09-2026 near the match.
  if (/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(context)) return true;
  return false;
}

function extractAccountNumber(text: string, bankDisplay: string | undefined): string | undefined {
  const lines = text.split(/\r?\n/);

  const digitsFromLine = (line: string): string | undefined => {
    const matches = [...line.matchAll(DIGIT_RUN)];
    for (const m of matches) {
      const raw = m[0];
      const digitsOnly = raw.replace(/[\s-]/g, '');
      if (digitsOnly.length < 6 || digitsOnly.length > 20) continue;
      if (looksLikePhoneOrDate(digitsOnly, line)) continue;
      return digitsOnly;
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!ACCOUNT_LABEL.test(line)) continue;
    const sameLine = digitsFromLine(line.replace(ACCOUNT_LABEL, ''));
    if (sameLine) return sameLine;
    const nextLine = lines[i + 1];
    if (nextLine) {
      const found = digitsFromLine(nextLine);
      if (found) return found;
    }
  }

  if (bankDisplay) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const bank of BANKS) {
        if (bank.display !== bankDisplay || !bank.pattern.test(line)) continue;
        const found = digitsFromLine(line) ?? (lines[i + 1] ? digitsFromLine(lines[i + 1]!) : undefined);
        if (found) return found;
      }
    }
  }

  return undefined;
}

function detectBank(text: string): string | undefined {
  for (const bank of BANKS) {
    if (bank.pattern.test(text)) return bank.display;
  }
  return undefined;
}

// --- Free (no Document AI) text-rule extraction --------------------------------------------

/**
 * "Invoice No" / "Inv No." / "Receipt #" / "Bill No" / "Doc No" / "Ref:" / "Reference No". Whole-word labels only, so
 * disclaimers like "invoice not valid" don't match; the captured value must contain a digit (checked below).
 */
const REF_LABEL =
  /\b(?:invoice|inv|receipt|bill|doc|ref(?:erence)?)\b\.?\s*(?:no\b\.?|number\b|#)?\s*(?:[:#]|\s-\s)?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i;
/** Fallback bare reference token, e.g. INV-000317, ICS-000024. */
const REF_TOKEN = /\b[A-Z]{2,6}-\d{3,}\b/;

function findReferenceFromText(text: string, lines: string[]): string | undefined {
  for (const line of lines) {
    for (const m of line.matchAll(new RegExp(REF_LABEL, 'gi'))) {
      const value = (m[1] ?? '').replace(/[.,;]+$/, '').trim();
      if (/\d/.test(value)) return value;
    }
  }
  const token = text.match(REF_TOKEN);
  return token?.[0];
}

const TOTAL_LABEL = /(grand\s*total|nett?\s*total|total\s*payable|amount\s*due|\btotal\b)/i;
const SUBTOTAL = /sub\s*-?\s*total/i;
const MONEY_TOKEN = /\d{1,3}(?:,\d{3})*\.\d{2}/g;

function lastMoneyOnLine(line: string): number | undefined {
  const matches = [...line.matchAll(MONEY_TOKEN)];
  const raw = matches.at(-1)?.[0];
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Picks the largest amount found on a line labelled Grand Total / Total / Amount Due / Total Payable / Nett Total. */
function findAmountFromText(lines: string[]): number | undefined {
  const candidates: number[] = [];
  for (const line of lines) {
    if (SUBTOTAL.test(line) || !TOTAL_LABEL.test(line)) continue;
    const cents = lastMoneyOnLine(line);
    if (cents !== undefined) candidates.push(cents);
  }
  return candidates.length ? Math.max(...candidates) : undefined;
}

const HOLDER_LABEL = /(?:account\s*name|a\/c\s*name|payee|beneficiary|pay\s*to)\s*[:\-]?\s*(.+)$/i;
const COMPANY_HINT = /\b(SDN\s*BHD|BHD|ENTERPRISE|TRADING|PLT|RESOURCES)\b/i;
const isAllCaps = (s: string) => s === s.toUpperCase() && /[A-Z]/.test(s);

/** Drops a trailing company registration number like "(1040447-X)" / "(202001012345)" and trailing dots. */
function cleanHolderName(name: string): string {
  return name
    .replace(/\s*\(\s*[A-Z0-9\-]*\d[A-Z0-9\-]*\s*\)\s*$/i, '')
    .replace(/[.\s]+$/, '')
    .trim();
}

function findAccountHolderFromText(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = line.match(HOLDER_LABEL);
    const value = m?.[1] ? cleanHolderName(m[1]) : '';
    if (value) return value;
  }
  for (const line of lines.slice(0, 10)) {
    if (isAllCaps(line) && COMPANY_HINT.test(line)) return cleanHolderName(line);
  }
  return undefined;
}

const LINE_ITEM_EXCLUDE =
  /(total|subtotal|tax|sst|gst|service\s*charge|change|cash|balance|rounding|discount|qty|quantity|price|description|invoice|receipt|bill|date|account|bank|payee|beneficiary)/i;
const LINE_ITEM = /^(.{3,80}?)\s+(?:\d+\s*[xX]?\s*)?(?:RM\s*)?(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/;

/** First line that looks like "<description> <amount>" and isn't a total/tax/label line. */
function findDescriptionFromText(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = line.match(LINE_ITEM);
    const desc = m?.[1]?.trim();
    if (!desc || desc.length < 3) continue;
    if (LINE_ITEM_EXCLUDE.test(line)) continue;
    return desc;
  }
  return undefined;
}

/**
 * Pure, Document-AI-free extraction from raw attachment text (on-device OCR for images, or
 * pdfjs-extracted text for PDFs). See spec §15 for the rule list.
 */
export function extractSuggestionFromText(text: string): AttachmentSuggestion {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const reference = findReferenceFromText(text ?? '', lines);
  const description = findDescriptionFromText(lines);
  const amountCents = findAmountFromText(lines);
  const accountHolder = findAccountHolderFromText(lines);
  const bankName = detectBank(text ?? '');
  const accountNumber = extractAccountNumber(text ?? '', bankName);

  const payee =
    accountHolder || bankName || accountNumber
      ? {
          ...(accountHolder ? { accountHolder } : {}),
          ...(bankName ? { bankName } : {}),
          ...(accountNumber ? { accountNumber } : {}),
        }
      : undefined;

  return {
    ...(reference ? { reference } : {}),
    ...(description ? { description } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(payee ? { payee } : {}),
  };
}

/** Document AI extraction: entities first (spec §15's entity mapping), falling back to the free text rules for any gap. */
export function extractSuggestion(doc: DocAiDocument): AttachmentSuggestion {
  const entities = doc.entities ?? [];

  const reference = textOf(findEntity(entities, 'invoice_id', 'receipt_id'));
  const description = firstLineItemDescription(entities) ?? textOf(findEntity(entities, 'supplier_name'));
  const amountCents = amountCentsOf(findEntity(entities, 'total_amount')) ?? amountCentsOf(findEntity(entities, 'net_amount'));
  const accountHolder = textOf(findEntity(entities, 'supplier_name')) ?? textOf(findEntity(entities, 'remit_to_name'));

  // Document AI's invoice parser has no bank/account entity types; those always come from the
  // full-text rules, same as the free path.
  const fromText = extractSuggestionFromText(doc.text ?? '');

  const finalReference = reference ?? fromText.reference;
  const finalDescription = description ?? fromText.description;
  const finalAmountCents = amountCents ?? fromText.amountCents;
  const finalHolder = accountHolder ?? fromText.payee?.accountHolder;
  const bankName = fromText.payee?.bankName;
  const accountNumber = fromText.payee?.accountNumber;

  const payee =
    finalHolder || bankName || accountNumber
      ? {
          ...(finalHolder ? { accountHolder: finalHolder } : {}),
          ...(bankName ? { bankName } : {}),
          ...(accountNumber ? { accountNumber } : {}),
        }
      : undefined;

  return {
    ...(finalReference ? { reference: finalReference } : {}),
    ...(finalDescription ? { description: finalDescription } : {}),
    ...(finalAmountCents !== undefined ? { amountCents: finalAmountCents } : {}),
    ...(payee ? { payee } : {}),
  };
}
