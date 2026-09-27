jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));

import { tinyUrlShorten, withShortLinks, type ShortLinkDeps } from './shortLinks';

const claim = (id: string | null, shortUrl?: string | null) => ({ refNo: 'R', pdf: { driveFileId: id, fileName: null, shortUrl } });

function deps(over: Partial<ShortLinkDeps> = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const d: ShortLinkDeps = {
    shorten: async (url) => {
      calls.push(url);
      return `https://tinyurl.com/s${calls.length}`;
    },
    cacheGet: async (k) => store.get(k) ?? null,
    cacheSet: async (k, v) => void store.set(k, v),
    ...over,
  };
  return { d, store, calls };
}

describe('withShortLinks', () => {
  it('shortens PDFs without a short link, caches it, and reuses the cache next time', async () => {
    const { d, calls } = deps();
    const [a] = await withShortLinks([claim('F1')], d);
    expect(a!.pdf.shortUrl).toBe('https://tinyurl.com/s1');
    expect(calls).toEqual(['https://drive.google.com/file/d/F1/view']);

    const [again] = await withShortLinks([claim('F1')], d);
    expect(again!.pdf.shortUrl).toBe('https://tinyurl.com/s1');
    expect(calls).toHaveLength(1);
  });

  it("keeps the server's short link and skips claims without a PDF", async () => {
    const { d, calls } = deps();
    const out = await withShortLinks([claim('F1', 'https://tinyurl.com/server'), claim(null)], d);
    expect(out[0]!.pdf.shortUrl).toBe('https://tinyurl.com/server');
    expect(out[1]!.pdf.shortUrl).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('leaves the Drive link in place when shortening fails', async () => {
    const { d } = deps({ shorten: async () => { throw new Error('offline'); } });
    const [a] = await withShortLinks([claim('F1')], d);
    expect(a!.pdf.shortUrl).toBeUndefined();
  });

  it('shortens each distinct PDF once when several claims are shared', async () => {
    const { d, calls } = deps();
    const out = await withShortLinks([claim('F1'), claim('F2'), claim('F1')], d);
    expect(out.map((c) => c.pdf.shortUrl)).toEqual(['https://tinyurl.com/s1', 'https://tinyurl.com/s2', 'https://tinyurl.com/s1']);
    expect(calls).toHaveLength(2);
  });
});

describe('tinyUrlShorten', () => {
  const fetchReturning = (body: string, status = 200) =>
    jest.fn(async (_url: string) => ({ ok: status < 400, status, text: async () => body }) as unknown as Response);

  it('calls the free api-create.php endpoint and upgrades the answer to https', async () => {
    const f = fetchReturning('http://tinyurl.com/abc123\n');
    expect(await tinyUrlShorten('https://drive.google.com/file/d/F1/view', f as unknown as typeof fetch)).toBe('https://tinyurl.com/abc123');
    expect(f.mock.calls[0]![0]).toBe('https://tinyurl.com/api-create.php?url=' + encodeURIComponent('https://drive.google.com/file/d/F1/view'));
  });

  it('rejects errors and anything that is not a tinyurl link', async () => {
    await expect(tinyUrlShorten('https://x.test', fetchReturning('Error') as unknown as typeof fetch)).rejects.toThrow();
    await expect(tinyUrlShorten('https://x.test', fetchReturning('busy', 503) as unknown as typeof fetch)).rejects.toThrow();
  });
});
