import type { BankDetails, ClaimItem, ClaimStatus, Role } from './types';

/** Netlify function names, called as `${base}/.netlify/functions/${name}`. */
export const API = {
  session: 'session',
  uploadSession: 'drive-upload-session',
  submitClaim: 'submit-claim',
  reviewClaim: 'review-claim',
  cancelClaim: 'cancel-claim',
  markPaid: 'mark-paid',
  regeneratePdf: 'regenerate-pdf',
  fileProxy: 'file-proxy',
  adminUsers: 'admin-users',
  resyncSheet: 'resync-sheet',
  health: 'health',
} as const;

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_INVITED'
  | 'INACTIVE'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'STATUS_CHANGED'
  | 'FILE_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
}

export interface SessionResponse {
  uid: string;
  role: Role;
  profileComplete: boolean;
}

export interface UploadFileMeta {
  name: string;
  mimeType: string;
  size: number;
}

export interface UploadSessionRequest {
  claimId: string;
  files: UploadFileMeta[];
}

export interface UploadSessionResponse {
  folderId: string;
  /** Same order as the request files. PUT the raw bytes to uploadUrl; the JSON response has `id`. */
  uploads: { name: string; uploadUrl: string }[];
}

export interface SubmitClaimRequest {
  claimId: string;
  items: ClaimItem[];
  payment: BankDetails;
  /** Drive file IDs to keep/attach, in display order. */
  attachmentIds: string[];
  resubmit: boolean;
  saveBankToProfile: boolean;
}

export interface SubmitClaimResponse {
  claimId: string;
}

export interface ReviewClaimRequest {
  claimId: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

export interface ReviewClaimResponse {
  status: ClaimStatus;
  refNo: string;
}

export interface ClaimIdRequest {
  claimId: string;
}

export interface StatusResponse {
  status: ClaimStatus;
}

export interface MarkPaidRequest {
  claimId: string;
  /** yyyy-MM-dd */
  paidDate: string;
  reference: string;
}

export type AdminUsersRequest =
  | { action: 'invite'; email: string; role: Role }
  | { action: 'deleteInvite'; email: string }
  | { action: 'createPasswordUser'; email: string; password: string; name: string; role: Role }
  | { action: 'setRole'; uid: string; role: Role }
  | { action: 'setActive'; uid: string; active: boolean };

export interface AdminUsersResponse {
  ok: true;
  uid?: string;
}

export interface ResyncSheetResponse {
  synced: number;
  failed: number;
}
