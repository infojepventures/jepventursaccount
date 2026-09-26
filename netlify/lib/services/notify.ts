import { formatRM, type ClaimDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { COL, getClaim } from '../firestore';
import type { PushMessage } from '../push';

export type ClaimEvent = 'submitted' | 'resubmitted' | 'approved' | 'rejected' | 'paid';

export function buildMessage(event: ClaimEvent, claim: ClaimDoc, claimId: string): PushMessage {
  const rm = formatRM(claim.totalCents);
  const data = { claimId, event };
  switch (event) {
    case 'submitted':
      return { title: 'New claim', body: `${claim.applicant.name} submitted ${rm}`, data };
    case 'resubmitted':
      return { title: 'Claim resubmitted', body: `${claim.applicant.name} resubmitted ${rm}`, data };
    case 'approved':
      return { title: 'Claim approved', body: `${claim.refNo} (${rm}) was approved`, data };
    case 'rejected':
      return { title: 'Claim rejected', body: `Reason: ${claim.review?.reason ?? ''}`, data };
    case 'paid':
      return { title: 'Claim paid', body: `${claim.refNo} (${rm}) has been paid`, data };
  }
}

const UID_CHUNK_SIZE = 30;

async function activeAdminUids(deps: Deps, excludeUid: string): Promise<string[]> {
  const snap = await deps.db.collection(COL.users).where('role', '==', 'admin').where('active', '==', true).get();
  return snap.docs.map((d) => d.id).filter((uid) => uid !== excludeUid);
}

async function resolveRecipients(deps: Deps, event: ClaimEvent, claim: ClaimDoc, actorUid: string): Promise<string[]> {
  if (event === 'submitted' || event === 'resubmitted') return activeAdminUids(deps, claim.applicant.uid);
  // approved / rejected / paid: notify the applicant, unless the actor is the applicant.
  if (actorUid === claim.applicant.uid) return [];
  return [claim.applicant.uid];
}

async function loadTokens(deps: Deps, uids: string[]): Promise<string[]> {
  const tokens: string[] = [];
  for (let i = 0; i < uids.length; i += UID_CHUNK_SIZE) {
    const chunk = uids.slice(i, i + UID_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const snap = await deps.db.collection(COL.pushTokens).where('uid', 'in', chunk).get();
    snap.docs.forEach((d) => tokens.push(d.id));
  }
  return tokens;
}

/** Best-effort push for a claim event. Never throws; failures are logged. */
export async function notifyClaimEvent(deps: Deps, event: ClaimEvent, claimId: string, actorUid: string): Promise<void> {
  try {
    const claim = await getClaim(deps.db, claimId);
    if (!claim) return;
    const recipients = await resolveRecipients(deps, event, claim, actorUid);
    if (recipients.length === 0) return;
    const tokens = await loadTokens(deps, recipients);
    if (tokens.length === 0) return;
    const msg = buildMessage(event, claim, claimId);
    const { invalidTokens } = await deps.push.send(tokens, msg);
    await Promise.all(invalidTokens.map((token) => deps.db.collection(COL.pushTokens).doc(token).delete()));
  } catch (e) {
    console.error('[notify]', e);
  }
}
