import type { DriveApi, DriveFileMeta } from '../lib/drive';
import { FOLDER_MIME } from '../lib/drive';
import type { SheetRow, SheetsApi } from '../lib/sheets';

interface FakeFile extends DriveFileMeta {
  data: Uint8Array;
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  pendingUploads = new Map<string, { name: string; mimeType: string; size: number; parentId: string }>();
  private seq = 0;

  constructor() {
    this.files.set('root', {
      id: 'root', name: 'JEP Claims', mimeType: FOLDER_MIME, size: 0, parents: [], trashed: false, data: new Uint8Array(),
    });
  }

  private nextId(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  async findChild(parentId: string, name: string, mimeType: string) {
    for (const f of this.files.values()) {
      if (!f.trashed && f.name === name && f.mimeType === mimeType && f.parents.includes(parentId)) return f.id;
    }
    return null;
  }

  async createEmpty(name: string, mimeType: string, parentId: string) {
    const id = this.nextId(mimeType === FOLDER_MIME ? 'folder' : 'file');
    this.files.set(id, { id, name, mimeType, size: 0, parents: [parentId], trashed: false, data: new Uint8Array() });
    return id;
  }

  async findOrCreateFolder(parentId: string, name: string) {
    return (await this.findChild(parentId, name, FOLDER_MIME)) ?? this.createEmpty(name, FOLDER_MIME, parentId);
  }

  async createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }) {
    const url = `https://fake-upload.test/${this.nextId('session')}`;
    this.pendingUploads.set(url, { name: p.name, mimeType: p.mimeType, size: p.size, parentId: p.parentId });
    return url;
  }

  /** Test helper: simulates the app PUTting bytes to a resumable upload URL. Returns the new file id. */
  completeUpload(url: string, data: Uint8Array): string {
    const p = this.pendingUploads.get(url);
    if (!p) throw new Error(`Unknown upload url ${url}`);
    this.pendingUploads.delete(url);
    const id = this.nextId('file');
    this.files.set(id, { id, name: p.name, mimeType: p.mimeType, size: data.length, parents: [p.parentId], trashed: false, data });
    return id;
  }

  async getFile(id: string): Promise<DriveFileMeta | null> {
    const f = this.files.get(id);
    if (!f) return null;
    return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, parents: [...f.parents], trashed: f.trashed };
  }

  async download(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`Drive download failed: 404 ${id}`);
    return f.data;
  }

  async downloadResponse(id: string) {
    const d = await this.download(id);
    return new Response(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
  }

  async upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }) {
    const url = await this.createResumableUpload({ name: p.name, mimeType: p.mimeType, size: p.data.length, parentId: p.parentId });
    return { id: this.completeUpload(url, p.data) };
  }

  async trash(id: string) {
    const f = this.files.get(id);
    if (f) f.trashed = true;
  }

  /** Test helper: "JEP Claims/2026/_attachments/<claimId>" style path of a folder. */
  folderPath(id: string): string {
    const names: string[] = [];
    let cur = this.files.get(id);
    while (cur) {
      names.unshift(cur.name);
      cur = cur.parents[0] ? this.files.get(cur.parents[0]) : undefined;
    }
    return names.join('/');
  }

  /** Test helper: live PDFs whose names start with PR-JEP. */
  livePdfs(): FakeFile[] {
    return [...this.files.values()].filter((f) => !f.trashed && f.name.startsWith('PR-JEP'));
  }
}

export class FakeSheets implements SheetsApi {
  rows = new Map<string, SheetRow>();
  failing = false;

  async upsertClaimRow(claimId: string, row: SheetRow) {
    if (this.failing) throw new Error('Sheets unavailable');
    this.rows.set(claimId, row);
  }

  async deleteClaimRow(claimId: string) {
    this.rows.delete(claimId);
  }
}
