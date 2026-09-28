import type { Api } from '../lib/api';
import type { LocalAttachment } from './types';
import type { PutFile } from './submitFlow';
import type { PaymentSlipSuggestion } from '@jep/shared';

export interface PaidFields {
  paidDate: string;
  reference: string;
}

/** Fills the Mark-as-paid fields from a slip's reading; fields it found nothing for keep what was typed. */
export function applyPaymentSuggestion(fields: PaidFields, s: PaymentSlipSuggestion): { fields: PaidFields; filled: number } {
  const next = { ...fields };
  let filled = 0;
  if (s.paidDate) {
    next.paidDate = s.paidDate;
    filled++;
  }
  if (s.reference) {
    next.reference = s.reference;
    filled++;
  }
  return { fields: next, filled };
}

/** Uploads the slip into the claim's receipts folder (purpose 'paymentSlip'). Resolves with its Drive id. */
export async function uploadPaymentSlip(
  api: Pick<Api, 'uploadSession'>,
  putFile: PutFile,
  claimId: string,
  file: LocalAttachment,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const { uploads } = await api.uploadSession({
    claimId,
    purpose: 'paymentSlip',
    files: [{ name: file.name, mimeType: file.mimeType, size: file.size }],
  });
  return putFile(uploads[0]!.uploadUrl, file.uri, file.mimeType, onProgress);
}
