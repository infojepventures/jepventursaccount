import { describe, expect, it } from 'vitest';
import { planRenumber } from '../../lib/renumber';

const claim = (id: string, submittedAt: string, status: 'submitted' | 'approved' | 'paid' | 'rejected' | 'cancelled', refNo: string) => ({
  id, submittedAt: new Date(submittedAt), status, refNo,
});

describe('planRenumber', () => {
  it('numbers every claim from 0001 in submission order, with its submission month and status suffix', () => {
    const plan = planRenumber([
      claim('b', '2026-09-26T03:00:00Z', 'approved', 'PR-JEP-202609-002'),
      claim('a', '2026-09-26T01:00:00Z', 'paid', 'PR-JEP-202609-001'),
      claim('c', '2026-09-30T16:30:00Z', 'submitted', 'PR-JEP-202610-draft'), // 1 Oct 00:30 in Kuala Lumpur
      claim('d', '2026-09-27T05:00:00Z', 'cancelled', 'PR-JEP-202609-draft'),
    ]);
    expect(plan.changes).toEqual([
      { id: 'a', from: 'PR-JEP-202609-001', refBase: 'PR-JEP-202609-0001', refNo: 'PR-JEP-202609-0001-Paid' },
      { id: 'b', from: 'PR-JEP-202609-002', refBase: 'PR-JEP-202609-0002', refNo: 'PR-JEP-202609-0002-Approved' },
      { id: 'd', from: 'PR-JEP-202609-draft', refBase: 'PR-JEP-202609-0003', refNo: 'PR-JEP-202609-0003-Cancelled' },
      { id: 'c', from: 'PR-JEP-202610-draft', refBase: 'PR-JEP-202610-0004', refNo: 'PR-JEP-202610-0004-Draft' },
    ]);
    expect(plan.nextCounter).toBe(5);
  });

  it('breaks ties on the same submission time by claim id, so reruns give the same result', () => {
    const t = '2026-09-26T01:00:00Z';
    expect(planRenumber([claim('z', t, 'submitted', 'x'), claim('m', t, 'submitted', 'y')]).changes.map((c) => c.id)).toEqual(['m', 'z']);
  });

  it('starts the counter at 1 when there are no claims', () => {
    expect(planRenumber([])).toEqual({ changes: [], nextCounter: 1 });
  });
});
