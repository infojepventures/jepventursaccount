import { describe, expect, it } from 'vitest';
import { DriveClient, FOLDER_MIME } from '../../lib/drive';

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch ${String(url)}`);
    return next;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const token = async () => 'tok';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DriveClient', () => {
  it('finds a child with an escaped query across shared drives', async () => {
    const f = fakeFetch([json({ files: [{ id: 'F1' }] })]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.findChild('P1', "Tan's", FOLDER_MIME)).toBe('F1');
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('q')).toBe(
      `name='Tan\\'s' and 'P1' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    );
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(new Headers(f.calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('creates the folder when it does not exist', async () => {
    const f = fakeFetch([json({ files: [] }), json({ id: 'NEW' })]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.findOrCreateFolder('P1', '2026')).toBe('NEW');
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ name: '2026', mimeType: FOLDER_MIME, parents: ['P1'] });
  });

  it('creates a resumable upload session and returns its Location', async () => {
    const f = fakeFetch([new Response(null, { status: 200, headers: { Location: 'https://upload/session1' } })]);
    const drive = new DriveClient(token, f.impl);
    const url = await drive.createResumableUpload({ name: 'r.jpg', mimeType: 'image/jpeg', size: 123, parentId: 'P1' });
    expect(url).toBe('https://upload/session1');
    const headers = new Headers(f.calls[0]!.init.headers);
    expect(headers.get('X-Upload-Content-Type')).toBe('image/jpeg');
    expect(headers.get('X-Upload-Content-Length')).toBe('123');
    expect(f.calls[0]!.url).toContain('uploadType=resumable');
    expect(f.calls[0]!.url).toContain('supportsAllDrives=true');
  });

  it('returns null for a missing file and parses size as a number', async () => {
    const f = fakeFetch([
      json({ error: 'nf' }, 404),
      json({ id: 'A', name: 'a.pdf', mimeType: 'application/pdf', size: '2048', parents: ['P1'] }),
    ]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.getFile('missing')).toBeNull();
    expect(await drive.getFile('A')).toEqual({
      id: 'A',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      parents: ['P1'],
      trashed: false,
    });
  });

  it('uploads bytes through a resumable session', async () => {
    const f = fakeFetch([
      new Response(null, { status: 200, headers: { Location: 'https://upload/s2' } }),
      json({ id: 'UP1' }),
    ]);
    const drive = new DriveClient(token, f.impl);
    const res = await drive.upload({
      name: 'x.pdf',
      mimeType: 'application/pdf',
      parentId: 'P1',
      data: new Uint8Array([1, 2, 3]),
    });
    expect(res).toEqual({ id: 'UP1' });
    expect(f.calls[1]!.url).toBe('https://upload/s2');
    expect(f.calls[1]!.init.method).toBe('PUT');
  });

  it('trashes files with a PATCH', async () => {
    const f = fakeFetch([json({ id: 'A' })]);
    await new DriveClient(token, f.impl).trash('A');
    expect(f.calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ trashed: true });
  });

  it('renames files with a PATCH', async () => {
    const f = fakeFetch([json({ id: 'A' })]);
    await new DriveClient(token, f.impl).rename('A', 'New Name');
    expect(f.calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ name: 'New Name' });
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
  });
});
