import type { DocAiApi, DocAiDocument } from '../lib/docai';
import type { DriveApi, DriveFileMeta } from '../lib/drive';
import { FOLDER_MIME } from '../lib/drive';
import type { PushApi, PushMessage } from '../lib/push';
import type { SheetRow, SheetsApi } from '../lib/sheets';
import type { ShortenerApi } from '../lib/shortener';

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

  async rename(id: string, name: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`Drive rename failed: 404 ${id}`);
    f.name = name;
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
    return [...this.files.values()].filter((f) => !f.trashed && f.mimeType === 'application/pdf' && f.name.startsWith('PR-JEP'));
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

export class FakeShortener implements ShortenerApi {
  error: Error | null = null;
  calls: string[] = [];

  async shorten(url: string): Promise<string> {
    this.calls.push(url);
    if (this.error) throw this.error;
    return `https://tinyurl.com/t${this.calls.length}`;
  }
}

export class FakeDocAi implements DocAiApi {
  result: DocAiDocument = { text: '', entities: [] };
  error: Error | null = null;
  calls: { data: Uint8Array; mimeType: string }[] = [];

  async process(data: Uint8Array, mimeType: string): Promise<DocAiDocument> {
    this.calls.push({ data, mimeType });
    if (this.error) throw this.error;
    return this.result;
  }
}

export class FakePush implements PushApi {
  calls: { tokens: string[]; msg: PushMessage }[] = [];
  invalid = new Set<string>();
  shouldThrow = false;

  async send(tokens: string[], msg: PushMessage): Promise<{ invalidTokens: string[] }> {
    this.calls.push({ tokens, msg });
    if (this.shouldThrow) throw new Error('FCM unavailable');
    return { invalidTokens: tokens.filter((t) => this.invalid.has(t)) };
  }
}
