import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim } from '../../lib/firestore';
import { cancelClaim, markPaid, regeneratePdf } from '../../lib/services/claimActions';
import { markPdfFailed } from '../../lib/services/pdfTrigger';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { makeTestDeps, resetEmulators, seedActor, seedCounter, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  await seedCounter(t.deps);
  const alice = await seedActor(t.deps, 'alice');
  const bob = await seedActor(t.deps, 'bob');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, bob, boss };
}

describe('cancelClaim', () => {
  it('lets the applicant withdraw a submitted claim', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    expect(await cancelClaim(t.deps, alice, { claimId })).toEqual({ status: 'cancelled' });
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('cancelled');
    expect(c.history.at(-1)?.action).toBe('cancel');
    expect(t.sheets.rows.get(claimId)?.[2]).toBe('cancelled');
  });

  it('refuses other users and non-submitted claims', async () => {
    const { t, alice, bob, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(cancelClaim(t.deps, bob, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(cancelClaim(t.deps, boss, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(cancelClaim(t.deps, alice, { claimId })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
  });
});

describe('markPaid', () => {
  it('records payment on an approved claim', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(markPaid(t.deps, boss, { claimId, paidDate: '2026-09-27', reference: 'IBG' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(markPaid(t.deps, boss, { claimId, paidDate: '27/09/2026', reference: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(markPaid(t.deps, alice, { claimId, paidDate: '2026-09-27', reference: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await markPaid(t.deps, boss, { claimId, paidDate: '2026-09-27', reference: ' IBG123 ' })).toEqual({ status: 'paid' });
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('paid');
    expect(c.paidInfo).toMatchObject({ byUid: 'boss', paidDate: '2026-09-27', reference: 'IBG123' });
    expect(t.sheets.rows.get(claimId)?.[14]).toBe('2026-09-27');
  });
});

describe('regeneratePdf', () => {
  it('only restarts a failed PDF, for the applicant or an admin', async () => {
    const { t, alice, bob, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(regeneratePdf(t.deps, alice, { claimId })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });

    await markPdfFailed(t.deps, claimId, t.triggered[0]!.requestId, 'boom');
    await expect(regeneratePdf(t.deps, bob, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await regeneratePdf(t.deps, boss, { claimId })).toEqual({ ok: true });

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('generating');
    expect(c.pdf.error).toBeNull();
    expect(t.triggered.at(-1)).toEqual({ claimId, requestId: c.pdf.requestId });
    expect(c.history.at(-1)?.action).toBe('pdf_regenerate');
  });
});
