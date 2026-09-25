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
