import { CLAIM_RULES, roleAllows, type ClaimAction, type ClaimDoc } from '@jep/shared';
import type { Actor } from './actor';
import { fail } from './errors';

export function canReadClaim(claim: ClaimDoc, actor: Actor): boolean {
  return actor.isAdmin || claim.applicant.uid === actor.uid;
}

/** Role/ownership failures are FORBIDDEN; a wrong current status is STATUS_CHANGED. */
export function assertCan(action: ClaimAction, claim: ClaimDoc, actor: Actor): void {
  const rule = CLAIM_RULES[action];
  if (!roleAllows(rule, { isApplicant: claim.applicant.uid === actor.uid, isAdmin: actor.isAdmin })) {
    throw fail.forbidden();
  }
  if (!rule.from.includes(claim.status)) throw fail.statusChanged();
}
