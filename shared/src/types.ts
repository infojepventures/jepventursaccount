import type { AttachmentMime } from './validation';

/** Structural type satisfied by both firebase-admin and firebase JS SDK Timestamps. */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
}

export type Role = 'member' | 'admin';
export type ClaimStatus = 'submitted' | 'approved' | 'paid' | 'rejected' | 'cancelled';
export type PdfStatus = 'generating' | 'ready' | 'failed';

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
}

export interface ClaimItem {
  description: string;
  amountCents: number;
}

export interface Attachment {
  driveFileId: string;
  name: string;
  mimeType: AttachmentMime;
  size: number;
}

export interface PdfInfo {
  status: PdfStatus;
  /** Identifies the latest generation request; stale background runs compare against it. */
  requestId: string;
  driveFileId: string | null;
  fileName: string | null;
  error: string | null;
}

export type HistoryAction =
  | 'submit'
  | 'resubmit'
  | 'cancel'
  | 'approve'
  | 'reject'
  | 'mark_paid'
  | 'pdf_regenerate';

export interface HistoryEntry {
  action: HistoryAction;
  byUid: string;
  byName: string;
  at: TimestampLike;
  note: string | null;
}

export interface ReviewInfo {
  byUid: string;
  byName: string;
  at: TimestampLike;
  /** Set only when rejected. */
  reason: string | null;
}

export interface PaidInfo {
  byUid: string;
  byName: string;
  at: TimestampLike;
  /** yyyy-MM-dd */
  paidDate: string;
  reference: string;
}

export interface ClaimDoc {
  refNo: string;
  status: ClaimStatus;
  applicant: { uid: string; name: string; position: string };
  items: ClaimItem[];
  totalCents: number;
  payment: BankDetails;
  attachments: Attachment[];
  attachmentsFolderId: string;
  pdf: PdfInfo;
  review: ReviewInfo | null;
  paidInfo: PaidInfo | null;
  history: HistoryEntry[];
  submittedAt: TimestampLike;
  resubmittedAt: TimestampLike | null;
  sheetSynced: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface UserDoc {
  email: string;
  name: string;
  position: string;
  role: Role;
  active: boolean;
  bank: BankDetails | null;
  authProvider: 'google' | 'password';
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface InviteDoc {
  role: Role;
  invitedByUid: string;
  invitedAt: TimestampLike;
}
