import type { ErrorCode } from '@jep/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = {
  unauthenticated: (m = 'Please sign in.') => new ApiError(401, 'UNAUTHENTICATED', m),
  forbidden: (m = 'You are not allowed to do this.') => new ApiError(403, 'FORBIDDEN', m),
  notInvited: () => new ApiError(403, 'NOT_INVITED', 'This account is not authorised. Please contact an admin.'),
  inactive: () => new ApiError(403, 'INACTIVE', 'This account has been deactivated. Please contact an admin.'),
  notFound: (m = 'Not found.') => new ApiError(404, 'NOT_FOUND', m),
  invalid: (m: string) => new ApiError(400, 'INVALID_INPUT', m),
  statusChanged: () =>
    new ApiError(409, 'STATUS_CHANGED', 'This claim was changed by someone else. Please refresh and try again.'),
  tooLarge: (m: string) => new ApiError(413, 'FILE_TOO_LARGE', m),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True for a Firestore "document already exists" failure (from `ref.create`), e.g. a concurrent duplicate write. */
export function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists';
}
