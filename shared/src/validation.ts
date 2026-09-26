export const MAX_ITEMS = 50;
export const MIN_ATTACHMENTS = 1;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ITEM_AMOUNT_CENTS = 100_000_000; // RM 1,000,000 per line
export const ALLOWED_ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AttachmentMime = (typeof ALLOWED_ATTACHMENT_MIME)[number];

const isStr = (v: unknown): v is string => typeof v === 'string';

export function isAllowedMime(m: string): m is AttachmentMime {
  return (ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(m);
}

export function isValidClaimId(id: unknown): id is string {
  return isStr(id) && /^[A-Za-z0-9]{20}$/.test(id);
}

export function validateItems(items: unknown): string[] {
  if (!Array.isArray(items) || items.length === 0) return ['At least one item is required'];
  if (items.length > MAX_ITEMS) return [`At most ${MAX_ITEMS} items are allowed`];
  const errors: string[] = [];
  items.forEach((item: unknown, i) => {
    const n = i + 1;
    if (!item || typeof item !== 'object') {
      errors.push(`Item ${n}: invalid`);
      return;
    }
    const { description, amountCents, reference } = item as Record<string, unknown>;
    if (!isStr(description) || description.trim() === '') errors.push(`Item ${n}: description is required`);
    else if (description.length > 300) errors.push(`Item ${n}: description is too long`);
    if (
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > MAX_ITEM_AMOUNT_CENTS
    ) {
      errors.push(`Item ${n}: amount must be greater than 0`);
    }
    if (reference !== undefined) {
      if (!isStr(reference)) errors.push(`Item ${n}: doc no. is too long`);
      else if (reference.length > 60) errors.push(`Item ${n}: doc no. is too long`);
    }
  });
  return errors;
}

export function validateBank(bank: unknown): string[] {
  if (!bank || typeof bank !== 'object') return ['Bank details are required'];
  const { bankName, accountHolder, accountNumber } = bank as Record<string, unknown>;
  const errors: string[] = [];
  if (!isStr(bankName) || !bankName.trim()) errors.push('Bank name is required');
  else if (bankName.length > 100) errors.push('Bank name is too long');
  if (!isStr(accountHolder) || !accountHolder.trim()) errors.push('Account holder is required');
  else if (accountHolder.length > 100) errors.push('Account holder is too long');
  if (!isStr(accountNumber) || !accountNumber.trim()) errors.push('Account number is required');
  else if (!/^[0-9][0-9 -]{2,28}[0-9]$/.test(accountNumber.trim())) {
    errors.push('Account number must be 4-30 digits');
  }
  return errors;
}

export function validateAttachmentMeta(files: unknown): string[] {
  if (!Array.isArray(files) || files.length < MIN_ATTACHMENTS || files.length > MAX_ATTACHMENTS) {
    return [`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} files`];
  }
  const errors: string[] = [];
  files.forEach((f: unknown, i) => {
    const { name, mimeType, size } = (f ?? {}) as Record<string, unknown>;
    const label = isStr(name) && name.trim() ? name : `File ${i + 1}`;
    if (!isStr(name) || !name.trim() || name.length > 200) errors.push(`${label}: invalid file name`);
    if (!isStr(mimeType) || !isAllowedMime(mimeType)) {
      errors.push(`${label}: only JPG, PNG or PDF files are allowed`);
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) errors.push(`${label}: invalid size`);
    else if (size > MAX_ATTACHMENT_BYTES) errors.push(`${label}: file is larger than 10MB`);
  });
  return errors;
}
