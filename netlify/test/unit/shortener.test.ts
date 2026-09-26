import { describe, expect, it } from 'vitest';
import { TinyUrlClient } from '../../lib/shortener';

function fakeFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('TinyUrlClient', () => {
  it('creates a tinyurl.com link with the bearer token', async () => {
    const f = fakeFetch(json({ code: 0, data: { tiny_url: 'https://tinyurl.com/2p8xk3ab' } }));
    const url = await new TinyUrlClient('tok', f.impl).shorten('https://drive.google.com/file/d/F1/view');

    expect(url).toBe('https://tinyurl.com/2p8xk3ab');
    expect(f.calls[0]!.url).toBe('https://api.tinyurl.com/create');
    expect(f.calls[0]!.init.method).toBe('POST');
    expect(new Headers(f.calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ url: 'https://drive.google.com/file/d/F1/view', domain: 'tinyurl.com' });
  });

  it('throws on an error status, without echoing the token', async () => {
    const err = await new TinyUrlClient('secret-token', fakeFetch(json({ errors: ['Unauthorized'] }, 401)).impl)
      .shorten('https://x.test')
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('secret-token');
  });

  it('rejects a response that is not an https tinyurl link', async () => {
    await expect(new TinyUrlClient('tok', fakeFetch(json({ data: { tiny_url: 'javascript:alert(1)' } })).impl).shorten('https://x.test')).rejects.toThrow();
    await expect(new TinyUrlClient('tok', fakeFetch(json({ data: {} })).impl).shorten('https://x.test')).rejects.toThrow();
  });

  describe('without a token (the free api-create.php endpoint)', () => {
    const text = (body: string, status = 200) => new Response(body, { status });

    it('GETs api-create.php with the URL encoded, and returns the https link', async () => {
      const f = fakeFetch(text('https://tinyurl.com/2p8xk3ab'));
      const url = await new TinyUrlClient(undefined, f.impl).shorten('https://drive.google.com/file/d/F1/view?usp=a&b=c');

      expect(url).toBe('https://tinyurl.com/2p8xk3ab');
      expect(f.calls[0]!.url).toBe(
        'https://tinyurl.com/api-create.php?url=' + encodeURIComponent('https://drive.google.com/file/d/F1/view?usp=a&b=c'),
      );
      expect(f.calls[0]!.init.method ?? 'GET').toBe('GET');
    });

    it('upgrades an http:// answer to https://', async () => {
      expect(await new TinyUrlClient(undefined, fakeFetch(text('http://tinyurl.com/abc123\n')).impl).shorten('https://x.test')).toBe(
        'https://tinyurl.com/abc123',
      );
    });

    it('throws on "Error" bodies and error statuses', async () => {
      await expect(new TinyUrlClient(undefined, fakeFetch(text('Error')).impl).shorten('https://x.test')).rejects.toThrow();
      await expect(new TinyUrlClient(undefined, fakeFetch(text('busy', 503)).impl).shorten('https://x.test')).rejects.toThrow('503');
    });
  });
});
