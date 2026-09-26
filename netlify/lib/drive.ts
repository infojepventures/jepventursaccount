import { toArrayBuffer } from './bytes';
import type { TokenProvider } from './googleAuth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parents: string[];
  trashed: boolean;
}

export interface DriveApi {
  findChild(parentId: string, name: string, mimeType: string): Promise<string | null>;
  createEmpty(name: string, mimeType: string, parentId: string): Promise<string>;
  findOrCreateFolder(parentId: string, name: string): Promise<string>;
  createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }): Promise<string>;
  getFile(fileId: string): Promise<DriveFileMeta | null>;
  download(fileId: string): Promise<Uint8Array>;
  downloadResponse(fileId: string): Promise<Response>;
  upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }): Promise<{ id: string }>;
  trash(fileId: string): Promise<void>;
  rename(fileId: string, name: string): Promise<void>;
}

const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class DriveClient implements DriveApi {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.getToken()}`);
    return this.fetchImpl(url, { ...init, headers });
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.req(url, init);
    if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async findChild(parentId: string, name: string, mimeType: string): Promise<string | null> {
    const q = `name='${escapeQ(name)}' and '${escapeQ(parentId)}' in parents and mimeType='${escapeQ(mimeType)}' and trashed=false`;
    const params = new URLSearchParams({
      q,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      fields: 'files(id)',
      pageSize: '1',
    });
    const data = await this.json<{ files: { id: string }[] }>(`${API}/files?${params}`);
    return data.files[0]?.id ?? null;
  }

  async createEmpty(name: string, mimeType: string, parentId: string): Promise<string> {
    const data = await this.json<{ id: string }>(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    });
    return data.id;
  }

  async findOrCreateFolder(parentId: string, name: string): Promise<string> {
    return (await this.findChild(parentId, name, FOLDER_MIME)) ?? this.createEmpty(name, FOLDER_MIME, parentId);
  }

  async createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }): Promise<string> {
    const res = await this.req(
      `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': p.mimeType,
          'X-Upload-Content-Length': String(p.size),
        },
        body: JSON.stringify({ name: p.name, parents: [p.parentId] }),
      },
    );
    const location = res.headers.get('location');
    if (!res.ok || !location) throw new Error(`Drive resumable session failed: ${res.status} ${await res.text()}`);
    return location;
  }

  async getFile(fileId: string): Promise<DriveFileMeta | null> {
    const res = await this.req(
      `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Drive getFile failed: ${res.status} ${await res.text()}`);
    const d = (await res.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      parents?: string[];
      trashed?: boolean;
    };
    return {
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      size: Number(d.size ?? 0),
      parents: d.parents ?? [],
      trashed: d.trashed ?? false,
    };
  }

  async downloadResponse(fileId: string): Promise<Response> {
    const res = await this.req(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
    return res;
  }

  async download(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.downloadResponse(fileId)).arrayBuffer());
  }

  async upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }): Promise<{ id: string }> {
    // Resumable rather than multipart: merged PDFs can exceed the 5MB multipart limit.
    const url = await this.createResumableUpload({
      name: p.name,
      mimeType: p.mimeType,
      size: p.data.length,
      parentId: p.parentId,
    });
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': p.mimeType },
      body: toArrayBuffer(p.data),
    });
    if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
    const d = (await res.json()) as { id: string };
    return { id: d.id };
  }

  /** Moves a file or folder to the trash. Already gone (404, e.g. deleted by hand) counts as done. */
  async trash(fileId: string): Promise<void> {
    const res = await this.req(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`Drive PATCH failed: ${res.status} ${await res.text()}`);
  }

  async rename(fileId: string, name: string): Promise<void> {
    await this.json(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }
}
