import type { BankDetails } from './types';
import { validateBank } from './validation';

export function isProfileComplete(u: { name: string; position: string; bank: BankDetails | null }): boolean {
  return !!u.name.trim() && !!u.position.trim() && !!u.bank && validateBank(u.bank).length === 0;
}
