import { recordPayeeChange, removePayeeSources, type PayeeHistory } from './payeeHistory';

const profile = { bankName: 'Public Bank', accountHolder: 'YU WAI LOONG', accountNumber: '6803149225' };
const cimb = { bankName: 'CIMB BANK', accountHolder: 'ULTRA CLEANING SDN BHD', accountNumber: '8605461067' };
const amb = { bankName: 'AMBANK', accountHolder: 'LK TRADING', accountNumber: '8881055120904' };

describe('payee history', () => {
  it("restores the profile's bank details when the only receipt that changed Pay to is removed", () => {
    const h = recordPayeeChange([], 'r1', profile);
    expect(removePayeeSources(h, ['r1'])).toEqual({ history: [], restore: profile });
  });

  it("restores the previous receipt's details when the latest one is removed", () => {
    let h: PayeeHistory = recordPayeeChange([], 'r1', profile);
    h = recordPayeeChange(h, 'r2', cimb);
    expect(removePayeeSources(h, ['r2'])).toEqual({ history: [{ key: 'r1', before: profile }], restore: cimb });
  });

  it('keeps the current details when an older receipt is removed, handing its "before" to the next one', () => {
    let h: PayeeHistory = recordPayeeChange([], 'r1', profile);
    h = recordPayeeChange(h, 'r2', cimb);
    const out = removePayeeSources(h, ['r1']);
    expect(out).toEqual({ history: [{ key: 'r2', before: profile }], restore: null });
    // Removing r2 later now goes all the way back to the profile.
    expect(removePayeeSources(out.history, ['r2'])).toEqual({ history: [], restore: profile });
  });

  it('handles removing several receipts at once (an item with more than one receipt)', () => {
    // r1 set CIMB (over the profile), r2 set AMBANK (over CIMB), r3 set something else (over AMBANK).
    let h: PayeeHistory = recordPayeeChange([], 'r1', profile);
    h = recordPayeeChange(h, 'r2', cimb);
    h = recordPayeeChange(h, 'r3', amb);
    expect(removePayeeSources(h, ['r2', 'r3'])).toEqual({ history: [{ key: 'r1', before: profile }], restore: cimb });
    expect(removePayeeSources(h, ['r1', 'r3'])).toEqual({ history: [{ key: 'r2', before: profile }], restore: amb });
  });

  it('does nothing for receipts that never changed Pay to', () => {
    const h = recordPayeeChange([], 'r1', profile);
    expect(removePayeeSources(h, ['other'])).toEqual({ history: h, restore: null });
  });

  it('a receipt read again (retry) keeps its original "before"', () => {
    let h: PayeeHistory = recordPayeeChange([], 'r1', profile);
    h = recordPayeeChange(h, 'r1', cimb);
    expect(h).toEqual([{ key: 'r1', before: profile }]);
  });
});
