import { extractSuggestionFromText, type AttachmentSuggestion } from '@jep/shared';
import type { DocAiDocument, DocAiEntity } from './docai';

export { extractSuggestionFromText };

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
