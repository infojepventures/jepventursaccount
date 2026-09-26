import type { AttachmentMime } from '@jep/shared';

export interface LocalAttachment {
  key: string;
  kind: 'local';
  uri: string;
  name: string;
  mimeType: AttachmentMime;
  size: number;
  uploadedId?: string;
  progress?: number;
  error?: string;
  /** Set while the OCR request for this (already-uploaded) attachment is in flight. */
  analyzing?: boolean;
  /** Set once analysis has been attempted (success or failure), so it is not retried on rerender. */
  analyzed?: boolean;
  /** Set when the OCR request failed; cleared on a fresh attempt. */
  analyzeError?: string;
}

export interface RemoteAttachment {
  key: string;
  kind: 'remote';
  driveFileId: string;
  name: string;
  mimeType: AttachmentMime;
  size: number;
}

export type AnyAttachment = LocalAttachment | RemoteAttachment;

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;
