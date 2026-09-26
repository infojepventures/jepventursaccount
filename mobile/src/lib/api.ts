import {
  API,
  type AdminUsersRequest, type AdminUsersResponse, type AnalyzeAttachmentRequest, type AnalyzeAttachmentResponse,
  type ApiErrorBody, type ClaimIdRequest, type ErrorCode,
  type MarkPaidRequest, type RegisterPushTokenRequest, type ResyncSheetResponse,
  type ReviewClaimRequest, type ReviewClaimResponse,
  type SessionResponse, type StatusResponse, type SubmitClaimRequest, type SubmitClaimResponse,
  type UnregisterPushTokenRequest, type UploadSessionRequest, type UploadSessionResponse,
} from '@jep/shared';

export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function friendlyMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    return e.code === 'NETWORK' ? 'No connection. Please check your internet and try again.' : e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

export interface ApiDeps {
  baseUrl: string;
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createApi(deps: ApiDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  const fnUrl = (name: string) => `${deps.baseUrl}/.netlify/functions/${name}`;

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await deps.getIdToken();
    if (!token) throw new ApiClientError('UNAUTHENTICATED', 'Please sign in.', 401);
    return { Authorization: `Bearer ${token}` };
  }

  async function call<T>(name: string, body: unknown): Promise<T> {
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    let res: Response;
    try {
      res = await doFetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new ApiClientError('NETWORK', 'Network request failed', 0);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON body; handled below
    }
    if (!res.ok) {
      const err = data as Partial<ApiErrorBody> | null;
      throw new ApiClientError(err?.error ?? 'INTERNAL', err?.message ?? `Request failed (${res.status})`, res.status);
    }
    return data as T;
  }

  return {
    session: () => call<SessionResponse>(API.session, {}),
    uploadSession: (req: UploadSessionRequest) => call<UploadSessionResponse>(API.uploadSession, req),
    submitClaim: (req: SubmitClaimRequest) => call<SubmitClaimResponse>(API.submitClaim, req),
    reviewClaim: (req: ReviewClaimRequest) => call<ReviewClaimResponse>(API.reviewClaim, req),
    cancelClaim: (req: ClaimIdRequest) => call<StatusResponse>(API.cancelClaim, req),
    markPaid: (req: MarkPaidRequest) => call<StatusResponse>(API.markPaid, req),
    regeneratePdf: (req: ClaimIdRequest) => call<{ ok: true }>(API.regeneratePdf, req),
    adminUsers: (req: AdminUsersRequest) => call<AdminUsersResponse>(API.adminUsers, req),
    resyncSheet: () => call<ResyncSheetResponse>(API.resyncSheet, {}),
    registerPushToken: (req: RegisterPushTokenRequest) => call<{ ok: true }>(API.registerPushToken, req),
    unregisterPushToken: (req: UnregisterPushTokenRequest) => call<{ ok: true }>(API.unregisterPushToken, req),
    analyzeAttachment: (req: AnalyzeAttachmentRequest) => call<AnalyzeAttachmentResponse>(API.analyzeAttachment, req),
    fileUrl: (claimId: string, fileId: string) =>
      `${fnUrl(API.fileProxy)}?claimId=${encodeURIComponent(claimId)}&fileId=${encodeURIComponent(fileId)}`,
    authHeaders,
  };
}

export type Api = ReturnType<typeof createApi>;
