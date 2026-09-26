import type { ClaimStatus } from './types';

export type ClaimAction = 'cancel' | 'approve' | 'reject' | 'resubmit' | 'mark_paid' | 'regenerate_pdf';

export interface ClaimRule {
  from: readonly ClaimStatus[];
  who: 'applicant' | 'admin' | 'applicantOrAdmin';
  to: ClaimStatus | null;
}

export const CLAIM_RULES: Record<ClaimAction, ClaimRule> = {
  cancel: { from: ['submitted'], who: 'applicant', to: 'cancelled' },
  approve: { from: ['submitted'], who: 'admin', to: 'approved' },
  reject: { from: ['submitted'], who: 'admin', to: 'rejected' },
  resubmit: { from: ['rejected'], who: 'applicant', to: 'submitted' },
  mark_paid: { from: ['approved'], who: 'admin', to: 'paid' },
  regenerate_pdf: { from: ['submitted', 'approved', 'paid', 'rejected'], who: 'applicantOrAdmin', to: null },
};

export interface ClaimActionCtx {
  status: ClaimStatus;
  isApplicant: boolean;
  isAdmin: boolean;
}

export function roleAllows(rule: ClaimRule, ctx: Omit<ClaimActionCtx, 'status'>): boolean {
  if (rule.who === 'admin') return ctx.isAdmin;
  if (rule.who === 'applicant') return ctx.isApplicant;
  return ctx.isApplicant || ctx.isAdmin;
}

export function canPerform(action: ClaimAction, ctx: ClaimActionCtx): boolean {
  const rule = CLAIM_RULES[action];
  return roleAllows(rule, ctx) && rule.from.includes(ctx.status);
}

export function allowedActions(ctx: ClaimActionCtx): ClaimAction[] {
  return (Object.keys(CLAIM_RULES) as ClaimAction[]).filter((a) => canPerform(a, ctx));
}
