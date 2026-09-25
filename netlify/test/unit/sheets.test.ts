import { describe, expect, it } from 'vitest';
import { SheetsClient } from '../../lib/sheets';

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: decodeURIComponent(String(url)), init });
    return new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('SheetsClient', () => {
  it('updates the existing row for a claim', async () => {
    const f = fakeFetch([{ values: [['Claim ID'], ['aaa'], ['bbb']] }, {}]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).upsertClaimRow('bbb', ['bbb', 'x']);
    expect(f.calls[0]!.url).toContain('/SHEET/values/Claims!A:A');
    expect(f.calls[1]!.url).toContain('/values/Claims!A3?valueInputOption=RAW');
    expect(f.calls[1]!.init.method).toBe('PUT');
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ values: [['bbb', 'x']] });
  });

  it('appends when the claim is not in the sheet', async () => {
    const f = fakeFetch([{ values: [['Claim ID']] }, {}]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).upsertClaimRow('ccc', ['ccc']);
    expect(f.calls[1]!.url).toContain('/values/Claims!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
    expect(f.calls[1]!.init.method).toBe('POST');
  });

  it('deletes a claim row by index', async () => {
    const f = fakeFetch([
      { values: [['Claim ID'], ['aaa']] },
      { sheets: [{ properties: { sheetId: 7, title: 'Claims' } }] },
      {},
    ]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).deleteClaimRow('aaa');
    expect(JSON.parse(String(f.calls[2]!.init.body))).toEqual({
      requests: [{ deleteDimension: { range: { sheetId: 7, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }],
    });
  });
});
