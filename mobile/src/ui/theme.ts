import type { ClaimStatus } from '@jep/shared';

export const colors = {
  bg: '#F6F6F4',
  card: '#FFFFFF',
  text: '#111111',
  muted: '#6B6B6B',
  border: '#E3E3E0',
  primary: '#111111',
  primaryText: '#FFFFFF',
  danger: '#B42318',
  success: '#067647',
  warning: '#B54708',
  info: '#175CD3',
};

export const space = (n: number) => n * 4;
export const radius = 12;

export const STATUS_STYLE: Record<ClaimStatus, { bg: string; fg: string; label: string }> = {
  submitted: { bg: '#EFF4FF', fg: '#175CD3', label: 'Pending' },
  approved: { bg: '#FEF6EE', fg: '#B54708', label: 'Approved' },
  paid: { bg: '#ECFDF3', fg: '#067647', label: 'Paid' },
  rejected: { bg: '#FEF3F2', fg: '#B42318', label: 'Rejected' },
  cancelled: { bg: '#F2F4F7', fg: '#475467', label: 'Cancelled' },
};
