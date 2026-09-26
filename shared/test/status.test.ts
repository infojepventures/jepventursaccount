import { describe, expect, it } from 'vitest';
import { allowedActions, canPerform } from '../src/status';

const applicant = { isApplicant: true, isAdmin: false };
const admin = { isApplicant: false, isAdmin: true };

describe('canPerform', () => {
  it('lets only the applicant cancel a submitted claim', () => {
    expect(canPerform('cancel', { status: 'submitted', ...applicant })).toBe(true);
    expect(canPerform('cancel', { status: 'approved', ...applicant })).toBe(false);
    expect(canPerform('cancel', { status: 'submitted', ...admin })).toBe(false);
  });
  it('lets only admins approve/reject submitted claims', () => {
    expect(canPerform('approve', { status: 'submitted', ...admin })).toBe(true);
    expect(canPerform('approve', { status: 'submitted', ...applicant })).toBe(false);
    expect(canPerform('reject', { status: 'approved', ...admin })).toBe(false);
  });
  it('lets only the applicant resubmit a rejected claim', () => {
    expect(canPerform('resubmit', { status: 'rejected', ...applicant })).toBe(true);
    expect(canPerform('resubmit', { status: 'rejected', ...admin })).toBe(false);
  });
  it('lets admins mark approved claims paid', () => {
    expect(canPerform('mark_paid', { status: 'approved', ...admin })).toBe(true);
    expect(canPerform('mark_paid', { status: 'submitted', ...admin })).toBe(false);
  });
  it('allows PDF regeneration for applicant or admin except on cancelled claims', () => {
    expect(canPerform('regenerate_pdf', { status: 'paid', ...applicant })).toBe(true);
    expect(canPerform('regenerate_pdf', { status: 'cancelled', ...admin })).toBe(false);
  });
});

describe('allowedActions', () => {
  it('lists actions in rule order', () => {
    expect(allowedActions({ status: 'submitted', isApplicant: true, isAdmin: true })).toEqual([
      'cancel',
      'approve',
      'reject',
      'regenerate_pdf',
    ]);
  });
});
