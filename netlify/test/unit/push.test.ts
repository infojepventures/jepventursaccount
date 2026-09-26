import { describe, expect, it, vi } from 'vitest';
import type { ClaimDoc } from '@jep/shared';
import { buildMessage } from '../../lib/services/notify';
import { FcmPush } from '../../lib/push';

function stubMessaging(responses: { success: boolean; error?: { code: string } }[]) {
  return { sendEachForMulticast: vi.fn().mockResolvedValue({ responses }) } as unknown as import('firebase-admin/messaging').Messaging;
}

describe('FcmPush', () => {
  it('chunks at 500 tokens', async () => {
    const messaging = stubMessaging(Array.from({ length: 500 }, () => ({ success: true })));
    const send = (messaging as unknown as { sendEachForMulticast: ReturnType<typeof vi.fn> }).sendEachForMulticast;
    send.mockResolvedValueOnce({ responses: Array.from({ length: 500 }, () => ({ success: true })) });
    send.mockResolvedValueOnce({ responses: Array.from({ length: 100 }, () => ({ success: true })) });
    const push = new FcmPush(messaging);
    const tokens = Array.from({ length: 600 }, (_, i) => `t${i}`);
    await push.send(tokens, { title: 'Title', body: 'Body', data: {} });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].tokens).toHaveLength(500);
    expect(send.mock.calls[1]![0].tokens).toHaveLength(100);
  });

  it('extracts invalid tokens for the three known error codes, ignoring others', async () => {
    const messaging = stubMessaging([
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
      { success: false, error: { code: 'messaging/invalid-argument' } },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: true },
    ]);
    const push = new FcmPush(messaging);
    const tokens = ['a', 'b', 'c', 'd', 'e'];
    const { invalidTokens } = await push.send(tokens, { title: 'Title', body: 'Body', data: {} });
    expect(invalidTokens.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not call FCM with 0 tokens', async () => {
    const messaging = stubMessaging([]);
    const send = (messaging as unknown as { sendEachForMulticast: ReturnType<typeof vi.fn> }).sendEachForMulticast;
    const push = new FcmPush(messaging);
    const result = await push.send([], { title: 'Title', body: 'Body', data: {} });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ invalidTokens: [] });
  });
});

describe('buildMessage', () => {
  const base: ClaimDoc = {
    refNo: 'PR-JEP-202609-001',
    status: 'submitted',
    applicant: { uid: 'alice', name: 'Alice Tan', position: 'Executive' },
    items: [],
    totalCents: 15000,
    payment: { bankName: '', accountHolder: '', accountNumber: '' },
    attachments: [],
    attachmentsFolderId: 'f',
    pdf: { status: 'ready', requestId: 'r', requestedAt: null, driveFileId: null, fileName: null, error: null } as unknown as ClaimDoc['pdf'],
    review: null,
    paidInfo: null,
    history: [],
    submittedAt: null as unknown as ClaimDoc['submittedAt'],
    resubmittedAt: null,
    sheetSynced: true,
    createdAt: null as unknown as ClaimDoc['createdAt'],
    updatedAt: null as unknown as ClaimDoc['updatedAt'],
  };

  it('submitted', () => {
    expect(buildMessage('submitted', base, 'c1')).toEqual({
      title: 'New claim',
      body: 'Alice Tan submitted RM 150.00',
      data: { claimId: 'c1', event: 'submitted' },
    });
  });

  it('resubmitted', () => {
    expect(buildMessage('resubmitted', base, 'c1')).toEqual({
      title: 'Claim resubmitted',
      body: 'Alice Tan resubmitted RM 150.00',
      data: { claimId: 'c1', event: 'resubmitted' },
    });
  });

  it('approved', () => {
    expect(buildMessage('approved', base, 'c1')).toEqual({
      title: 'Claim approved',
      body: 'PR-JEP-202609-001 (RM 150.00) was approved',
      data: { claimId: 'c1', event: 'approved' },
    });
  });

  it('rejected', () => {
    const rejected: ClaimDoc = {
      ...base,
      review: { byUid: 'boss', byName: 'Boss', at: base.submittedAt, reason: 'No receipt' },
    };
    expect(buildMessage('rejected', rejected, 'c1')).toEqual({
      title: 'Claim rejected',
      body: 'Reason: No receipt',
      data: { claimId: 'c1', event: 'rejected' },
    });
  });

  it('paid', () => {
    expect(buildMessage('paid', base, 'c1')).toEqual({
      title: 'Claim paid',
      body: 'PR-JEP-202609-001 (RM 150.00) has been paid',
      data: { claimId: 'c1', event: 'paid' },
    });
  });
});
