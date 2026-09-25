import type { TokenProvider } from './googleAuth';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEET_TAB = 'Claims';
export type SheetRow = (string | number)[];

export interface SheetsApi {
  upsertClaimRow(claimId: string, row: SheetRow): Promise<void>;
  deleteClaimRow(claimId: string): Promise<void>;
}

const range = (a1: string) => encodeURIComponent(`${SHEET_TAB}!${a1}`);

export class SheetsClient implements SheetsApi {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly spreadsheetId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.getToken()}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const res = await this.fetchImpl(`${API}/${this.spreadsheetId}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`Sheets ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async findRow(claimId: string): Promise<number | null> {
    const d = await this.call<{ values?: string[][] }>(`/values/${range('A:A')}`);
    const idx = (d.values ?? []).findIndex((r) => r[0] === claimId);
    return idx === -1 ? null : idx + 1;
  }

  private async tabs(): Promise<{ sheetId: number; title: string }[]> {
    const d = await this.call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      '?fields=sheets.properties',
    );
    return d.sheets.map((s) => s.properties);
  }

  async upsertClaimRow(claimId: string, row: SheetRow): Promise<void> {
    const n = await this.findRow(claimId);
    const body = JSON.stringify({ values: [row] });
    if (n) {
      await this.call(`/values/${range(`A${n}`)}?valueInputOption=RAW`, { method: 'PUT', body });
    } else {
      await this.call(`/values/${range('A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body,
      });
    }
  }

  async deleteClaimRow(claimId: string): Promise<void> {
    const n = await this.findRow(claimId);
    if (!n) return;
    const tab = (await this.tabs()).find((s) => s.title === SHEET_TAB);
    if (!tab) throw new Error(`Sheet tab ${SHEET_TAB} not found`);
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } },
        ],
      }),
    });
  }

  /** Renames the first tab to "Claims", freezes row 1 and writes the header row. Safe to re-run. */
  async setupSheet(headers: string[]): Promise<void> {
    const first = (await this.tabs())[0];
    if (!first) throw new Error('Spreadsheet has no tabs');
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: first.sheetId, title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } },
              fields: 'title,gridProperties.frozenRowCount',
            },
          },
        ],
      }),
    });
    await this.call(`/values/${range('A1')}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [headers] }),
    });
  }
}
